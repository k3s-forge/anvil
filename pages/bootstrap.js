// pages/bootstrap.js
// 职责：冷启动页 — 种子自举 + 集群扩张双 tab
// 种子 tab：单节点，推 HCL → CI → curl（暗夜下蛋），完成后设密码封存
// 扩张 tab：🔐 密码解密 → 🔑 OIDC 身份验证 → 📋 粘贴 collect → ⚡ 生成 join

import * as Crypto  from '../lib/crypto.js';
import * as Topo    from '../lib/topology.js';
import * as HCL     from '../lib/hcl-builder.js';
import * as GitHub  from '../lib/github-client.js';
import * as Cmd     from '../lib/cmd-builder.js';
import * as Output  from '../ui/output.js';
import * as Auth    from '../lib/auth.js';
import { parse }    from '../lib/parse-collect.js';
import { html as esc } from '../lib/escape.js';
import { t } from '../lib/i18n.js';

const _sq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

let _tab = 'seed';                 // 'seed' | 'expansion'
let _seedNode = Topo.createNode('seed-1', '', 'server');
let _expansionFields = null;       // parsed collect.sh fields for expansion node
let _expSeedIP = '';               // decrypted from sealed.bin
let _expGossipKey = '';            // decrypted from sealed.bin

export function render(main, status, CFG) {
  main.innerHTML = `
    <div class="bs-tabs">
      <button class="bs-tab ${_tab==='seed'?'active':''}" data-tab="seed">🥇 ${t('bs.tab.seed')}</button>
      <button class="bs-tab ${_tab==='expansion'?'active':''}" data-tab="expansion">🥈 ${t('bs.tab.expansion')}</button>
    </div>
    <div class="coldstart-layout">
      <div class="coldstart-left" id="bs-left"></div>
      <div class="coldstart-right" id="output-container">
        <div class="empty"><div class="empty-icon">📋</div>
          <div class="empty-title">${t('bs.output.empty')}</div>
          <div class="empty-desc">${_tab==='seed' ? t('bs.output.emptySub') : t('bs.output.expEmpty')}</div></div>
      </div>
    </div>`;

  // Tab switching
  main.querySelectorAll('.bs-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _tab = btn.dataset.tab;
      render(main, status, CFG);
    });
  });

  const left = document.getElementById('bs-left');
  if (_tab === 'seed') _renderSeed(left, status, CFG);
  else _renderExpansion(left, status, CFG);
}

// ── Seed tab ──────────────────────────────────────────────

function _renderSeed(container, status, CFG) {
  container.innerHTML = `
    <h3>${t('bs.heading')}</h3>
    <div id="seed-paste-area"></div>
    <div id="seed-form"></div>
    <div class="err-list" id="seed-errors" style="display:none"></div>
    <button class="btn btn-primary btn-lg" id="btn-generate-seed">${t('bs.btn.generate')}</button>
    <div class="section-divider"></div>
    <h3>${t('bs.creds.heading')}</h3>
    <div id="seed-creds"></div>`;

  _renderPasteArea(document.getElementById('seed-paste-area'), fields => {
    _seedNode = Topo.applyCollect([_seedNode], _seedNode._id, fields)[0];
    _renderSeedForm(document.getElementById('seed-form'));
  });

  _renderSeedForm(document.getElementById('seed-form'));
  _renderSeedCreds(document.getElementById('seed-creds'));
  document.getElementById('btn-generate-seed').addEventListener('click', () => _generateSeed(status, CFG));
}

