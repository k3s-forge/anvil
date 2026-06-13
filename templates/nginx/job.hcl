job "${service_name}" {
  datacenters = ["dc1"]
  type        = "service"

  group "web" {
    network {
      port "http" { static = ${port} }
    }

    task "nginx" {
      driver = "docker"
      config {
        image = "nginx:alpine"
        ports = ["http"]
      }
      env {
        DOMAIN = "${domain}"
      }
    }
  }
}
