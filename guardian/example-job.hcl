# Example: Nomad job with guardian file watching
# Place this in your Nomad jobs directory

job "sqlite-app" {
  datacenters = ["dc1"]
  type        = "service"

  # ======== Guardian config (job-level meta) ========
  meta {
    guardian_watch  = "*.db,*.idx,*.sqlite"    # file patterns to monitor
    guardian_s3_url = "https://s3.example.com/my-backups"
    # Credentials: use env vars or Nomad Vault integration instead of plain text
    # guardian_s3_key    = ""  # set via AWS_ACCESS_KEY_ID env
    # guardian_s3_secret = ""  # set via AWS_SECRET_ACCESS_KEY env
    guardian_debounce = "3"                    # debounce window in seconds
  }

  group "app" {
    restart {
      attempts = 3
      delay    = "10s"
      mode     = "fail"
    }

    # Give guardian time to drain on stop
    kill_timeout = "120s"

    volume "data" {
      type   = "host"
      source = "app-data"
    }

    task "business" {
      driver = "exec"

      config {
        command = "/usr/local/bin/my-app"
        args    = ["--db", "${NOMAD_ALLOC_DIR}/data/app.db"]
      }

      volume_mount {
        volume      = "data"
        destination = "${NOMAD_ALLOC_DIR}/data"
      }

      resources {
        cpu    = 200
        memory = 128
      }
    }
  }
}
