// site/lib/hcl-builder.js
// 职责：拓扑状态 → HCL 骨架文本
// 输入：nodes[], cluster{}, keyHashHex
// 约定：nodes[0] 为种子 Server，其余 Server 自动 join 种子
// 输出：HCL 字符串

export function build(nodes, cluster, keyHashHex) {
  const dc = cluster?.datacenter || 'dc1';
  const seed = nodes[0];
  const seedIP = seed?.ip || '';

  let hcl = `# Nomad Cluster Topology — Cold Start Skeleton
# Generated: ${new Date().toISOString()}
# Gossip Key SHA256: ${keyHashHex}

cluster "${dc}" {
  datacenter = "${dc}"
}

`;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    hcl += `node "${n.name}" {\n`;
    hcl += `  ip   = "${n.ip}"\n`;
    hcl += `  role = "${n.role}"\n`;
    // 非种子的 Server 加入种子
    if (i > 0 && n.role === 'server' && seedIP) {
      hcl += `  join = ["${seedIP}"]\n`;
    }
    hcl += `}\n\n`;
  }

  return hcl;
}
