// nomad.rs — Local Nomad API client
// Discovers running allocs, reads job meta for guardian_watch config,
// registers inotify watches on discovered volume paths.

use std::path::PathBuf;
use std::sync::Arc;

use crate::Guardian;

/// Poll local Nomad agent for running allocs, discover their volumes,
/// and register watches. Called when no explicit watch dirs are given.
pub async fn discover_and_watch(g: Arc<Guardian>) -> Result<(), Box<dyn std::error::Error>> {
    let nomad_addr =
        std::env::var("NOMAD_ADDR").unwrap_or_else(|_| "http://127.0.0.1:4646".into());

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/v1/client/allocs", nomad_addr))
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let mut watch_dirs: Vec<PathBuf> = Vec::new();

    if let Some(allocs) = resp.as_array() {
        for alloc in allocs {
            let status = alloc["ClientStatus"].as_str().unwrap_or("");
            if status != "running" {
                continue;
            }

            // Read job-level meta
            let meta = &alloc["Job"]["Meta"];
            if meta["guardian_watch"].is_null() {
                continue;
            }

            // Discover volume paths from task config
            if let Some(tasks) = alloc["TaskStates"].as_object() {
                for (_task_name, task) in tasks {
                    let events = &task["Events"];
                    if let Some(last_event) = events.as_array().and_then(|a| a.last()) {
                        if last_event["Type"].as_str() != Some("Started") {
                            continue;
                        }
                    }
                }
            }

            // Fall back to scanning alloc dir
            let alloc_dir = alloc["AllocDir"]
                .as_str()
                .map(PathBuf::from)
                .unwrap_or_default();
            if alloc_dir.exists() {
                let shared = alloc_dir.join("alloc").join("data");
                if shared.exists() {
                    watch_dirs.push(shared);
                }
            }
        }
    }

    if watch_dirs.is_empty() {
        println!("[guardian] no allocs with guardian_watch meta found. Idling.");
        // Keep process alive, poll periodically
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    }

    for dir in &watch_dirs {
        g.scan_and_upload(dir).await?;
        println!("[guardian] watching {}", dir.display());
    }

    // TODO: inotify registration (moved to main for now)
    Ok(())
}
