# Nomad Cluster Topology — Cold Start Skeleton
# Generated: 2026-06-13T12:46:28.078Z
# Gossip Key SHA256: f917cd6144e9cf8da923704e3109a2dbb6436730b04f316ab8aac90818676371

cluster "dc1" {
  datacenter = "dc1"
}

node "gentle-sample" {
  ip   = "212.60.153.53"
  role = "server"
}

