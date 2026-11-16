use serde_json::{json, Value};

pub(crate) fn account_route(id: &str) -> Result<(u8, &str), String> {
    let (slot, raw) = if let Some(raw) = id.strip_prefix("z2:") { (2, raw) }
        else if let Some(raw) = id.strip_prefix("z:") { (1, raw) }
        else { return Err("Akun Zernio tidak dikenal".into()); };
    if raw.len() != 24 || !raw.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("ID akun Zernio tidak valid".into());
    }
    Ok((slot, raw))
}

pub(crate) fn platforms(slot: u8) -> &'static [&'static str] {
    if slot == 2 { &["youtube", "facebook"] } else { &["tiktok", "instagram"] }
}

pub(crate) fn post_target(id: &str, platform: &str, title: &str, privacy: &str, kids: bool, scheduled: bool) -> Result<Value, String> {
    let (slot, raw) = account_route(id)?;
    if !platforms(slot).contains(&platform) { return Err("Platform tidak sesuai koneksi Zernio".into()); }
    let mut target = json!({"platform":platform,"accountId":raw});
    if platform == "youtube" {
        target["platformSpecificData"] = json!({"title":title.chars().take(100).collect::<String>(),"visibility":if scheduled {"public"} else {privacy},"madeForKids":kids});
    } else if platform == "facebook" {
        target["platformSpecificData"] = json!({"contentType":"reel"});
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    const RAW: &str = "0123456789abcdef01234567";
    #[test]
    fn credentials_and_account_ids_are_scoped_to_the_connection() {
        assert_eq!(account_route(&format!("z:{RAW}")).unwrap(), (1, RAW));
        assert_eq!(account_route(&format!("z2:{RAW}")).unwrap(), (2, RAW));
        assert!(account_route("z2:bad/id").is_err());
        assert!(post_target(&format!("z:{RAW}"), "youtube", "Title", "private", false, false).is_err());
    }
    #[test]
    fn title_is_youtube_only_and_facebook_uses_reels() {
        let yt = post_target(&format!("z2:{RAW}"), "youtube", "Title", "private", true, true).unwrap();
        assert_eq!(yt["platformSpecificData"], json!({"title":"Title","visibility":"public","madeForKids":true}));
        let fb = post_target(&format!("z2:{RAW}"), "facebook", "Title", "private", false, false).unwrap();
        assert_eq!(fb["platformSpecificData"], json!({"contentType":"reel"}));
        let ig = post_target(&format!("z:{RAW}"), "instagram", "Title", "private", false, false).unwrap();
        assert!(ig.get("platformSpecificData").is_none());
    }
}
