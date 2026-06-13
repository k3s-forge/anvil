cluster "dc1" { datacenter = "dc1" }
node "seed" { ip="NODE_IP_PLACEHOLDER" role="server" }
node "srv2" { ip="NODE_IP_PLACEHOLDER" role="server" join=["SEED_ADDR_PLACEHOLDER"] }
