#![warn(clippy::all)]

use notify::{Event, EventKind, RecursiveMode, Watcher};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, RwLock};

mod nomad;

// ── Per-job S3 config ─────────────────────────────────────

#[derive(Clone, Debug)]
struct JobTarget {
    alloc_id: String,
    job_name: String,
    s3_url: String,        // e.g. "https://s3.example.com/bucket"
    s3_key: String,
    s3_secret: String,
    patterns: Vec<String>, // e.g. ["*.db", "*.idx"]
    debounce_secs: u64,
    watch_dir: PathBuf,
}

impl JobTarget {
    fn matches(&self, file_name: &str) -> bool {
        if self.patterns.is_empty() {
            return true; // watch everything
        }
        self.patterns.iter().any(|p| {
            if p.starts_with("*.ext") || p == "*" {
                // Simple glob: *.db matches foo.db
                let ext = p.trim_start_matches("*.");
                file_name.ends_with(ext) || p == "*"
            } else {
                file_name == p.as_str()
            }
        })
    }
}

// ── Guardian ──────────────────────────────────────────────

struct Guardian {
    db: Connection,
    allocs: RwLock<HashMap<String, Arc<JobTarget>>>, // alloc_id → config
    pending: Mutex<HashMap<PathBuf, tokio::task::JoinHandle<()>>>,
    cache: Mutex<HashMap<PathBuf, (u64, String)>>,
    shutdown: tokio::sync::Notify,
}

// ── main ──────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let db_path = args.get(1).cloned().unwrap_or_else(|| "/var/lib/guardian/state.db".into());
    let nomad_addr =
        std::env::var("NOMAD_ADDR").unwrap_or_else(|_| "http://127.0.0.1:4646".into());

    std::fs::create_dir_all(Path::new(&db_path).parent().unwrap_or(Path::new("/var/lib")))?;

    let db = Connection::open(&db_path)?;
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
        allocs: RwLock::new(HashMap::new()),
        pending: Mutex::new(HashMap::new()),
        cache: Mutex::new(HashMap::new()),
        shutdown: tokio::sync::Notify::new(),
    });

    g.load_cache().await?;

    // Manual mode: explicit dirs bypass Nomad discovery
    let manual_dirs: Vec<PathBuf> = args[2..].iter().map(PathBuf::from).collect();
    if !manual_dirs.is_empty() {
        let target = Arc::new(JobTarget {
            alloc_id: "manual".into(),
            job_name: "manual".into(),
            s3_url: std::env::var("GUARDIAN_S3_URL").unwrap_or_default(),
            s3_key: std::env::var("GUARDIAN_S3_KEY").unwrap_or_default(),
            s3_secret: std::env::var("GUARDIAN_S3_SECRET").unwrap_or_default(),
            patterns: std::env::var("GUARDIAN_PATTERNS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            debounce_secs: 2,
            watch_dir: manual_dirs[0].clone(),
        });
        if !target.s3_url.is_empty() {
            g.watch_target(target).await?;
        }
        g.run_inotify_loop().await?;
        return Ok(());
    }

    // Nomad mode: discover allocs, poll for changes, handle shutdown
    let g2 = g.clone();
    let nomad_addr2 = nomad_addr.clone();

    // Poll loop — discover new / stopped allocs
    let poll_handle = tokio::spawn(async move {
        loop {
            if let Err(e) = nomad::sync_allocs(&g2, &nomad_addr2).await {
                eprintln!("[guardian] nomad sync error: {e}");
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(30)) => {}
                _ = g2.shutdown.notified() => break,
            }
        }
    });

    // Inotify event loop
    let g3 = g.clone();
    let inotify_handle = tokio::spawn(async move {
        let _ = g3.run_inotify_loop().await;
    });

    // SIGTERM handler — drain uploads before exit
    let g4 = g.clone();
    tokio::spawn(async move {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .unwrap()
            .recv()
            .await;
        println!("[guardian] SIGTERM received, draining uploads...");
        g4.flush_all().await;
        g4.shutdown.notify_waiters();
    });

    poll_handle.await??;
    inotify_handle.await??;

    Ok(())
}

