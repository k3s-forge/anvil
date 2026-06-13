# vol-expand — CI 盲编译模板
# 此骨架通过 CI 编译后方可提交 Nomad

job "${name}" {
  datacenters = ["${datacenters}"]
  type = "service"

  group "app" {
    volume "${volume_name}" {
      type   = "host"
      source = "${volume_name}"
      read_only = false
    }

    task "server" {
      driver = "exec"

      volume_mount {
        volume      = "${volume_name}"
        destination = "/data"
      }

      # CI 将根据 size_gb 生成资源约束
      config {
        command = "/usr/local/bin/app-server"
      }
    }
  }
}
