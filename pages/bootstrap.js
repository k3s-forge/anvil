// site/pages/bootstrap.js
// 职责：冷启动页 —— 填拓扑 → 推 HCL → CI → curl 命令
// 状态：nodes（页面级，不上全局）

import * as Crypto  from '../lib/crypto.js';
import * as Topo    from '../lib/topology.js';
import * as HCL     from '../lib/hcl-builder.js';
import * as GitHub  from '../lib/github-client.js';
import * as Cmd     from '../lib/cmd-builder.js';
import * as TopoUI  from '../ui/topology-form.js';
import * as CredUI  from '../ui/credential-form.js';
import * as Output  from '../ui/output.js';
import { html as esc } from '../lib/escape.js';
import { t } from '../lib/i18n.js';

let nodes = [Topo.createNode('seed-1', '', 'server')];

export function render(main, status, CFG) {
  main.innerHTML = `
    <div class="coldstart-layout">
      <div class="coldstart-left">
        <h3>${t('bs.heading')}</h3>
        <div id="topo-container"></div>
        <div class="err-list" id="topo-errors" style="display:none"></div>
        <button class="btn btn-primary btn-lg" id="btn-generate">${t('bs.btn.generate')}</button>
        <div class="section-divider"></div>
        <h3>${t('bs.creds.heading')}</h3>
        <div id="creds-container"></div>
      </div>
      <div class="coldstart-right" id="output-container">
        <div class="empty"><div class="empty-icon">📋</div>
          <div class="empty-title">${t('bs.output.empty')}</div>
          <div class="empty-desc">${t('bs.output.emptySub')}</div></div>
      </div>
    </div>`;

  CredUI.render(document.getElementById('creds-container'));
  _renderTopoUI(document.getElementById('topo-container'));
  document.getElementById('btn-generate').addEventListener('click', () => _generate(status, CFG));
}

function _renderTopoUI(container) {
  TopoUI.render(container, nodes, e => {
    if (e.type === 'add')                        { nodes = Topo.addNode(nodes); _renderTopoUI(container); }
    else if (e.type === 'remove')                { nodes = Topo.removeNode(nodes, e.id); _renderTopoUI(container); }
    else if (e.type === 'update' && e.field === 'role')
      { nodes = Topo.updateNode(nodes, e.id, e.field, e.value); _renderTopoUI(container); }
    else if (e.type === 'update')
      { nodes = Topo.updateNode(nodes, e.id, e.field, e.value); }
  });
}

async function _generate(status, CFG) {
  const creds = CredUI.getValues();
  const v = Topo.validate(nodes);
  if (!v.valid) {
    _showTopoErrors(v.errors);
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
      'coldstart: topology from anvil');
    Output.showStatus(status, t('bs.output.pushed'), 'loading');

    const ci = await GitHub.pollCI(creds.githubPat, repo, push.sha, 600000);
    if (!ci.success) {
      Output.showStatus(status, `${t('bs.output.ciFail')}: ${ci.runs.filter(r=>r.conclusion!=='success').map(r=>r.name).join(', ')}`, 'err');
      return;
    }

    const srvNodes = nodes.filter(n => n.role === 'server');
    const clientNodes = nodes.filter(n => n.role === 'client');
    const scripts = srvNodes.map(n => ({
      name: n.name,
      url: `https://raw.githubusercontent.com/${repo}/${branch}/bootstrap/compiled/${n.name}.sh`,
    }));

    const cmds = Cmd.build(scripts, gossipKey, nodes);
    Output.showStatus(status, t('bs.output.ciOK'), 'ok');
    Output.renderCommands(out, cmds);

    const guide = document.createElement('div');
    guide.className = 'bootstrap-guide';
    const clientNote = clientNodes.length
      ? `<p class="text-muted">${t('bs.guide.clientNote', {names: clientNodes.map(n=>n.name).join(', ')})}</p>`
      : '';
    guide.innerHTML = `
      <div class="section-divider"></div>
      <h4>${t('bs.guide.title')}</h4>
      <ol class="guide-steps">
        <li>${t('bs.guide.step1')}</li>
        <li>${t('bs.guide.step2')}</li>
        <li>${t('bs.guide.step3')}</li>
        <li>${t('bs.guide.step4')}</li>
      </ol>
      ${clientNote}
      <p class="text-muted" style="margin-top:.75rem">${t('bs.guide.after')}</p>`;
    out.appendChild(guide);

    const details = document.createElement('details');
    details.className = 'hcl-details';
    details.innerHTML = `<summary>${t('bs.hcl.title')}</summary><pre class="hcl-preview">${esc(hcl)}</pre>`;
    out.appendChild(details);
  } catch (err) {
    Output.showStatus(status, `${t('bs.output.error')}: ${err.message}`, 'err');
  }
}

function _showTopoErrors(errors) {
  const el = document.getElementById('topo-errors');
  el.style.display = 'block';
  el.innerHTML = errors.map(e => `<span class="err">${esc(e)}</span>`).join('<br>');
}
