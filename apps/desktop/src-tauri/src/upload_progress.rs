use serde::Serialize;
use std::sync::Arc;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    pub project_id: String,
    pub account_id: String,
    pub platform: String,
    pub stage: String,
    pub sent: u64,
    pub total: u64,
}

#[derive(Clone, Default)]
pub struct Progress(Option<Arc<dyn Fn(UploadProgress) + Send + Sync>>);

impl Progress {
    pub fn new(callback: impl Fn(UploadProgress) + Send + Sync + 'static) -> Self {
        Self(Some(Arc::new(callback)))
    }

    pub fn report(&self, project: &str, account: &str, platform: &str, stage: &str, sent: u64, total: u64) {
        if let Some(callback) = &self.0 {
            callback(UploadProgress {
                project_id: project.into(), account_id: account.into(), platform: platform.into(),
                stage: stage.into(), sent: sent.min(total), total,
            });
        }
    }
}
