#![warn(clippy::all)]

use notify::{Event, EventKind, RecursiveMode, Watcher};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

mod nomad;

// ── State ─────────────────────────────────────────────────

struct Guardian {
    db: Connection,
    s3_url: String,
    s3_key: String,
    s3_secret: String,
    pending: Mutex<HashMap<PathBuf, Instant>>,
    // uploaded cache: path → (mtime, sha256)
    cache: Mutex<HashMap<PathBuf, (u64, String)>>,
}

// ── main ──────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("Usage: guardian <state-db> <s3-url> <s3-key> <s3-secret> [watch-dirs...]");
        std::process::exit(1);
    }

    let db_path = &args[1];
    let s3_url = args[2].trim_end_matches('/').to_string();
    let s3_key = args[3].clone();
    let s3_secret = args[4].clone();

    let db = Connection::open(db_path)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    db.execute(
        "CREATE TABLE IF NOT EXISTS state (
            path     TEXT PRIMARY KEY,
            mtime    INTEGER NOT NULL,
            size     INTEGER NOT NULL,
            sha256   BLOB NOT NULL
        )",
        [],
    )?;

    let g = Arc::new(Guardian {
        db,
        s3_url,
        s3_key,
        s3_secret,
        pending: Mutex::new(HashMap::new()),
        cache: Mutex::new(HashMap::new()),
    });

    // Load existing state
    g.load_cache().await?;

    // Watch each directory argument
    let watch_dirs: Vec<PathBuf> = args[5..].iter().map(PathBuf::from).collect();
    if watch_dirs.is_empty() {
        eprintln!("No watch directories specified. Discovering from Nomad...");
        nomad::discover_and_watch(g.clone()).await?;
    } else {
        // Rescan + upload any missed files
        for dir in &watch_dirs {
            g.scan_and_upload(dir).await?;
        }
        // Start inotify
        let (tx, mut rx) = tokio::sync::mpsc::channel(256);
        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    for path in event.paths {
                        let _ = tx.blocking_send(path);
                    }
                }
            }
        })?;

        for dir in &watch_dirs {
            watcher.watch(dir, RecursiveMode::Recursive)?;
        }

        // Event loop
        let debounce_window = Duration::from_secs(2);
        while let Some(path) = rx.recv().await {
            let g = g.clone();
            tokio::spawn(async move {
                g.handle_event(path, debounce_window).await;
            });
        }
    }

    Ok(())
}

impl Guardian {
    async fn load_cache(&self) -> Result<(), Box<dyn std::error::Error>> {
        let mut stmt = self.db.prepare("SELECT path, mtime, sha256 FROM state")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                PathBuf::from(row.get::<_, String>(0)?),
                row.get::<_, u64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;

        let mut cache = self.cache.lock().await;
        for row in rows {
            let (path, mtime, sha) = row?;
            cache.insert(path, (mtime, sha));
        }
        println!("[guardian] loaded {} tracked files", cache.len());
        Ok(())
    }

    async fn scan_and_upload(&self, dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
        for entry in walkdir::WalkDir::new(dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let path = entry.path().to_path_buf();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.') || name.ends_with(".tmp") || name.ends_with(".swp") {
                continue;
            }
            self.maybe_upload(&path).await?;
        }
        Ok(())
    }

    async fn handle_event(&self, path: PathBuf, window: Duration) {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') || name.ends_with(".tmp") || name.ends_with(".swp") {
            return;
        }

        // Debounce: track pending, upload after window
        {
            let mut pending = self.pending.lock().await;
            pending.insert(path.clone(), Instant::now());
        }

        tokio::time::sleep(window).await;

        let should_upload = {
            let pending = self.pending.lock().await;
            pending.get(&path).map_or(false, |t| t.elapsed() >= window)
        };

        if should_upload {
            let _ = self.maybe_upload(&path).await;
            self.pending.lock().await.remove(&path);
        }
    }

    async fn maybe_upload(&self, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => return Ok(()),
        };
        let mtime = meta
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();
        let size = meta.len();

        // Check if already uploaded
        {
            let cache = self.cache.lock().await;
            if let Some((cached_mtime, _)) = cache.get(path) {
                if *cached_mtime == mtime {
                    return Ok(()); // unchanged
                }
            }
        }

        // Compute sha256 + compress + upload
        let data = std::fs::read(path)?;
        let sha = hex::encode(Sha256::digest(&data));

        println!(
            "[guardian] uploading {} ({} bytes)",
            path.display(),
            size
        );

        let mut xz_buf = Vec::new();
        xz2::write::XzEncoder::new(&mut xz_buf, 2).write_all(&data)?;

        let client = reqwest::Client::new();
        let remote_path = format!(
            "{}/{}/{}",
            self.s3_url,
            chrono::Utc::now().format("%Y/%m/%d"),
            path.file_name().unwrap().to_string_lossy()
        );

        let resp = client
            .put(&remote_path)
            .header("Content-Type", "application/x-xz")
            .body(xz_buf)
            .send()
            .await?;

        if resp.status().is_success() {
            self.db.execute(
                "INSERT OR REPLACE INTO state (path, mtime, size, sha256) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![path.to_string_lossy(), mtime, size, sha],
            )?;
            self.cache
                .lock()
                .await
                .insert(path.to_path_buf(), (mtime, sha));
            println!("[guardian] ✓ {}", path.display());
        } else {
            eprintln!(
                "[guardian] ✗ upload failed ({}): {}",
                resp.status(),
                path.display()
            );
        }

        Ok(())
    }
}