function _renderSeedForm(container) {
  const n = _seedNode;
  const collected = n._collected
    ? `<span class="collected-badge" title="${_collectedTitle(n)}">✓ ${t('bs.collected')}</span>`
    : '';

  container.innerHTML = `
    <div class="node-row node-seed">
      <div class="fg fg-name"><label>${t('bs.node.name')} <span class="seed-badge">${t('bs.seed.badge')}</span> ${collected}</label>
        <input type="text" class="nf-name" value="${esc(n.name)}" placeholder="seed-1"></div>
      <div class="fg fg-ip"><label>${t('bs.node.ip')}</label>
        <input type="text" class="nf-ip" value="${esc(n.ip)}" placeholder="x.x.x.x"></div>
      <div class="fg fg-role"><label>${t('bs.node.role')}</label>
        <div class="seed-role-locked">${t('bs.seed.role')}</div></div>
    </div>
    <div class="node-advanced">
      <button class="adv-toggle" type="button">⚙ ${t('bs.node.syscfg')} ${n._collected ? '●' : ''}</button>
      <div class="adv-body" style="display:none">
        <div class="fg"><label>Hostname</label>
          <input type="text" class="nf-hostname" value="${esc(n.hostname||'')}" placeholder="${esc(n.name)}"></div>
        <div class="fg"><label>Timezone</label>
          <input type="text" class="nf-timezone" value="${esc(n.timezone||'')}" placeholder="UTC"></div>
        <div class="fg"><label>OS</label>
          <select class="nf-os"><option value="linux" ${(n.os||'linux')==='linux'?'selected':''}>Linux</option>
            <option value="freebsd" ${n.os==='freebsd'?'selected':''}>FreeBSD</option></select></div>
        <div class="fg"><label>Network</label>
          <select class="nf-network"><option value="dhcp" ${(n.network||'dhcp')==='dhcp'?'selected':''}>DHCP</option>
            <option value="static" ${n.network==='static'?'selected':''}>Static IP</option></select></div>
      </div>
    </div>`;

  // Toggle advanced
  const toggle = container.querySelector('.adv-toggle');
  const body   = container.querySelector('.adv-body');
  toggle.addEventListener('click', () => {
    body.style.display = body.style.display === 'none' ? 'flex' : 'none';
  });

  // Bind events
  _bind(container, '.nf-name',     v => _seedNode = Topo.updateNode([_seedNode], _seedNode._id, 'name', v)[0]);
  _bind(container, '.nf-ip',       v => _seedNode = Topo.updateNode([_seedNode], _seedNode._id, 'ip', v)[0]);
  _bind(container, '.nf-hostname', v => _seedNode = Topo.updateNode([_seedNode], _seedNode._id, 'hostname', v)[0]);
  _bind(container, '.nf-timezone', v => _seedNode = Topo.updateNode([_seedNode], _seedNode._id, 'timezone', v)[0]);
  _bind(container, '.nf-os',       v => _seedNode = Topo.updateNode([_seedNode], _seedNode._id, 'os', v)[0]);
  _bind(container, '.nf-network',  v => _seedNode = Topo.updateNode([_seedNode], _seedNode._id, 'network', v)[0]);
}

let _seedCreds = {};  // { gossipKey, githubPat, repo, branch }

function _renderSeedCreds(container) {
  const cfg = {
    repo:   localStorage.getItem('anvil_repo')   || 'k3s-forge/nomad-gitops',
    branch: localStorage.getItem('anvil_branch') || 'main',
  };
  container.innerHTML = `
    <div class="fg"><label>${t('bs.gossip.label')} <span class="hint">(${t('bs.gossip.hint')})</span></label>
      <input type="password" id="cfg-gossip-key" placeholder="${t('bs.gossip.hint')}"></div>
    <div class="fg"><label>${t('bs.github.label')} <span class="hint">(${t('bs.github.hint')})</span></label>
      <input type="password" id="cfg-github-pat" placeholder="ghp_... ${t('bs.github.label')}"></div>
    <div class="fg"><label>${t('bs.repo.label')}</label>
      <input type="text" id="cfg-repo" value="${esc(cfg.repo)}" placeholder="owner/repo"></div>
    <div class="fg"><label>${t('bs.branch.label')}</label>
      <input type="text" id="cfg-branch" value="${esc(cfg.branch)}" placeholder="main"></div>`;

  // Restore saved values
  if (_seedCreds.gossipKey) {
    const gk = container.querySelector('#cfg-gossip-key');
    if (gk) gk.value = _seedCreds.gossipKey;
  }
}

function _getSeedCreds() {
  return {
    gossipKey:  document.getElementById('cfg-gossip-key')?.value.trim() || '',
    githubPat:  document.getElementById('cfg-github-pat')?.value.trim() || '',
    repo:       document.getElementById('cfg-repo')?.value.trim() || 'k3s-forge/nomad-gitops',
    branch:     document.getElementById('cfg-branch')?.value.trim() || 'main',
  };
}

