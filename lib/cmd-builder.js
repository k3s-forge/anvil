// site/lib/cmd-builder.js
// 职责：编译结果 + 密钥 → 最终 curl 命令
// 输入：scripts[{name, url}], gossipKey, repo, branch
// 输出：commands[{node, cmd, role, isSeed}]
// 约定：仅 Server 节点参与冷启动；Client 在集群上线后通过 Nomad join

export function build(scripts, gossipKey, nodes) {
  const seed = nodes[0];
  const seedIP = seed?.ip || '';
  return scripts
    .filter(s => {
      const node = nodes.find(n => n.name === s.name);
      return node && node.role === 'server';
    })
    .map(s => {
      const node = nodes.find(n => n.name === s.name);
      const isSeed = !!(seed && s.name === seed.name);
      let cmd = `curl -s ${s.url} | sh -s -- --gossip-key '${gossipKey}'`;
      if (!isSeed && seedIP) {
        cmd += ` --seed-addr '${seedIP}'`;
      }
      return { name: s.name, role: 'server', isSeed, url: s.url, cmd };
    });
}
