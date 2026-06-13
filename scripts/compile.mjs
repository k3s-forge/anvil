#!/usr/bin/env node
// scripts/compile.mjs
// anvil — HCL → Shell 编译器入口
// 用法：node scripts/compile.mjs <input.hcl> <output-dir/>
//
// 产出：
//   <node>.sh           — 每节点 bootstrap 脚本
//   kanidm.hcl          — 身份中心 Nomad job
//   nginx.hcl           — API 反代 Nomad job

import { writeFileSync, mkdirSync } from 'fs';
import { parseFile } from './lib/hcl-parser.mjs';
import { generate as genServer } from './lib/gen-server.mjs';
import { generate as genClient } from './lib/gen-client.mjs';
import { generate as genKanidm } from './lib/gen-kanidm.mjs';
import { generate as genNginx  } from './lib/gen-nginx.mjs';

const [ ,, input, outDir ] = process.argv;
if (!input || !outDir) {
  console.error('Usage: node scripts/compile.mjs <input.hcl> <output-dir/>');
  process.exit(1);
}

const topo = parseFile(input);
const seed = topo.nodes.find(n => n.role === 'server');
if (!seed) { console.error('ERROR: at least one server node required'); process.exit(1); }

mkdirSync(outDir, { recursive: true });

// ---- Per-node bootstrap scripts ----
for (const node of topo.nodes) {
  const isSeed = node.name === seed.name;
  const gen = isSeed ? genServer : genClient;
  const script = gen(node, topo.cluster || {}, isSeed ? null : seed);
  const fname = node.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.sh';

  writeFileSync(`${outDir}/${fname}`, script, { mode: 0o755 });
  console.error(`✓ ${fname} (${node.role}${isSeed ? ', seed' : ''})`);
}

// ---- Bootstrap jobs (kanidm + nginx) ----
const kanidmHcl = genKanidm(topo.cluster || {}, seed);
const nginxHcl  = genNginx(topo.cluster || {}, seed);

writeFileSync(`${outDir}/kanidm.hcl`, kanidmHcl);
writeFileSync(`${outDir}/nginx.hcl`,  nginxHcl);
console.error(`✓ kanidm.hcl`);
console.error(`✓ nginx.hcl`);

console.error(`\nDone. ${topo.nodes.length} scripts + 2 jobs → ${outDir}`);