async function _generateSeed(status, CFG) {
  const creds = _getSeedCreds();
  _seedCreds = creds;
  const nodes = [_seedNode];
  const v = Topo.validate(nodes);
  if (!v.valid) {
    _showSeedErrors(v.errors);
    return;
  }
  if (!creds.githubPat) {
    Output.showStatus(status, t('common.needPAT'), 'err');
    return;
  }

  const repo = creds.repo || CFG.repo;
  const branch = creds.branch || CFG.branch;
  const gossipKey = creds.gossipKey || Crypto.generateKey();
  const keyHash = await Crypto.sha256Hex(gossipKey);
  const hcl = HCL.build(nodes, { datacenter: 'dc1' }, keyHash);

  const out = document.getElementById('output-container');
  Output.showStatus(status, t('bs.output.pushing'), 'loading');

  try {
    const push = await GitHub.pushFiles(creds.githubPat, repo, branch,
      [{ path: 'bootstrap/pending/topology.hcl', content: hcl, mode: '100644' }],
      'coldstart: seed topology from anvil');

    Output.showStatus(status, t('bs.output.pushed'), 'loading');
    const ci = await GitHub.pollCI(creds.githubPat, repo, push.sha, 600000);
    if (!ci.success) {
      Output.showStatus(status, `${t('bs.output.ciFail')}: ${ci.runs.filter(r=>r.conclusion!=='success').map(r=>r.name).join(', ')}`, 'err');
      return;
    }

    const scripts = [{ name: _seedNode.name, url: `https://raw.githubusercontent.com/${repo}/${branch}/bootstrap/compiled/${_seedNode.name}.sh` }];
    const cmds = Cmd.build(scripts, gossipKey, nodes);
    Output.showStatus(status, t('bs.output.ciOK'), 'ok');
    Output.renderCommands(out, cmds);

    // Store gossip key + seed IP for expansion tab
    localStorage.setItem('anvil_gossip_key', gossipKey);
    localStorage.setItem('anvil_seed_ip',    _seedNode.ip || '');
    localStorage.setItem('anvil_repo',       repo);
    localStorage.setItem('anvil_branch',     branch);

    // Guide
    const guide = document.createElement('div');
    guide.className = 'bootstrap-guide';
    guide.innerHTML = `
      <div class="section-divider"></div>
      <div class="status status-ok" style="margin-bottom:.8rem">${t('bs.cmd.autoNote')}</div>
      <h4>${t('bs.guide.title')}</h4>
      <ol class="guide-steps">
        <li>${t('bs.guide.step1')}</li>
        <li>${t('bs.guide.step2')}</li>
        <li>${t('bs.guide.after')}</li>
      </ol>`;
    out.appendChild(guide);

    const details = document.createElement('details');
    details.className = 'hcl-details';
    details.innerHTML = `<summary>${t('bs.hcl.title')}</summary><pre class="hcl-preview">${esc(hcl)}</pre>`;
    out.appendChild(details);

    // Seal section — encrypt seed IP + gossip key with cluster password
    const sealDiv = document.createElement('div');
    sealDiv.id = 'seal-section';
    sealDiv.style.marginTop = '1rem';
    out.appendChild(sealDiv);
    _renderSealSection(sealDiv, gossipKey, _seedNode.ip, creds.githubPat, repo, branch);

  } catch (err) {
    Output.showStatus(status, `${t('bs.output.error')}: ${err.message}`, 'err');
  }
}

// ── Seal section (after seed generate) ──────────────────

