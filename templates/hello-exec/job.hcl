job "${service_name}" {
  datacenters = ["dc1"]
  type        = "batch"

  group "hello" {
    task "hello" {
      driver = "raw_exec"
      config {
        command = "/bin/echo"
        args    = ["${message}"]
      }
    }
  }
}
