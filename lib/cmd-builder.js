// site/lib/cmd-builder.js
// 职责：编译结果 + 密钥 → 最终 curl 命令
// 输入：scripts[{name, url}], gossipKey, repo, branch
// 输出：commands[{node, cmd, role, isSeed}]

export function build(scripts, gossipKey, nodes) {
  const seed = nodes.find(n => n.role === 'server');
  return scripts.map(s => {
    const node = nodes.find(n => n.name === s.name) || {};
    return {
      name: s.name,
      role: node.role || 'client',
      isSeed: seed && s.name === seed.name,
      url: s.url,
      cmd: `curl -s ${s.url} | sh -s -- --gossip-key '${gossipKey}'`,
    };
  });
}
