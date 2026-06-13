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

let nodes = [Topo.createNode('seed-1', '', 'server')];

export function render(main, status, CFG) {
  main.innerHTML = `
    <div class="coldstart-layout">
      <div class="coldstart-left">
        <h3>🖥️ 集群节点</h3>
        <div id="topo-container"></div>
        <div class="err-list" id="topo-errors" style="display:none"></div>
        <button class="btn btn-primary btn-lg" id="btn-generate">⚡ 生成启动命令</button>
        <div class="section-divider"></div>
        <h3>🔑 凭证</h3>
        <div id="creds-container"></div>
      </div>
      <div class="coldstart-right" id="output-container">
        <div class="empty"><div class="empty-icon">📋</div>
          <div class="empty-title">在左侧填写集群拓扑与凭证，然后点击「生成启动命令」</div>
          <div class="empty-desc">Gossip 密钥留空自动生成，永不离开浏览器</div></div>
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
    Output.showStatus(status, '请输入 GitHub PAT', 'err');
    return;
  }

  const repo = creds.repo || CFG.repo;
  const branch = creds.branch || CFG.branch;
  const gossipKey = creds.gossipKey || Crypto.generateKey();
  const keyHash = await Crypto.sha256Hex(gossipKey);
  const hcl = HCL.build(nodes, { datacenter: 'dc1' }, keyHash);

  const out = document.getElementById('output-container');
  Output.showStatus(status, '推送 HCL 到 GitHub...', 'loading');

  try {
    const push = await GitHub.pushFiles(creds.githubPat, repo, branch,
      [{ path: 'bootstrap/pending/topology.hcl', content: hcl, mode: '100644' }],
      'coldstart: topology from anvil');
    Output.showStatus(status, `已推送 → CI 编译中…`, 'loading');

    const ci = await GitHub.pollCI(creds.githubPat, repo, push.sha, 600000);
    if (!ci.success) {
      Output.showStatus(status, `CI 失败。${ci.runs.filter(r=>r.conclusion!=='success').map(r=>r.name).join(', ')}`, 'err');
      return;
    }

    // 编译产物：仅 Server 节点
    const srvNodes = nodes.filter(n => n.role === 'server');
    const clientNodes = nodes.filter(n => n.role === 'client');
    const scripts = srvNodes.map(n => ({
      name: n.name,
      url: `https://raw.githubusercontent.com/${repo}/${branch}/bootstrap/compiled/${n.name}.sh`,
    }));

    const cmds = Cmd.build(scripts, gossipKey, nodes);
    Output.showStatus(status, `✅ Server 编译完成`, 'ok');
    Output.renderCommands(out, cmds, status);

    // 后续指引
    const guide = document.createElement('div');
    guide.className = 'bootstrap-guide';
    const clientNote = clientNodes.length
      ? `<p class="text-muted">⚡ Client 节点（${clientNodes.map(n=>n.name).join('、')}）在集群上线后通过 Nomad join 命令加入，无需冷启动脚本。</p>`
      : '';
    guide.innerHTML = `
      <div class="section-divider"></div>
      <h4>📋 执行顺序</h4>
      <ol class="guide-steps">
        <li><strong>先</strong> SSH 到种子机，粘贴执行 🥇 命令</li>
        <li>等待种子机启动完成，终端打印 <code>NOMAD MANAGEMENT TOKEN</code> — <strong>务必保存</strong></li>
        <li><strong>再</strong> SSH 到其余 Server，依次执行 🥈 命令</li>
        <li>脚本自动：安装 Nomad → 加入 Raft → 部署 Kanidm + Nginx 反代</li>
      </ol>
      ${clientNote}
      <p class="text-muted" style="margin-top:.75rem">集群上线后回到 <a href="#deploy">📦 Job 提交</a> 页面登录并提交业务任务。</p>`;
    out.appendChild(guide);

    // HCL 骨架折叠
    const details = document.createElement('details');
    details.className = 'hcl-details';
    details.innerHTML = `<summary>📄 已推送的 HCL 骨架</summary><pre class="hcl-preview">${esc(hcl)}</pre>`;
    out.appendChild(details);
  } catch (err) {
    Output.showStatus(status, `失败: ${err.message}`, 'err');
  }
}

function _showTopoErrors(errors) {
  const el = document.getElementById('topo-errors');
  el.style.display = 'block';
  el.innerHTML = errors.map(e => `<span class="err">${esc(e)}</span>`).join('<br>');
}
