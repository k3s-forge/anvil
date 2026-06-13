// site/ui/settings.js
// 职责：全局设置弹窗 —— OIDC、Nomad、GitHub、主题、语言
// 无状态视图

import { html as esc } from '../lib/escape.js';
import { t, detect, set as setLang, supported } from '../lib/i18n.js';

const FIELDS = [
  { key: 'anvil_oidc_issuer',   lbl: 'set.oidcIssuer',    ph: 'https://idp.example.com', desc: 'set.desc.oidcIssuer' },
  { key: 'anvil_oidc_client_id',lbl: 'set.oidcClientId',   ph: 'anvil',                  desc: 'set.desc.oidcClientId' },
  { key: 'anvil_nomad_url',     lbl: 'set.nomadUrl',       ph: 'http://<seed>:4647',     desc: 'set.desc.nomadUrl' },
  { key: 'anvil_github_pat',    lbl: 'set.githubPat',      ph: 'github_pat_...',         desc: 'set.desc.githubPat' },
  { key: 'anvil_repo',          lbl: 'set.repo',           ph: 'owner/repo',             desc: 'set.desc.repo' },
];

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function applyTheme(theme) {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('anvil_theme', theme);
}

export function initTheme() {
  const stored = localStorage.getItem('anvil_theme') || 'dark';
  applyTheme(stored);

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('anvil_theme') === 'auto') applyTheme('auto');
  });
}

export function open() {
  document.getElementById('settings-modal')?.remove();

  const lang = detect();
  const theme = localStorage.getItem('anvil_theme') || 'dark';
  const langs = supported();

  const overlay = document.createElement('div');
  overlay.id = 'settings-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal settings-modal">
      <div class="modal-header">${t('set.title')}</div>
      <div class="modal-body">
        <div class="fg">
          <label>${t('set.theme')}</label>
          <div class="theme-switch">
            <button data-theme="light" class="${theme==='light'?'active':''}">${t('set.theme.light')}</button>
            <button data-theme="dark"  class="${theme==='dark'?'active':''}">${t('set.theme.dark')}</button>
            <button data-theme="auto"  class="${theme==='auto'?'active':''}">${t('set.theme.auto')}</button>
          </div>
        </div>
        <div class="fg">
          <label>${t('set.lang')}</label>
          <div class="lang-switch">
            ${langs.map(l => `<button data-lang="${l}" class="${l===lang?'active':''}">${l}</button>`).join('')}
          </div>
        </div>
        ${FIELDS.map(f => `
          <div class="fg">
            <label>${t(f.lbl)} <span class="hint">${t(f.desc)}</span></label>
            <input type="${f.key.includes('pat') || f.key.includes('client') ? 'password' : 'text'}"
              id="set-${esc(f.key)}" value="${esc(localStorage.getItem(f.key) || '')}"
              placeholder="${esc(f.ph)}">
          </div>
        `).join('')}
        <p class="text-muted" style="font-size:.72rem;margin-top:.5rem">
          ${t('set.localNote')}</p>
      </div>
      <div class="modal-footer">
        <button class="btn" id="set-cancel">${t('set.cancel')}</button>
        <button class="btn btn-primary" id="set-save">${t('set.save')}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // 主题切换
  overlay.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      overlay.querySelectorAll('[data-theme]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 语言切换
  overlay.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      overlay.remove();
      open(); // 重新打开以刷新文字
    });
  });

  overlay.querySelector('#set-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#set-save').addEventListener('click', () => {
    for (const f of FIELDS) {
      const val = document.getElementById(`set-${f.key}`)?.value.trim() || '';
      localStorage.setItem(f.key, val);
    }
    overlay.remove();
    window.dispatchEvent(new CustomEvent('anvil:settings-changed'));
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  setTimeout(() => {
    for (const f of FIELDS) {
      const el = document.getElementById(`set-${f.key}`);
      if (el && !el.value) { el.focus(); break; }
    }
  }, 100);
}
