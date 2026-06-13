// site/pages/deploy.js
// 职责：Job 提交页
//  admin     → 直接提交 Nomad API
//  非 admin  → 挂起审批队列 (Nomad Variable anvil/approvals/<id>)

import * as Auth    from '../lib/auth.js';
import * as Nomad   from '../lib/nomad-client.js';
import * as DeployUI from '../ui/deploy.js';
import * as Output  from '../ui/output.js';
import { html as esc } from '../lib/escape.js';

let _cfg = {};

function nomadUrl() {
  return _cfg.nomadUrl || 'http://localhost:4647';
}

export function render(main, status, CFG) {
  _cfg = CFG;
  if (!Auth.isLoggedIn()) {
    main.innerHTML = `
      <div class="empty"><div class="empty-icon">🔑</div>
        <div class="empty-title">请先登录</div>
        <div class="empty-desc">Job 提交需要 OIDC 身份认证</div>
        <p class="text-muted" style="margin-top:1rem">
          Nomad API: <code>${esc(nomadUrl())}</code></p></div>`;
    return;
  }

  DeployUI.render(main, {
    repo: CFG.repo,
    branch: CFG.branch,
    onEvent: e => {
      if (e.type === 'submit') _confirm(status, e, CFG);
    },
  });
}

function _confirm(status, { values, hcl, template, label, requiresCI }, CFG) {
  const isAdmin = Auth.role() === 'admin';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">${isAdmin ? '📦 确认提交' : '📋 提交审批'} — ${esc(label || template)}${requiresCI ? ' <span class="badge-ci">🔧 CI</span>' : ''}</div>
      <div class="modal-body">
        <label>参数:</label>
        <pre class="hcl-preview">${esc(JSON.stringify(values, null, 2))}</pre>
        <label>HCL:</label>
        <pre class="hcl-preview">${esc(hcl)}</pre>
        <div class="fg">
          <label>目标 Nomad</label>
          <input type="text" id="md-nomad-url" value="${esc(nomadUrl())}" style="width:100%">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="md-cancel">取消</button>
        <button class="btn btn-primary" id="md-confirm">${isAdmin ? '提交到 Nomad' : '提交审批'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#md-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#md-confirm').addEventListener('click', async () => {
    const url = overlay.querySelector('#md-nomad-url').value.trim();
    localStorage.setItem('anvil_nomad_url', url);
    overlay.remove();

    if (isAdmin) {
      await _submitDirect(status, url, hcl);
    } else {
      await _submitApproval(status, url, template, label, requiresCI, values, hcl);
    }
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function _submitDirect(status, url, hcl) {
  Output.showStatus(status, '提交到 Nomad...', 'loading');
  try {
    const token = Auth.load()?.access_token;
    const result = await Nomad.submitJobHCL(url, token, hcl);
    Output.showStatus(status, `✅ 已部署 — EvalID: ${result.EvalID || 'ok'}`, 'ok');
  } catch (err) {
    Output.showStatus(status, `提交失败: ${err.message}`, 'err');
  }
}

async function _submitApproval(status, url, template, label, requiresCI, values, hcl) {
  Output.showStatus(status, '推送到审批队列...', 'loading');

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const approval = {
    template,
    values,
    hcl,
    submitter: Auth.userName(),
    role: Auth.role(),
    timestamp: new Date().toISOString(),
    status: 'pending',
  };

  try {
    const items = [
      { Key: 'template',    Value: btoa(template) },
      { Key: 'values',      Value: btoa(JSON.stringify(values)) },
      { Key: 'hcl',         Value: btoa(hcl) },
      { Key: 'submitter',   Value: btoa(Auth.userName()) },
      { Key: 'role',        Value: btoa(Auth.role()) },
      { Key: 'timestamp',   Value: btoa(approval.timestamp) },
      { Key: 'status',      Value: btoa('pending') },
    ];
    if (label)      items.push({ Key: 'label',       Value: btoa(label) });
    if (requiresCI) items.push({ Key: 'requires_ci', Value: btoa('true') });

    const token = Auth.load()?.access_token;
    await Nomad.putVar(url, token, `anvil/approvals/${id}`, items);
    Output.showStatus(status, `✅ 已提交审批 — 等待管理员处理${requiresCI ? ' (需 CI 编译)' : ''}`, 'ok');
  } catch (err) {
    Output.showStatus(status, `审批提交失败: ${err.message}`, 'err');
  }
}
