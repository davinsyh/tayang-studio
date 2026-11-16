pub(crate) fn file_upload_stream(
    input: tokio::fs::File,
    total: u64,
    progress: std::sync::Arc<dyn Fn(u64, u64) + Send + Sync>,
) -> impl futures_util::Stream<Item = std::io::Result<Vec<u8>>> + Send {
    use tokio::io::AsyncReadExt;
    futures_util::stream::try_unfold((input, 0u64, std::time::Instant::now()), move |(mut input, sent, last)| {
        let progress = progress.clone();
        async move {
            let mut bytes = vec![0u8; 256 * 1024];
            let n = input.read(&mut bytes).await?;
            if n == 0 { return Ok::<_, std::io::Error>(None); }
            bytes.truncate(n);
            let sent = sent + n as u64;
            let emit = last.elapsed() >= std::time::Duration::from_millis(100) || sent == total;
            // Reserve the final byte until the storage server acknowledges the PUT.
            if emit { progress(sent.min(total.saturating_sub(1)), total); }
            Ok(Some((bytes, (input, sent, if emit { std::time::Instant::now() } else { last }))))
        }
    })
}


#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn upload_stream_preserves_bytes_and_waits_for_server_ack_before_completion() {
        use futures_util::TryStreamExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("video.mp4");
        let bytes: Vec<u8> = (0..700_000).map(|n| (n % 251) as u8).collect();
        tokio::fs::write(&path, &bytes).await.unwrap();
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = events.clone();
        let progress = std::sync::Arc::new(move |sent, total| recorded.lock().unwrap().push((sent, total)));
        let chunks: Vec<Vec<u8>> = file_upload_stream(tokio::fs::File::open(path).await.unwrap(), bytes.len() as u64, progress)
            .try_collect().await.unwrap();
        assert!(chunks.iter().all(|chunk| chunk.len() <= 256 * 1024));
        assert_eq!(chunks.concat(), bytes);
        let events = events.lock().unwrap();
        assert!(!events.is_empty());
        assert!(events.iter().all(|(sent, total)| sent < total));
        assert_eq!(events.last(), Some(&(bytes.len() as u64 - 1, bytes.len() as u64)));
    }
}
