// nomad.rs — Nomad API integration for guardian
//
// Responsibilities:
//  1. Poll /v1/client/allocs every 30s
//  2. Discover allocs with job.meta.guardian_watch
//  3. Parse per-job S3 config from job meta
//  4. Register inotify watches on alloc data dir
//  5. Detect allocs transitioning away → drain + final upload

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use crate::{Guardian, JobTarget};

/// Sync state with local Nomad agent. Idempotent.
pub async fn sync_allocs(g: &Guardian, nomad_addr: &str) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .get(format!("{}/v1/client/allocs", nomad_addr))
        .send()
        .await?
        .json()
        .await?;

    let allocs = resp.as_array().unwrap_or(&vec![]);
    let mut seen_ids = HashSet::new();

    for alloc in allocs {
        let alloc_id = alloc["ID"].as_str().unwrap_or("").to_string();
        if alloc_id.is_empty() {
            continue;
        }

        let status = alloc["ClientStatus"].as_str().unwrap_or("");
        seen_ids.insert(alloc_id.clone());

        // Only watch running allocs
        if status != "running" {
            continue;
        }

        // Check job meta for opt-in
        let meta = &alloc["Job"]["Meta"];
        let watch_pattern = meta["guardian_watch"].as_str().unwrap_or("");
        if watch_pattern.is_empty() {
            continue;
        }

        // Already watching this alloc?
        {
            let allocs = g.allocs.read().await;
            if allocs.contains_key(&alloc_id) {
                continue;
            }
        }

        // Parse per-job S3 config
        let s3_url = meta["guardian_s3_url"]
            .as_str()
            .or_else(|| meta["guardian_s3_bucket"].as_str().map(|b| &b[..]))
            .unwrap_or("")
            .trim_end_matches('/')
            .to_string();

        if s3_url.is_empty() {
            eprintln!(
                "[guardian] alloc={} has guardian_watch but no guardian_s3_url — skipping",
                alloc_id
            );
            continue;
        }

        let s3_key = meta["guardian_s3_key"]
            .as_str()
            .or_else(|| std::option_env!("AWS_ACCESS_KEY_ID"))
            .unwrap_or("")
            .to_string();

        let s3_secret = meta["guardian_s3_secret"]
            .as_str()
            .or_else(|| std::option_env!("AWS_SECRET_ACCESS_KEY"))
            .unwrap_or("")
            .to_string();

        let debounce = meta["guardian_debounce"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(2);

        let patterns: Vec<String> = watch_pattern
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        // Find alloc data directory
        let alloc_dir = find_alloc_data_dir(alloc);
        if alloc_dir.as_os_str().is_empty() || !alloc_dir.exists() {
            eprintln!(
                "[guardian] alloc={} data dir not found at {} — skipping",
                alloc_id,
                alloc_dir.display()
            );
            continue;
        }

        let target = Arc::new(JobTarget {
            alloc_id: alloc_id.clone(),
            job_name: alloc["Job"]["Name"].as_str().unwrap_or("unknown").to_string(),
            s3_url,
            s3_key,
            s3_secret,
            patterns,
            debounce_secs: debounce,
            watch_dir: alloc_dir,
        });

        if let Err(e) = g.watch_target(target).await {
            eprintln!("[guardian] failed to watch alloc={}: {e}", alloc_id);
        }
    }

    // Drain any allocs no longer visible (stopped / migrated away)
    let current_allocs: Vec<String> = g.allocs.read().await.keys().cloned().collect();
    for alloc_id in current_allocs {
        if !seen_ids.contains(&alloc_id) {
            g.drain_alloc(&alloc_id).await;
        }
    }

    Ok(())
}

/// Find the data directory for an alloc.
/// Nomad creates <alloc_dir>/alloc/data/ for the task's working directory.
/// We also check the standard Nomad data directory layout.
fn find_alloc_data_dir(alloc: &serde_json::Value) -> PathBuf {
    // Primary: alloc dir from API
    let alloc_dir = alloc["AllocDir"].as_str().unwrap_or("");

    // Nomad layout: <datadir>/<alloc_id>/alloc/
    if !alloc_dir.is_empty() {
        let data = PathBuf::from(alloc_dir).join("alloc").join("data");
        if data.exists() {
            return data;
        }
        // Also check shared/alloc
        let shared = PathBuf::from(alloc_dir).join("shared").join("alloc");
        if shared.exists() {
            return shared;
        }
        // Try alloc dir itself
        if PathBuf::from(alloc_dir).exists() {
            return PathBuf::from(alloc_dir);
        }
    }

    // Fallback: common Nomad data directories
    let alloc_id = alloc["ID"].as_str().unwrap_or("");
    if alloc_id.is_empty() {
        return PathBuf::new();
    }

    for base in &["/opt/nomad/data", "/var/lib/nomad", "/var/nomad"] {
        let p = PathBuf::from(base).join("alloc").join(alloc_id).join("alloc").join("data");
        if p.exists() {
            return p;
        }
    }

    PathBuf::new()
}
