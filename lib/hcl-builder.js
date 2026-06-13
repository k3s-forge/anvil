// site/lib/hcl-builder.js
// 职责：拓扑状态 → HCL 骨架文本
// 输入：nodes[], cluster{}, keyHashHex
// 输出：HCL 字符串

export function build(nodes, cluster, keyHashHex) {
  const dc = cluster?.datacenter || 'dc1';
  const seed = nodes.find(n => n.role === 'server');

  let hcl = `# Nomad Cluster Topology — Cold Start Skeleton
# Generated: ${new Date().toISOString()}
# Gossip Key SHA256: ${keyHashHex}

cluster "${dc}" {
  datacenter = "${dc}"
}

`;

  for (const n of nodes) {
    hcl += `node "${n.name}" {\n`;
    hcl += `  ip   = "${n.ip}"\n`;
    hcl += `  role = "${n.role}"\n`;
    if (n.role === 'server' && seed && n.name !== seed.name)
      hcl += `  join = ["${seed.ip}"]\n`;
    hcl += `}\n\n`;
  }

  return hcl;
}
