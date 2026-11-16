//! Personal publishing: Zernio for Instagram/TikTok and direct YouTube OAuth.
use crate::auth::{KeyringStore, TokenStore};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{Client, Method};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Mutex, time::Duration};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

type R<T> = Result<T, String>;
const ZERNIO: &str = "https://zernio.com/api/v1";
pub struct Hybrid {
    db: Mutex<Connection>,
    gate: tokio::sync::Mutex<()>,
    client: Client,
}
impl Hybrid {
    pub fn new(path: &Path) -> R<Self> {
        let db = Connection::open(path).map_err(|_| "Cannot open publishing database")?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS deliveries (project TEXT NOT NULL, account TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(project,account));").map_err(|_| "Cannot initialize publishing database")?;
        Ok(Self {
            db: Mutex::new(db),
            gate: Default::default(),
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(600))
                .build()
                .map_err(|_| "HTTP client unavailable")?,
        })
    }
    fn config(&self) -> R<Value> {
        let raw: Option<String> = self
            .db
            .lock()
            .map_err(|_| "Database busy")?
            .query_row("SELECT body FROM config WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(|_| "Cannot read settings")?;
        Ok(raw
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(json!({"enabled":false,"profileId":"","clientId":""})))
    }
    fn save_config(&self, v: &Value) -> R<()> {
        self.db
            .lock()
            .map_err(|_| "Database busy")?
            .execute(
                "INSERT OR REPLACE INTO config VALUES(1,?1)",
                [v.to_string()],
            )
            .map_err(|_| "Cannot save settings")?;
        Ok(())
    }
    fn delivery(&self, project: &str, account: &str) -> R<Option<Value>> {
        let raw: Option<String> = self
            .db
            .lock()
            .map_err(|_| "Database busy")?
            .query_row(
                "SELECT body FROM deliveries WHERE project=?1 AND account=?2",
                params![project, account],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Cannot read delivery")?;
        raw.map(|s| serde_json::from_str(&s).map_err(|_| "Invalid delivery record".into()))
            .transpose()
    }
    fn save_delivery(&self, project: &str, account: &str, v: &Value) -> R<()> {
        self.db
            .lock()
            .map_err(|_| "Database busy")?
            .execute(
                "INSERT OR REPLACE INTO deliveries VALUES(?1,?2,?3)",
                params![project, account, v.to_string()],
            )
            .map_err(|_| "Cannot save delivery")?;
        Ok(())
    }
    async fn z(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        key: Option<&str>,
    ) -> R<Value> {
        let token = secret("zernio")?.ok_or("Isi API key Zernio terlebih dahulu")?;
        let mut r = self
            .client
            .request(method, format!("{ZERNIO}{path}"))
            .bearer_auth(token);
        if let Some(b) = body {
            r = r
                .header("Content-Type", "application/json")
                .body(b.to_string());
        }
        if let Some(k) = key {
            r = r.header("Idempotency-Key", k);
        }
        response(r.send().await).await
    }
    pub async fn accounts(&self) -> R<Value> {
        let c = self.config()?;
        let mut accounts = Vec::new();
        if secret("zernio")?.is_some() {
            let profile = text(&c, "profileId");
            let path = format!(
                "/accounts?profileId={}&platforms=tiktok,instagram",
                encode(&profile)
            );
            let out = self.z(Method::GET, &path, None, None).await?;
            for a in out["accounts"].as_array().into_iter().flatten() {
                if !["tiktok", "instagram"].contains(&a["platform"].as_str().unwrap_or("")) {
                    continue;
                }
                accounts.push(json!({"id":format!("z:{}",text(a,"_id")),"platform":a["platform"],"username":a["username"],"profilePhotoUrl":null,"status":if a["isActive"].as_bool()==Some(false) {"disconnected"} else {"connected"}}));
            }
        }
        if let Some(name) = c["youtubeName"].as_str() {
            if secret("youtube_refresh")?.is_some() {
                accounts.push(json!({"id":"yt:own","platform":"youtube","username":name,"profilePhotoUrl":null,"status":"connected"}));
            }
        }
        Ok(json!({"accounts":accounts}))
    }
    async fn youtube_token(&self) -> R<String> {
        let c = self.config()?;
        let refresh = secret("youtube_refresh")?.ok_or("Hubungkan YouTube terlebih dahulu")?;
        let token = response(
            self.client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", text(&c, "clientId")),
                    (
                        "client_secret",
                        secret("youtube_client_secret")?.unwrap_or_default(),
                    ),
                    ("refresh_token", refresh),
                    ("grant_type", "refresh_token".into()),
                ])
                .send()
                .await,
        )
        .await?;
        token["access_token"]
            .as_str()
            .map(str::to_owned)
            .ok_or("YouTube perlu dihubungkan ulang".into())
    }
}
fn text(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or("").to_owned()
}
fn encode(s: &str) -> String {
    reqwest::Url::parse_with_params("https://local.invalid", [("v", s)])
        .unwrap()
        .query()
        .unwrap()
        .trim_start_matches("v=")
        .to_string()
}
fn secret(k: &str) -> R<Option<String>> {
    KeyringStore
        .get(&format!("hybrid:{k}"))
        .map_err(|_| "Credential Manager tidak tersedia".into())
}
fn put_secret(k: &str, v: &str) -> R<()> {
    KeyringStore
        .set(&format!("hybrid:{k}"), v)
        .map_err(|_| "Tidak dapat menyimpan kredensial".into())
}
async fn response(r: Result<reqwest::Response, reqwest::Error>) -> R<Value> {
    let r = r.map_err(|_| "Koneksi layanan gagal; periksa status sebelum mengulang")?;
    let status = r.status();
    if !status.is_success() {
        return Err(format!(
            "Layanan menolak permintaan (HTTP {})",
            status.as_u16()
        ));
    }
    let s = r.text().await.map_err(|_| "Tidak dapat membaca respons")?;
    if s.is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_str(&s).map_err(|_| "Respons layanan tidak valid".into())
    }
}
pub fn enabled(h: &Hybrid) -> bool {
    h.config()
        .ok()
        .and_then(|v| v["enabled"].as_bool())
        .unwrap_or(false)
}
#[tauri::command]
pub fn hybrid_settings(h: State<'_, Hybrid>) -> R<Value> {
    let mut c = h.config()?;
    c["hasZernioKey"] = json!(secret("zernio")?.is_some());
    c["youtubeConnected"] = json!(secret("youtube_refresh")?.is_some());
    Ok(c)
}
#[tauri::command]
pub async fn hybrid_save(
    h: State<'_, Hybrid>,
    enabled: bool,
    profile_id: String,
    client_id: String,
    api_key: Option<String>,
    client_secret: Option<String>,
) -> R<()> {
    let _guard = h.gate.lock().await;
    if !profile_id.is_empty()
        && (profile_id.len() != 24 || !profile_id.chars().all(|x| x.is_ascii_hexdigit()))
    {
        return Err("Profile ID Zernio harus berisi 24 digit hex".into());
    }
    let mut c = h.config()?;
    if text(&c, "clientId") != client_id {
        KeyringStore
            .delete("hybrid:youtube_refresh")
            .map_err(|_| "Tidak dapat mengganti OAuth client")?;
        c["youtubeName"] = Value::Null;
    }
    if let Some(k) = api_key.filter(|s| !s.trim().is_empty()) {
        put_secret("zernio", k.trim())?;
    }
    if let Some(k) = client_secret.filter(|s| !s.trim().is_empty()) {
        put_secret("youtube_client_secret", k.trim())?;
    }
    c["enabled"] = json!(enabled);
    c["profileId"] = json!(profile_id);
    c["clientId"] = json!(client_id);
    h.save_config(&c)
}
#[tauri::command]
pub async fn hybrid_youtube_connect(app: tauri::AppHandle, h: State<'_, Hybrid>) -> R<()> {
    let _guard = h.gate.lock().await;
    let c = h.config()?;
    let client_id = text(&c, "clientId");
    if client_id.is_empty() {
        return Err("Simpan OAuth Desktop client ID terlebih dahulu".into());
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Tidak dapat membuka callback lokal")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Callback gagal")?;
    let redirect = format!(
        "http://127.0.0.1:{}/",
        listener.local_addr().map_err(|_| "Callback gagal")?.port()
    );
    let state = uuid::Uuid::new_v4().to_string();
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let url=reqwest::Url::parse_with_params("https://accounts.google.com/o/oauth2/v2/auth", &[
        ("client_id",client_id.as_str()),("redirect_uri",redirect.as_str()),("response_type","code"),
        ("scope","https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly"),
        ("access_type","offline"),("prompt","consent"),("state",state.as_str()),("code_challenge",challenge.as_str()),("code_challenge_method","S256")]).map_err(|_|"OAuth URL gagal")?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Tidak dapat membuka browser")?;
    let code=tokio::task::spawn_blocking(move || {
        use std::io::{Read,Write};
        let until=std::time::Instant::now()+Duration::from_secs(300);
        while std::time::Instant::now()<until {
            if let Ok((mut stream,_))=listener.accept(){
                let _=stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut b=[0u8;8192];let n=stream.read(&mut b).unwrap_or(0);
                let line=String::from_utf8_lossy(&b[..n]);
                let path=line.split_whitespace().nth(1).unwrap_or("/");
                let u=reqwest::Url::parse(&format!("http://localhost{path}")).map_err(|_|"Callback tidak valid")?;
                let q:std::collections::HashMap<_,_>=u.query_pairs().into_owned().collect();
                if q.get("state")!=Some(&state){let _=stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");continue;}
                let _=stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nKembali ke Tayang Studio. Anda boleh menutup tab ini.");
                return q.get("code").cloned().ok_or("Login Google dibatalkan".to_string());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Login Google melewati batas 5 menit".into())
    }).await.map_err(|_|"Callback berhenti")??;
    let tokens = response(
        h.client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", client_id),
                (
                    "client_secret",
                    secret("youtube_client_secret")?.unwrap_or_default(),
                ),
                ("code", code),
                ("code_verifier", verifier),
                ("redirect_uri", redirect),
                ("grant_type", "authorization_code".into()),
            ])
            .send()
            .await,
    )
    .await?;
    let refresh = tokens["refresh_token"]
        .as_str()
        .ok_or("Google tidak memberikan refresh token; hubungkan ulang")?;
    let access = tokens["access_token"]
        .as_str()
        .ok_or("Token Google tidak tersedia")?;
    let channel = response(
        h.client
            .get("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true")
            .bearer_auth(access)
            .send()
            .await,
    )
    .await?;
    let name = channel["items"][0]["snippet"]["title"]
        .as_str()
        .ok_or("Akun Google belum memiliki channel YouTube")?;
    put_secret("youtube_refresh", refresh)?;
    let mut c = h.config()?;
    c["youtubeName"] = json!(name);
    h.save_config(&c)
}
#[tauri::command]
pub async fn hybrid_creator(h: State<'_, Hybrid>, account_id: String) -> R<Value> {
    let id = account_id
        .strip_prefix("z:")
        .filter(|s| s.chars().all(|x| x.is_ascii_hexdigit()))
        .ok_or("Akun TikTok tidak valid")?;
    h.z(
        Method::GET,
        &format!("/accounts/{id}/tiktok/creator-info?mediaType=video"),
        None,
        None,
    )
    .await
}
pub async fn connect(app: &tauri::AppHandle, h: &Hybrid, platform: &str) -> R<()> {
    if !["tiktok", "instagram"].contains(&platform) {
        return Err("Hubungkan YouTube melalui pengaturan Hybrid".into());
    }
    let profile = text(&h.config()?, "profileId");
    if profile.is_empty() {
        return Err("Isi Profile ID Zernio".into());
    }
    let v = h
        .z(
            Method::GET,
            &format!(
                "/connect/{platform}?profileId={}&scopes=posting",
                encode(&profile)
            ),
            None,
            None,
        )
        .await?;
    let u = v["authUrl"]
        .as_str()
        .filter(|s| s.starts_with("https://"))
        .ok_or("URL koneksi tidak valid")?;
    app.opener()
        .open_url(u, None::<&str>)
        .map_err(|_| "Tidak dapat membuka browser".into())
}
pub async fn disconnect(h: &Hybrid, id: &str) -> R<()> {
    let _guard = h.gate.lock().await;
    if id == "yt:own" {
        KeyringStore
            .delete("hybrid:youtube_refresh")
            .map_err(|_| "Tidak dapat melepas YouTube")?;
        let mut c = h.config()?;
        c["youtubeName"] = Value::Null;
        h.save_config(&c)
    } else if let Some(id) = id.strip_prefix("z:") {
        h.z(
            Method::DELETE,
            &format!("/accounts/{}", encode(id)),
            None,
            None,
        )
        .await
        .map(|_| ())
    } else {
        Err("Akun tidak dikenal".into())
    }
}

fn youtube_metadata(
    title: &str,
    caption: &str,
    at: Option<&str>,
    privacy: &str,
    made_for_kids: bool,
) -> Value {
    let mut status = json!({"privacyStatus":privacy,"selfDeclaredMadeForKids":made_for_kids});
    if let Some(t) = at {
        status["privacyStatus"] = json!("private");
        status["publishAt"] = json!(t);
    }
    json!({"snippet":{"title":title.chars().take(100).collect::<String>(),"description":caption,"categoryId":"22"},"status":status})
}
#[derive(Clone)]
pub struct PostInput {
    pub project: String,
    pub title: String,
    pub caption: String,
    pub accounts: Vec<String>,
    pub at: Option<String>,
    pub tiktok: Option<Value>,
    pub privacy: String,
    pub made_for_kids: bool,
}
pub async fn post(h: &Hybrid, file: &Path, input: PostInput) -> R<Value> {
    let _guard = h.gate.lock().await;
    if input.accounts.is_empty() {
        return Err("Pilih akun tujuan".into());
    }
    if !["public", "private", "unlisted"].contains(&input.privacy.as_str()) {
        return Err("Privasi YouTube tidak valid".into());
    }
    if let Some(at) = &input.at {
        if chrono::DateTime::parse_from_rfc3339(at).map_err(|_| "Jadwal tidak valid")?
            <= chrono::Utc::now()
        {
            return Err("Pilih jadwal di masa depan".into());
        }
    }
    let accounts = h.accounts().await?;
    let mut failed = false;
    for id in &input.accounts {
        if let Some(old) = h.delivery(&input.project, id)? {
            match old["status"].as_str().unwrap_or("") {
                "uploading" => {
                    if resume_youtube(h, file, &input.project, id).await.is_err() {
                        failed = true;
                    }
                    continue;
                }
                "uncertain" => {
                    let age =
                        chrono::Utc::now().timestamp() - old["createdAt"].as_i64().unwrap_or(0);
                    if age > 23 * 3600 {
                        failed = true;
                        continue;
                    }
                    let key = text(&old, "key");
                    match h
                        .z(
                            Method::POST,
                            "/posts",
                            Some(old["request"].clone()),
                            Some(&key),
                        )
                        .await
                    {
                        Ok(out) => {
                            if let Some(pid) = out["post"]["_id"].as_str() {
                                h.save_delivery(&input.project,id,&json!({"status":out["post"]["status"],"providerId":pid,"provider":"zernio","at":old["at"]}))?;
                            } else {
                                failed = true;
                            }
                        }
                        Err(_) => {
                            failed = true;
                        }
                    }
                    continue;
                }
                "failed" if old["providerId"].is_string() => {
                    failed = true;
                    continue;
                }
                "failed" => {}
                _ => continue,
            }
        }
        let account = accounts["accounts"]
            .as_array()
            .and_then(|a| a.iter().find(|a| a["id"].as_str() == Some(id.as_str())))
            .ok_or("Akun tujuan tidak tersedia")?;
        let platform = text(account, "platform");
        if platform == "tiktok" {
            if let Err(e) = validate_tiktok(h, &input, id).await {
                h.save_delivery(&input.project, id, &json!({"status":"failed","error":e}))?;
                failed = true;
                continue;
            }
        }
        let result = if id == "yt:own" {
            youtube_upload(h, file, &input, id).await
        } else {
            zernio_post(h, file, &input, id, &platform).await
        };
        if let Err(e) = result {
            failed = true;
            let existing = h.delivery(&input.project, id)?;
            if existing
                .as_ref()
                .is_none_or(|v| v["status"] != "uploading" && v["status"] != "uncertain")
            {
                h.save_delivery(&input.project, id, &json!({"status":"failed","error":e}))?;
            }
        }
    }
    // Successful destinations remain recorded even when another destination fails.
    let details = status(h, &format!("hybrid:{}", input.project), false).await?;
    if failed {
        return Err(
            "Sebagian tujuan gagal. Lihat status per akun di Media Sosial sebelum mencoba ulang."
                .into(),
        );
    }
    if details["status"] == "failed" {
        return Err("Ada pengiriman yang perlu diperiksa di Media Sosial; unggahan yang berhasil tidak diulang".into());
    }
    let state = details["status"].clone();
    Ok(
        json!({"postId":format!("hybrid:{}",input.project),"status":state,"postsCharged":0,"usage":{"allowance":0,"used":0,"remaining":0}}),
    )
}
async fn validate_tiktok(h: &Hybrid, input: &PostInput, id: &str) -> R<()> {
    let t = input
        .tiktok
        .as_ref()
        .ok_or("TikTok perlu review video dan persetujuan melalui dialog Posting")?;
    if t["content_preview_confirmed"] != true || t["express_consent_given"] != true {
        return Err("Konfirmasi video TikTok terlebih dahulu".into());
    }
    let info = h
        .z(
            Method::GET,
            &format!(
                "/accounts/{}/tiktok/creator-info?mediaType=video",
                encode(id.trim_start_matches("z:"))
            ),
            None,
            None,
        )
        .await?;
    if !info["privacyLevels"]
        .as_array()
        .is_some_and(|a| a.iter().any(|v| v["value"] == t["privacy_level"]))
    {
        return Err("Pilihan privasi TikTok tidak tersedia".into());
    }
    Ok(())
}
async fn zernio_post(
    h: &Hybrid,
    file: &Path,
    input: &PostInput,
    id: &str,
    platform: &str,
) -> R<()> {
    let size = std::fs::metadata(file)
        .map_err(|_| "Video tidak ditemukan")?
        .len();
    let up = h
        .z(
            Method::POST,
            "/media/presign",
            Some(json!({"filename":"video.mp4","contentType":"video/mp4","size":size})),
            None,
        )
        .await?;
    let url = up["uploadUrl"]
        .as_str()
        .ok_or("Upload URL tidak tersedia")?;
    crate::cloud::upload(&h.client, url, file, "video/mp4")
        .await
        .map_err(|_| "Upload Zernio gagal")?;
    let mut body = json!({"content":input.caption,"mediaItems":[{"type":"video","url":up["publicUrl"]}],"platforms":[{"platform":platform,"accountId":id.trim_start_matches("z:")}]});
    if let Some(at) = &input.at {
        body["scheduledFor"] = json!(at);
    } else {
        body["publishNow"] = json!(true);
    }
    if platform == "tiktok" {
        body["tiktokSettings"] = input.tiktok.clone().unwrap();
    }
    let key = format!("tayang-{}-{}", input.project, id);
    h.save_delivery(&input.project,id,&json!({"status":"uncertain","error":"Permintaan Zernio sedang diproses; refresh status sebelum mengulang","key":key,"createdAt":chrono::Utc::now().timestamp(),"request":body,"at":input.at}))?;
    match h.z(Method::POST, "/posts", Some(body), Some(&key)).await {
        Ok(out) => {
            let post = &out["post"];
            let pid = post["_id"]
                .as_str()
                .ok_or("Post ID Zernio belum diketahui")?;
            h.save_delivery(&input.project,id,&json!({"status":post["status"],"providerId":pid,"provider":"zernio","at":input.at}))
        }
        Err(e) => {
            if [400, 401, 403, 404, 422]
                .iter()
                .any(|code| e.contains(&format!("HTTP {code}")))
            {
                h.save_delivery(&input.project, id, &json!({"status":"failed","error":e}))?;
            }
            Err(e)
        }
    }
}
async fn file_hash(file: &Path) -> R<String> {
    use tokio::io::AsyncReadExt;
    let mut f = tokio::fs::File::open(file)
        .await
        .map_err(|_| "Video tidak ditemukan")?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let n = f
            .read(&mut buffer)
            .await
            .map_err(|_| "Tidak dapat membaca video")?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
async fn youtube_upload(h: &Hybrid, file: &Path, input: &PostInput, id: &str) -> R<()> {
    let token = h.youtube_token().await?;
    let size = std::fs::metadata(file)
        .map_err(|_| "Video tidak ditemukan")?
        .len();
    let hash = file_hash(file).await?;
    let metadata = youtube_metadata(
        &input.title,
        &input.caption,
        input.at.as_deref(),
        &input.privacy,
        input.made_for_kids,
    );
    let r=h.client.post("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status").bearer_auth(&token)
        .header("Content-Type","application/json").header("X-Upload-Content-Type","video/mp4").header("X-Upload-Content-Length",size).body(metadata.to_string()).send().await.map_err(|_|"Tidak dapat memulai upload YouTube")?;
    if !r.status().is_success() {
        return Err(format!(
            "YouTube menolak upload (HTTP {})",
            r.status().as_u16()
        ));
    }
    let url = r
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .ok_or("Sesi upload YouTube tidak tersedia")?
        .to_string();
    let parsed = reqwest::Url::parse(&url).map_err(|_| "URL upload tidak valid")?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("www.googleapis.com") {
        return Err("Host upload YouTube tidak valid".into());
    }
    // The session URL is a credential; keep it in the OS vault, never in delivery records.
    put_secret(&format!("upload:{}", input.project), &url)?;
    h.save_delivery(
        &input.project,
        id,
        &json!({"status":"uploading","size":size,"sha256":hash,"at":input.at}),
    )?;
    resume_youtube(h, file, &input.project, id).await
}
fn save_youtube_result(h: &Hybrid, project: &str, id: &str, out: &Value) -> R<()> {
    let old = h
        .delivery(project, id)?
        .ok_or("Sesi upload tidak ditemukan")?;
    let video = out["id"]
        .as_str()
        .ok_or("Video ID belum diketahui; periksa channel sebelum mengulang")?;
    h.save_delivery(project,id,&json!({"status":if old["at"].is_string(){"scheduled"}else{"processing"},"providerId":video,"provider":"youtube","url":format!("https://www.youtube.com/watch?v={video}"),"at":old["at"]}))?;
    let _ = KeyringStore.delete(&format!("hybrid:upload:{project}"));
    Ok(())
}
async fn probe_youtube(h: &Hybrid, project: &str, size: u64) -> R<reqwest::Response> {
    let url = secret(&format!("upload:{project}"))?
        .ok_or("Sesi upload hilang; periksa channel sebelum mengulang")?;
    h.client
        .put(url)
        .header("Content-Length", 0)
        .header("Content-Range", format!("bytes */{size}"))
        .send()
        .await
        .map_err(|_| "Pemeriksaan upload gagal".into())
}
async fn resume_youtube(h: &Hybrid, file: &Path, project: &str, id: &str) -> R<()> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let old = h
        .delivery(project, id)?
        .ok_or("Sesi upload tidak ditemukan")?;
    let size = old["size"]
        .as_u64()
        .ok_or("Ukuran upload tidak ditemukan")?;
    if std::fs::metadata(file)
        .map_err(|_| "Video tidak ditemukan")?
        .len()
        != size
    {
        return Err(
            "Video berubah setelah upload dimulai. Pulihkan video asli untuk melanjutkan".into(),
        );
    }
    if old["sha256"].as_str() != Some(file_hash(file).await?.as_str()) {
        return Err(
            "Video berubah setelah upload dimulai. Pulihkan video asli untuk melanjutkan".into(),
        );
    }
    let probe = probe_youtube(h, project, size).await?;
    if probe.status().is_success() {
        let out = response(Ok(probe)).await?;
        return save_youtube_result(h, project, id, &out);
    }
    if probe.status().as_u16() != 308 {
        return Err(
            "Sesi upload YouTube tidak aktif. Periksa channel sebelum membuat posting baru".into(),
        );
    }
    let mut offset = probe
        .headers()
        .get("range")
        .and_then(|s| s.to_str().ok())
        .and_then(|s| s.rsplit('-').next())
        .and_then(|s| s.parse::<u64>().ok())
        .map(|n| n + 1)
        .unwrap_or(0);
    if offset >= size {
        return Err("Status upload YouTube belum pasti; periksa channel".into());
    }
    let url = secret(&format!("upload:{project}"))?.ok_or("Sesi upload hilang")?;
    let mut f = tokio::fs::File::open(file)
        .await
        .map_err(|_| "Video tidak ditemukan")?;
    while offset < size {
        f.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|_| "Video tidak dapat dibaca")?;
        let n = std::cmp::min(8 * 1024 * 1024, size - offset) as usize;
        let mut chunk = vec![0; n];
        f.read_exact(&mut chunk)
            .await
            .map_err(|_| "Video tidak dapat dibaca")?;
        let r = h
            .client
            .put(&url)
            .header("Content-Type", "video/mp4")
            .header("Content-Length", n)
            .header(
                "Content-Range",
                format!("bytes {}-{}/{}", offset, offset + n as u64 - 1, size),
            )
            .body(chunk)
            .send()
            .await
            .map_err(|_| "Upload terputus; ulangi untuk melanjutkan sesi yang sama")?;
        if r.status().is_success() {
            let out = response(Ok(r)).await?;
            return save_youtube_result(h, project, id, &out);
        }
        if r.status().as_u16() != 308 {
            return Err(format!(
                "Upload YouTube berhenti (HTTP {})",
                r.status().as_u16()
            ));
        }
        let next = r
            .headers()
            .get("range")
            .and_then(|s| s.to_str().ok())
            .and_then(|s| s.rsplit('-').next())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|n| n + 1)
            .ok_or("Offset upload tidak diketahui")?;
        if next <= offset || next > size {
            return Err("Offset upload YouTube tidak valid".into());
        }
        offset = next;
    }
    Err("Upload belum terkonfirmasi; periksa status".into())
}

