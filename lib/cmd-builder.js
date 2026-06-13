// lib/cmd-builder.js
// 职责：编译结果 + 密钥 → 最终 curl 命令
// 输入：scripts[{name, url}], gossipKey, nodes
// 输出：commands[{node, cmd, role, isSeed, auto}]
// 约定：仅 Server 节点参与冷启动；Client 后加入
// --auto 模式：当节点有 _collected 数据时，通过 env vars 预填，无需运行时交互

import { canAuto } from './parse-collect.js';

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
      const auto = canAuto(node);

      let cmd = 'curl -s ' + s.url + ' | ';

      // Auto mode: pass all known values as env vars → no prompts
      if (auto) {
        const envs = [];
        if (node.hostname) envs.push('NODE_HOSTNAME=' + _sq(node.hostname));
        if (node.timezone) envs.push('NODE_TZ=' + _sq(node.timezone));
        if (node.ip && node.ip !== 'NODE_IP_PLACEHOLDER') envs.push('NODE_IP=' + _sq(node.ip));
        cmd += envs.join(' ') + ' ';
      }

      cmd += "sh -s -- --gossip-key " + _sq(gossipKey);
      if (auto) cmd += ' --auto';
      if (!isSeed && seedIP) cmd += ' --seed-addr ' + _sq(seedIP);
      if (node?.network === 'static' && node?.ip) cmd += ' --ip ' + _sq(node.ip);

      return { name: s.name, role: 'server', isSeed, auto, url: s.url, cmd };
    });
}

function _sq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
