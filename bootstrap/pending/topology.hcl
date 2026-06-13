# Nomad Cluster Topology — Cold Start Skeleton
# Generated: 2026-06-13T13:03:54.183Z
# Gossip Key SHA256: c44859ae53e6aa4155a9a14fbfbd10510f7a4bbafb58ced4889ca2165928da77

cluster "dc1" {
  datacenter = "dc1"
}

node "seed-1" {
  ip   = "NODE_IP_PLACEHOLDER"
  role = "server"
}