function _renderSealSection(container, gossipKey, seedIP, pat, repo, branch) {
  container.innerHTML = `
    <div class="section-divider"></div>
    <h4>${t('bs.seal.title')}</h4>
    <p class="seal-desc">${t('bs.seal.desc')}</p>
    <div class="fg-row">
      <input type="password" id="seal-password" class="seal-input" placeholder="${t('bs.seal.placeholder')}">
      <button class="btn btn-primary" id="btn-seal">${t('bs.seal.btn')}</button>
    </div>
    <span id="seal-msg"></span>`;

  const msg = (text, cls) => {
    const el = document.getElementById('seal-msg');
    if (el) { el.textContent = text; el.className = `seal-msg ${cls}`; }
  };

  document.getElementById('btn-seal').addEventListener('click', async () => {
    const pw = document.getElementById('seal-password').value;
    if (pw.length < 8) { msg(t('bs.seal.errShort'), 'err'); return; }

    msg(t('bs.seal.pushing'), 'loading');
    try {
      const payload = JSON.stringify({ seed_ip: seedIP, gossip_key: gossipKey, ts: Date.now() });
      const cipher = await Crypto.seal(payload, pw);

      await GitHub.pushFiles(pat, repo, branch,
        [{ path: 'cluster/sealed.bin', content: cipher, mode: '100644' }],
        'seal: cluster credentials');

      // Cache locally as fallback
      localStorage.setItem('anvil_seed_ip', seedIP);
      localStorage.setItem('anvil_gossip_key', gossipKey);

      msg(t('bs.seal.ok'), 'ok');
    } catch (e) {
      msg(`${t('bs.seal.errPush')}: ${e.message}`, 'err');
    }
  });
}

// ── Expansion tab ─────────────────────────────────────────

function _renderExpansion(container, status, CFG) {
  const repo = CFG.repo || localStorage.getItem('anvil_repo') || 'k3s-forge/nomad-gitops';
  const branch = CFG.branch || localStorage.getItem('anvil_branch') || 'main';

  container.innerHTML = `
    <h3>🥈 ${t('bs.tab.expansion')}</h3>
    <div id="exp-pw-section"></div>
    <div id="exp-gate-section" style="display:none"></div>`;

  // Phase 1: decrypt with cluster password
  _renderUnsealSection(document.getElementById('exp-pw-section'), repo, branch,
    (seedIP, gossipKey) => {
      _expSeedIP = seedIP;
      _expGossipKey = gossipKey;
      // Phase 2: OIDC identity verification
      _renderOidcGate(document.getElementById('exp-gate-section'), seedIP, gossipKey, repo, branch, status);
    });

  // Fast path: already decrypted + already logged in → skip to form
  if (_expSeedIP && Auth.isLoggedIn()) {
    const gate = document.getElementById('exp-gate-section');
    _renderExpansionForm(gate, _expSeedIP, _expGossipKey, repo, branch, status);
  }
}

function _renderUnsealSection(container, repo, branch, onDecrypted) {
  const savedPw = localStorage.getItem('anvil_cluster_pw') || '';

  container.innerHTML = `
    <div class="seal-box">
      <h4>${t('bs.exp.pw.title')}</h4>
      <p class="seal-desc">${t('bs.exp.pw.desc')}</p>
      <div class="fg-row">
        <input type="password" id="exp-password" class="seal-input" placeholder="${t('bs.exp.pw.placeholder')}" value="${esc(savedPw)}">
        <button class="btn btn-primary" id="btn-unseal">${t('bs.exp.pw.btn')}</button>
      </div>
      <span id="unseal-msg"></span>
    </div>`;

  const msg = (text, cls) => {
    const el = document.getElementById('unseal-msg');
    if (el) { el.textContent = text; el.className = `seal-msg ${cls}`; }
  };

  document.getElementById('btn-unseal').addEventListener('click', async () => {
    const pw = document.getElementById('exp-password').value;
    if (!pw) return;

    msg(t('bs.exp.pw.decrypting'), 'loading');

    try {
      const url = `https://raw.githubusercontent.com/${repo}/${branch}/cluster/sealed.bin`;
      const resp = await fetch(url);
      if (!resp.ok) { msg(t('bs.exp.pw.noBin'), 'err'); return; }

      const cipher = await resp.text();
      const plain = await Crypto.unseal(cipher.trim(), pw);
      const data = JSON.parse(plain);

      localStorage.setItem('anvil_cluster_pw', pw);
      localStorage.setItem('anvil_seed_ip', data.seed_ip);
      localStorage.setItem('anvil_gossip_key', data.gossip_key);

      msg(t('bs.exp.pw.ok').replace('{ip}', data.seed_ip), 'ok');

      // Phase 2: show OIDC identity gate
      setTimeout(() => onDecrypted(data.seed_ip, data.gossip_key), 400);
    } catch (e) {
      msg(t('bs.exp.pw.err'), 'err');
    }
  });

  // Enter key to trigger decrypt
  container.querySelector('#exp-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-unseal')?.click();
  });
}

