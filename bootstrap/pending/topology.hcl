# Cold Start — 3 servers, 1 client — zero real IPs
cluster "dc1" {
  datacenter = "dc1"
}
node "seed" {
  ip   = "NODE_IP_PLACEHOLDER"
  role = "server"
}
node "srv2" {
  ip   = "NODE_IP_PLACEHOLDER"
  role = "server"
  join = ["SEED_ADDR_PLACEHOLDER"]
}
node "srv3" {
  ip   = "NODE_IP_PLACEHOLDER"
  role = "server"
  join = ["SEED_ADDR_PLACEHOLDER"]
}
node "cli1" {
  ip   = "NODE_IP_PLACEHOLDER"
  role = "client"
}
