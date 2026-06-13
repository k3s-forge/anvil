cluster "dc1" { datacenter = "dc1" }
node "seed" {
  ip="NODE_IP_PLACEHOLDER" role="server"
  hostname="nomad-seed-01" timezone="Asia/Shanghai" os="linux" bbr=true network="dhcp"
}
node "srv2" {
  ip="NODE_IP_PLACEHOLDER" role="server"
  hostname="nomad-srv-02" timezone="Asia/Shanghai" os="linux" bbr=true network="static"
  join=["SEED_ADDR_PLACEHOLDER"]
}