// ── OIDC identity gate (Phase 2 of expansion) ────────────

function _renderOidcGate(container, seedIP, gossipKey, repo, branch, status) {
  container.style.display = 'block';
  container.innerHTML = `
    <div class="section-divider"></div>
    <div class="status status-ok" style="margin-bottom:.8rem">🔓 Seed: <code>${esc(seedIP)}</code></div>
    <div class="seal-box" style="text-align:center;padding:2rem">
      <div style="font-size:2rem;margin-bottom:.5rem">🔑</div>
      <h4>${t('bs.exp.oidcRequired')}</h4>
      <p class="seal-desc">${t('bs.exp.oidcRequiredDesc')}</p>
      <button class="btn btn-primary" id="btn-exp-oidc-login">${t('nav.login')}</button>
    </div>`;

  document.getElementById('btn-exp-oidc-login').addEventListener('click', () => {
    if (typeof Auth.login === 'function') Auth.login();
  });

  // Poll for OIDC login completion
  let count = 0;
  const iv = setInterval(() => {
    count++;
    if (Auth.isLoggedIn()) {
      clearInterval(iv);
      _renderExpansionForm(container, seedIP, gossipKey, repo, branch, status);
    } else if (count > 120) {
      clearInterval(iv);
    }
  }, 1000);
}

function _renderExpansionForm(container, seedIP, gossipKey, repo, branch, status) {
  const f = _expansionFields || {};
  const collected = f._collected
    ? `<span class="collected-badge" title="${_collectedTitle(f)}">✓ ${t('bs.collected')}</span>`
    : '';

  container.style.display = 'block';
  container.innerHTML = `
    <div class="section-divider"></div>
    <div class="status status-ok" style="margin-bottom:.8rem">🔓 Seed: <code>${esc(seedIP)}</code></div>
    <div id="exp-paste-area"></div>
    <div id="exp-form"></div>
    <div class="section-divider"></div>
    <button class="btn btn-primary btn-lg" id="btn-generate-exp">${t('bs.exp.btn.join')}</button>`;

  _renderPasteArea(document.getElementById('exp-paste-area'), fields => {
    _expansionFields = fields;
    _renderExpansionForm(container, seedIP, gossipKey, repo, branch, status);
  });

  _renderExpForm(document.getElementById('exp-form'));
  document.getElementById('btn-generate-exp').addEventListener('click', () => _generateExpJoin(seedIP, gossipKey, repo, branch, status));
}

function _renderExpForm(container) {
  const f = _expansionFields || {};
  const collected = f._collected
    ? `<span class="collected-badge" title="${_collectedTitle(f)}">✓ ${t('bs.collected')}</span>`
    : '';

  container.innerHTML = `
    <div class="node-row">
      <div class="fg fg-name"><label>${t('bs.node.name')} ${collected}</label>
        <input type="text" id="exp-name" value="${esc(f.name||'')}" placeholder="node-name" readonly></div>
      <div class="fg fg-ip"><label>${t('bs.node.ip')}</label>
        <input type="text" id="exp-ip" value="${esc(f.ip||'')}" placeholder="x.x.x.x" readonly></div>
      <div class="fg fg-role"><label>${t('bs.node.role')}</label>
        <select id="exp-role">
          <option value="client">${t('bs.role.client')}</option>
          <option value="server">${t('bs.role.server')}</option>
        </select></div>
    </div>
    <div class="node-advanced">
      <button class="adv-toggle" type="button">⚙ ${t('bs.node.syscfg')} ${f._collected ? '●' : ''}</button>
      <div class="adv-body" style="display:none">
        <div class="fg"><label>Hostname</label>
          <input type="text" id="exp-hostname" value="${esc(f.hostname||'')}" readonly></div>
        <div class="fg"><label>Timezone</label>
          <input type="text" id="exp-timezone" value="${esc(f.timezone||'UTC')}" readonly></div>
        <div class="fg"><label>OS</label>
          <input type="text" id="exp-os" value="${esc(f.os||'linux')}" readonly></div>
        <div class="fg"><label>Network</label>
          <input type="text" id="exp-net" value="${esc(f.network||'dhcp')}" readonly></div>
      </div>
    </div>`;

  const toggle = container.querySelector('.adv-toggle');
  const body   = container.querySelector('.adv-body');
  if (toggle) toggle.addEventListener('click', () => {
    body.style.display = body.style.display === 'none' ? 'flex' : 'none';
  });
}

