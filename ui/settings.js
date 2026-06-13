// site/ui/settings.js
// 职责：全局设置弹窗 —— OIDC、Nomad、GitHub
// 无状态视图

import { html as esc } from '../lib/escape.js';

const FIELDS = [
  { key: 'anvil_oidc_issuer',   label: 'OIDC Issuer',        placeholder: 'https://idp.example.com', desc: 'Kanidm / Keycloak / Auth0 的身份中心地址' },
  { key: 'anvil_oidc_client_id',label: 'OIDC Client ID',      placeholder: 'anvil',                  desc: '在身份中心注册的客户端 ID' },
  { key: 'anvil_nomad_url',     label: 'Nomad API',           placeholder: 'http://<seed>:4647',     desc: '种子机 Nginx 反代端口（集群上线后填写）' },
  { key: 'anvil_github_pat',    label: 'GitHub PAT',          placeholder: 'github_pat_...',         desc: 'Contents: Read & Write 权限，用于模板加载和 CI 触发' },
  { key: 'anvil_repo',          label: '仓库',                placeholder: 'owner/repo',             desc: 'GitHub 仓库，存放模板和 HCL' },
];

export function open() {
  // 移除已有弹窗
  document.getElementById('settings-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'settings-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal settings-modal">
      <div class="modal-header">⚙️ 全局设置</div>
      <div class="modal-body">
        ${FIELDS.map(f => `
          <div class="fg">
            <label>${esc(f.label)} <span class="hint">${esc(f.desc)}</span></label>
            <input type="${f.key.includes('pat') || f.key.includes('client') ? 'password' : 'text'}"
              id="set-${esc(f.key)}" value="${esc(localStorage.getItem(f.key) || '')}"
              placeholder="${esc(f.placeholder)}">
          </div>
        `).join('')}
        <p class="text-muted" style="font-size:.72rem;margin-top:.5rem">
          设置保存在浏览器本地，不会上传到任何服务器。</p>
      </div>
      <div class="modal-footer">
        <button class="btn" id="set-cancel">取消</button>
        <button class="btn btn-primary" id="set-save">保存</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('#set-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#set-save').addEventListener('click', () => {
    for (const f of FIELDS) {
      const val = document.getElementById(`set-${f.key}`)?.value.trim() || '';
      localStorage.setItem(f.key, val);
    }
    overlay.remove();
    // 触发全局刷新
    window.dispatchEvent(new CustomEvent('anvil:settings-changed'));
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  // 自动聚焦第一个空字段
  setTimeout(() => {
    for (const f of FIELDS) {
      const el = document.getElementById(`set-${f.key}`);
      if (el && !el.value) { el.focus(); break; }
    }
  }, 100);
}