// ── Core methods ──────────────────────────────────────────

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
        println!("[guardian] {} files tracked", cache.len());
        Ok(())
    }

    /// Register a new alloc to watch. Called by nomad::sync_allocs.
    pub async fn watch_target(&self, t: Arc<JobTarget>) -> Result<(), Box<dyn std::error::Error>> {
        let alloc_id = t.alloc_id.clone();
        println!(
            "[guardian] watching alloc={} job={} dir={}",
            alloc_id, t.job_name, t.watch_dir.display()
        );

        // Initial scan — upload any files missed while guardian was down
        if t.watch_dir.exists() {
            for entry in walkdir::WalkDir::new(&t.watch_dir)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
            {
                let path = entry.path();
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name.starts_with('.') || name.ends_with(".tmp") || name.ends_with(".swp") {
                    continue;
                }
                if !t.matches(name) {
                    continue;
                }
                let _ = self.maybe_upload(path, &t).await;
            }
        }

        self.allocs.write().await.insert(alloc_id, t);
        Ok(())
    }

    /// Stop watching an alloc (job stopped / migrated away).
    /// Does a final upload of all tracked files in that alloc's dir.
    pub async fn drain_alloc(&self, alloc_id: &str) {
        if let Some(t) = self.allocs.write().await.remove(alloc_id) {
            println!(
                "[guardian] draining alloc={} job={} — final upload",
                alloc_id, t.job_name
            );
            if t.watch_dir.exists() {
                for entry in walkdir::WalkDir::new(&t.watch_dir)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().is_file())
                {
                    let path = entry.path();
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if !t.matches(name) {
                        continue;
                    }
                    let _ = self.maybe_upload(path, &t).await;
                }
            }
        }
    }

    /// SIGTERM handler — drain everything
    pub async fn flush_all(&self) {
        let allocs: Vec<_> = self.allocs.read().await.keys().cloned().collect();
        for id in &allocs {
            self.drain_alloc(id).await;
        }
    }

    /// Inotify event loop — dispatches events to per-job handlers
    async fn run_inotify_loop(&self) -> Result<(), Box<dyn std::error::Error>> {
        let (tx, mut rx) = mpsc::channel::<PathBuf>(1024);

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    for path in event.paths {
                        let _ = tx.blocking_send(path);
                    }
                }
            }
        })?;

        // Watch all alloc directories
        for t in self.allocs.read().await.values() {
            if t.watch_dir.exists() {
                watcher.watch(&t.watch_dir, RecursiveMode::Recursive)?;
            }
        }

        loop {
            tokio::select! {
                Some(path) = rx.recv() => {
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if name.starts_with('.') || name.ends_with(".tmp") || name.ends_with(".swp") {
                        continue;
                    }

                    // Find which target this file belongs to
                    let target = {
                        let allocs = self.allocs.read().await;
                        allocs.values().find(|t| {
                            path.starts_with(&t.watch_dir) && t.matches(name)
                        }).cloned()
                    };

                    if let Some(target) = target {
                        let g = self.clone();
                        let path = path.clone();
                        let window = Duration::from_secs(target.debounce_secs);

                        // Cancel previous pending upload for same path
                        {
                            let mut pending = self.pending.lock().await;
                            if let Some(handle) = pending.remove(&path) {
                                handle.abort();
                            }
                        }

                        let handle = tokio::spawn(async move {
                            tokio::time::sleep(window).await;
                            let _ = g.maybe_upload(&path, &target).await;
                        });

                        self.pending.lock().await.insert(path, handle);
                    }
                }
                _ = self.shutdown.notified() => break,
            }
        }

        Ok(())
    }

    /// Upload a single file to S3 if changed.
    async fn maybe_upload(
        &self,
        path: &Path,
        target: &JobTarget,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => return Ok(()),
        };
        let mtime = meta
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();
        let size = meta.len();

        // Skip if already uploaded (by mtime)
        {
            let cache = self.cache.lock().await;
            if let Some((cached_mtime, _)) = cache.get(path) {
                if *cached_mtime == mtime {
                    return Ok(());
                }
            }
        }

        let data = std::fs::read(path)?;
        let sha = hex::encode(Sha256::digest(&data));

        println!(
            "[guardian] {} → {} ({} bytes, {} sha256)",
            path.display(),
            target.s3_url,
            size,
            &sha[..8]
        );

        // Compress
        let mut xz_buf = Vec::new();
        xz2::write::XzEncoder::new(&mut xz_buf, 2).write_all(&data)?;

        // Upload to per-job S3
        let remote_key = format!(
            "{}/{}/{}/{}",
            chrono::Utc::now().format("%Y/%m/%d"),
            target.job_name,
            target.alloc_id,
            path.file_name().unwrap().to_string_lossy()
        );

        let client = reqwest::Client::new();
        let resp = client
            .put(format!("{}/{}", target.s3_url, remote_key))
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
            println!("[guardian] ✓");
        } else {
            eprintln!("[guardian] ✗ {} {}", resp.status(), resp.text().await.unwrap_or_default());
        }

        Ok(())
    }
}