function _generateExpJoin(seedIP, gossipKey, repo, branch, status) {
  const f = _expansionFields;
  if (!f) {
    Output.showStatus(status, t('bs.exp.noCollect'), 'err');
    return;
  }

  const role = document.getElementById('exp-role')?.value || 'client';
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/bootstrap/compiled/join-${role}.sh`;

  let cmd = 'curl -s ' + url + ' | ';
  const envs = [];
  if (f.hostname) envs.push('NODE_HOSTNAME=' + _sq(f.hostname));
  if (f.timezone) envs.push('NODE_TZ=' + _sq(f.timezone));
  if (f.ip) envs.push('NODE_IP=' + _sq(f.ip));
  cmd += envs.join(' ') + ' ';

  cmd += "sh -s -- --gossip-key " + _sq(gossipKey);
  cmd += " --seed-addr " + _sq(seedIP);
  cmd += " --auto";

  const out = document.getElementById('output-container');
  Output.showStatus(status, t('bs.exp.ready'), 'ok');
  Output.renderCommands(out, [{
    name: f.hostname || f.name || 'node',
    role,
    isSeed: false,
    auto: true,
    url,
    cmd,
  }]);

  const note = document.createElement('div');
  note.className = 'status status-ok';
  note.style.marginTop = '.8rem';
  note.textContent = t('bs.exp.joinNote');
  out.appendChild(note);
}

// ── Shared helpers ────────────────────────────────────────

function _renderPasteArea(container, onApply) {
  container.innerHTML = `
    <div class="paste-area">
      <button class="paste-toggle" type="button">📋 ${t('bs.paste.toggle')}</button>
      <div class="paste-body" style="display:none">
        <p class="paste-hint">${t('bs.paste.hint')}</p>
        <textarea class="paste-input" rows="5" placeholder='${t('bs.paste.placeholder')}'></textarea>
        <button class="btn btn-sm paste-apply">${t('bs.paste.apply')}</button>
        <span class="paste-msg"></span>
      </div>
    </div>`;

  const toggle = container.querySelector('.paste-toggle');
  const body   = container.querySelector('.paste-body');
  const input  = container.querySelector('.paste-input');
  const apply  = container.querySelector('.paste-apply');
  const msg    = container.querySelector('.paste-msg');

  toggle.addEventListener('click', () => {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  });

  apply.addEventListener('click', () => {
    const raw = input.value.trim();
    if (!raw) { msg.textContent = '✗ ' + t('bs.paste.empty'); msg.className = 'paste-msg err'; return; }
    const r = parse(raw);
    if (!r.ok) { msg.textContent = '✗ ' + r.error; msg.className = 'paste-msg err'; return; }
    msg.textContent = `✓ ${t('bs.paste.ok')} → ${r.fields.name}`;
    msg.className = 'paste-msg ok';
    input.value = '';
    onApply(r.fields);
  });
}

function _bind(container, sel, fn) {
  const el = container.querySelector(sel);
  if (el) el.addEventListener('input', () => fn(el.value));
}

function _showSeedErrors(errors) {
  const el = document.getElementById('seed-errors');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = errors.map(e => `<span class="err">${esc(e)}</span>`).join('<br>');
}

function _collectedTitle(n) {
  if (!n._collected) return '';
  const c = n._collected;
  return [
    `OS: ${c.os_pretty}`, `Kernel: ${c.kernel}`, `Arch: ${c.arch}`,
    `Iface: ${c.best_iface}`, `IP: ${n.ip}`, `GW: ${c.best_gateway}`,
    `Mem: ${c.mem_mb}MB`, `Disk: ${c.disk_gb}GB (${c.disk_type})`, `CPU: ${c.cpu_cores} cores`,
    `Virt: ${c.virt_type}`,
    `Nomad: ${c.nomad_version || 'none'}`
  ].join('\n');
}