pub async fn status(h: &Hybrid, post_id: &str, refresh: bool) -> R<Value> {
    let _guard = if refresh {
        Some(h.gate.lock().await)
    } else {
        None
    };
    let project = post_id
        .strip_prefix("hybrid:")
        .ok_or("Post ID tidak valid")?;
    let rows: Vec<(String, String)> = {
        let db = h.db.lock().map_err(|_| "Database busy")?;
        let mut stmt = db
            .prepare("SELECT account,body FROM deliveries WHERE project=?1")
            .map_err(|_| "Status tidak tersedia")?;
        let rows = stmt
            .query_map([project], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|_| "Status tidak tersedia")?;
        rows.filter_map(Result::ok).collect()
    };
    let mut results = Vec::new();
    let mut states = Vec::new();
    let mut at = Value::Null;
    for (account, raw) in rows {
        let mut v: Value = serde_json::from_str(&raw).map_err(|_| "Status rusak")?;
        if refresh && v["provider"] == "zernio" {
            if let Ok(out) = h
                .z(
                    Method::GET,
                    &format!("/posts/{}", encode(&text(&v, "providerId"))),
                    None,
                    None,
                )
                .await
            {
                let p = &out["post"];
                v["status"] = p["status"].clone();
                if let Some(target) = p["platforms"].as_array().and_then(|a| a.first()) {
                    v["url"] = target["platformPostUrl"].clone();
                    v["error"] = target["errorMessage"].as_str().or_else(|| target["error"].as_str()).map(|s| json!(s)).unwrap_or(Value::Null);
                }
                h.save_delivery(project, &account, &v)?;
            }
        }
        if refresh && v["status"] == "uploading" {
            if let Ok(probe) = probe_youtube(h, project, v["size"].as_u64().unwrap_or(0)).await {
                if probe.status().is_success() {
                    if let Ok(out) = response(Ok(probe)).await {
                        save_youtube_result(h, project, &account, &out)?;
                        v = h.delivery(project, &account)?.unwrap();
                    }
                }
            }
            if v["status"] == "uploading" {
                v["error"]=json!("Upload terputus atau masih berjalan. Ulangi posting untuk melanjutkan sesi yang sama.");
            }
        }
        if refresh && v["provider"] == "youtube" {
            if let Ok(token) = h.youtube_token().await {
                if let Ok(out) = response(
                    h.client
                        .get("https://www.googleapis.com/youtube/v3/videos")
                        .query(&[
                            ("part", "status,processingDetails"),
                            ("id", &text(&v, "providerId")),
                        ])
                        .bearer_auth(token)
                        .send()
                        .await,
                )
                .await
                {
                    let video = &out["items"][0];
                    if video["status"]["uploadStatus"] == "rejected"
                        || video["status"]["uploadStatus"] == "failed"
                    {
                        v["status"] = json!("failed");
                        v["error"] = json!("YouTube menolak video; periksa YouTube Studio.");
                    } else if video["processingDetails"]["processingStatus"] == "succeeded"
                        && (v["at"].is_null() || video["status"]["privacyStatus"] == "public")
                    {
                        v["status"] = json!("published");
                    }
                    h.save_delivery(project, &account, &v)?;
                }
            }
        }
        let state = text(&v, "status");
        let success = ["published", "scheduled", "processing"].contains(&state.as_str());
        if v["at"].is_string() {
            at = v["at"].clone();
        }
        results.push(
            json!({"socialAccountId":account,"success":success,"status":state,"error":v["error"],"url":v["url"]}),
        );
        states.push(state);
    }
    let state = if states.is_empty() {
        "failed"
    } else if states
        .iter()
        .any(|s| ["failed", "uncertain", "uploading"].contains(&s.as_str()))
    {
        "failed"
    } else if states.iter().any(|s| s == "scheduled") {
        "scheduled"
    } else if states.iter().any(|s| s != "published") {
        "processing"
    } else {
        "published"
    };
    Ok(json!({"postId":post_id,"status":state,"scheduledAt":at,"results":results}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn youtube_schedule_is_private_until_due() {
        let m = youtube_metadata(
            "Title",
            "Description",
            Some("2027-01-01T00:00:00Z"),
            "public",
            false,
        );
        assert_eq!(m["status"]["privacyStatus"], "private");
        assert_eq!(m["status"]["publishAt"], "2027-01-01T00:00:00Z");
    }
    #[test]
    fn delivery_survives_reopen_and_is_per_account() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("posts.db");
        {
            let h = Hybrid::new(&p).unwrap();
            h.save_delivery("p", "z:one", &json!({"status":"published"}))
                .unwrap();
            h.save_delivery("p", "yt:own", &json!({"status":"failed"}))
                .unwrap();
        }
        let h = Hybrid::new(&p).unwrap();
        assert_eq!(
            h.delivery("p", "z:one").unwrap().unwrap()["status"],
            "published"
        );
        assert_eq!(
            h.delivery("p", "yt:own").unwrap().unwrap()["status"],
            "failed"
        );
        assert!(h.delivery("other", "z:one").unwrap().is_none());
    }
}
