// site/pages/approval.js
// 职责：审批队列 —— 管理员查看待办、同意/拒绝
//   普通 Job  → 直推 Nomad
//   CI Job    → 推 Git → 盲编译 → 回执 → Nomad
// 数据源：Nomad Variables (anvil/approvals/*)
// admin only

import * as Nomad    from '../lib/nomad-client.js';
import * as GitHub   from '../lib/github-client.js';
import * as Auth     from '../lib/auth.js';
import * as Output   from '../ui/output.js';
import { html as esc } from '../lib/escape.js';

const PREFIX = 'anvil/approvals/';

export function render(main, status, CFG) {
  if (Auth.role() !== 'admin') {
    main.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div>
      <div class="empty-title">仅管理员可访问</div></div>`;
    return;
  }

  main.innerHTML = `
    <div class="approval-layout">
      <div class="approval-header">
        <h3>📋 审批队列</h3>
        <div class="fg-inline">
          <label>Nomad API</label>
          <input type="text" id="ap-nomad-url"
            value="${esc(CFG.nomadUrl)}"
            placeholder="http://<seed>:4647" style="width:220px">
          <button class="btn" id="ap-refresh">刷新</button>
        </div>
      </div>
      <div id="ap-list"><div class="spinner"></div></div>
      <div id="ap-detail" style="display:none"></div>
    </div>`;

  document.getElementById('ap-refresh').addEventListener('click', () => _load(status, CFG));
  _load(status, CFG);
}

async function _load(status, CFG) {
  const listEl = document.getElementById('ap-list');
  const url = document.getElementById('ap-nomad-url').value.trim();
  localStorage.setItem('anvil_nomad_url', url);

  if (!url) {
    listEl.innerHTML = '<div class="empty"><p>请输入 Nomad API 地址</p></div>';
    return;
  }

  listEl.innerHTML = '<div class="spinner"></div>';
  const token = Auth.load()?.access_token;

  try {
    const vars = await Nomad.listVars(url, token, PREFIX);
    // Nomad Variables API returns { Keys: [...], ... } for list, or { Data: [...] }
    const keys = vars.Keys || vars.Data || [];
    if (!keys.length) {
      listEl.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><p>无待审批项</p></div>';
      return;
    }

    const items = [];
    for (const key of keys) {
      try {
        const path = typeof key === 'string' ? key : key.Path || key.Key || '';
        if (!path) continue;
        const v = await Nomad.getVar(url, token, path);
        const data = _decodeItems(v.Items || []);
        if (data.status === 'pending') items.push({ ...data, _path: path });
      } catch { /* skip corrupt */ }
    }

    if (!items.length) {
      listEl.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><p>无待审批项</p></div>';
      return;
    }

    listEl.innerHTML = items.map((a, i) => `
      <div class="ap-item" data-idx="${i}">
        <div class="ap-item-left">
          <span class="ap-icon">📦</span>
          <div>
            <strong>${esc(a.template || 'unknown')}</strong>
            <span class="ap-meta">${esc(a.submitter || '?')} (${esc(a.role || '?')}) · ${esc(_fmtTime(a.timestamp))}</span>
          </div>
        </div>
        <div class="ap-item-right">
          <button class="btn btn-sm btn-primary ap-review" data-idx="${i}">审查</button>
        </div>
      </div>`).join('');

    listEl.querySelectorAll('.ap-review').forEach(btn => {
      btn.addEventListener('click', () => _review(items[btn.dataset.idx], url, status, CFG));
    });

  } catch (err) {
    listEl.innerHTML = `<div class="status status-err">加载失败: ${esc(err.message)}</div>`;
  }
}

function _review(item, url, status, CFG) {
  const detailEl = document.getElementById('ap-detail');
  const isCI = item.requires_ci === 'true';
  detailEl.style.display = 'block';
  detailEl.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span>📦 审查 — ${esc(item.label || item.template)}${isCI ? ' <span class="badge-ci">🔧 需 CI 编译</span>' : ''}</span>
        <span class="text-muted">提交者: ${esc(item.submitter)} (${esc(item.role)}) · ${esc(_fmtTime(item.timestamp))}</span>
      </div>
      <div class="card-body">
        <label>参数:</label>
        <pre class="hcl-preview">${esc(item.values)}</pre>
        <label>HCL${isCI ? ' (骨架 — CI 将编译为完全体)' : ''}:</label>
        <pre class="hcl-preview">${esc(item.hcl)}</pre>
        ${isCI ? `
        <div class="fg">
          <label>GitHub PAT (CI 推送用)</label>
          <input type="password" id="ap-gh-pat" placeholder="ghp_..." style="width:100%">
        </div>` : ''}
        <div class="btn-row">
          <button class="btn btn-danger" id="ap-reject">❌ 拒绝</button>
          <button class="btn btn-primary" id="ap-approve">✅ ${isCI ? 'CI 编译并提交' : '批准并提交'}</button>
        </div>
      </div>
    </div>`;

  document.getElementById('ap-approve').addEventListener('click', () => _approve(item, url, status, CFG));
  document.getElementById('ap-reject').addEventListener('click', () => _reject(item, url, status));
}

async function _approve(item, url, status, CFG) {
  const isCI = item.requires_ci === 'true';

  if (isCI) {
    await _approveCI(item, url, status, CFG);
  } else {
    await _approveDirect(item, url, status);
  }
}

// 轨道 A: 直推 Nomad (普通 Job)
async function _approveDirect(item, url, status) {
  Output.showStatus(status, '提交到 Nomad...', 'loading');

  try {
    const token = Auth.load()?.access_token;
    const result = await Nomad.submitJobHCL(url, token, item.hcl);

    // 清理审批变量
    try { await Nomad.deleteVar(url, token, item._path); } catch { /* ok */ }

    Output.showStatus(status, `✅ 已部署 — EvalID: ${result.EvalID || 'ok'}`, 'ok');
    document.getElementById('ap-detail').style.display = 'none';
    document.getElementById('ap-refresh').click();

  } catch (err) {
    Output.showStatus(status, `部署失败: ${err.message}`, 'err');
  }
}

// 轨道 B: CI 盲编译 → Nomad (基础设施变更)
async function _approveCI(item, url, status, CFG) {
  const ghToken = document.getElementById('ap-gh-pat')?.value.trim();
  if (!ghToken) {
    Output.showStatus(status, '请输入 GitHub PAT', 'err');
    return;
  }
  localStorage.setItem('anvil_gh_pat', ghToken);

  const id = item._path.replace(/^.*\//, '');
  const compilePath = `anvil/compilations/${id}`;

  Output.showStatus(status, '推送到 GitHub 触发 CI 盲编译...', 'loading');

  try {
    // 1. 推送 HCL + 参数 到 GitHub
    const pushResult = await GitHub.pushFiles(ghToken, CFG.repo, CFG.branch, [
      { path: `${compilePath}/job.hcl`,    content: item.hcl },
      { path: `${compilePath}/values.json`, content: item.values },
    ], `[anvil] CI compile: ${item.template}`);

    // 2. 轮询 CI
    Output.showStatus(status, `CI 编译中 (commit: ${pushResult.sha.slice(0, 7)})...`, 'loading');
    const ci = await GitHub.pollCI(ghToken, CFG.repo, pushResult.sha);
    if (!ci.success) {
      Output.showStatus(status, `❌ CI 编译失败 — 查看: ${pushResult.url}`, 'err');
      return;
    }

    Output.showStatus(status, 'CI 通过，拉取编译结果...', 'loading');

    // 3. 拉取 CI 编译产物
    let compiledHCL = item.hcl; // 兜底: 原 HCL
    try {
      const resultUrl = `https://raw.githubusercontent.com/${CFG.repo}/${CFG.branch}/${compilePath}/result.hcl`;
      const r = await fetch(resultUrl);
      if (r.ok) compiledHCL = await r.text();
    } catch {
      // 无编译产物 — 用原 HCL (CI 已通过语法校验)
    }

    // 4. 提交到 Nomad
    const token = Auth.load()?.access_token;
    const result = await Nomad.submitJobHCL(url, token, compiledHCL);

    // 5. 清理审批变量
    try { await Nomad.deleteVar(url, token, item._path); } catch { /* ok */ }

    Output.showStatus(status, `✅ CI 编译通过 → 已部署 — EvalID: ${result.EvalID || 'ok'}`, 'ok');
    document.getElementById('ap-detail').style.display = 'none';
    document.getElementById('ap-refresh').click();

  } catch (err) {
    Output.showStatus(status, `CI 流程失败: ${err.message}`, 'err');
  }
}

async function _reject(item, url, status) {
  try {
    const token = Auth.load()?.access_token;
    await Nomad.deleteVar(url, token, item._path);
    Output.showStatus(status, '已拒绝并清理', 'ok');
    document.getElementById('ap-detail').style.display = 'none';
    document.getElementById('ap-refresh').click();
  } catch (err) {
    Output.showStatus(status, `拒绝失败: ${err.message}`, 'err');
  }
}

function _decodeItems(items) {
  const m = {};
  for (const it of items) {
    try { m[it.Key] = atob(it.Value); } catch { m[it.Key] = it.Value; }
  }
  return {
    template: m.template || '',
    label: m.label || '',
    values: m.values || '{}',
    hcl: m.hcl || '',
    submitter: m.submitter || '',
    role: m.role || '',
    timestamp: m.timestamp || '',
    status: m.status || 'pending',
    requires_ci: m.requires_ci || '',
  };
}

function _fmtTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return ts || ''; }
}
