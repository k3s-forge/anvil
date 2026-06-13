// site/app.js
// anvil — 应用壳
// 职责：配置、路由、导航、OIDC 回调
// 页面渲染委托给 pages/
// 全局状态仅此文件持有

import * as OIDC    from './lib/oidc.js';
import * as Auth    from './lib/auth.js';
import * as Output  from './ui/output.js';
import * as LoginUI from './ui/login.js';
import { html as esc } from './lib/escape.js';

// 页面模块按需动态加载（避免静态 import 被浏览器模块缓存锁死）
const PAGES = {
  bootstrap:  () => import('./pages/bootstrap.js'),
  deploy:     () => import('./pages/deploy.js'),
  approval:   () => import('./pages/approval.js'),
  audit:      () => import('./pages/audit.js'),
  maintenance:() => import('./pages/maintenance.js'),
};

// ---- Config ----
const CFG = {
  repo:   localStorage.getItem('anvil_repo')   || 'k3s-forge/nomad-gitops',
  branch: localStorage.getItem('anvil_branch') || 'main',
  oidcIssuer:   localStorage.getItem('anvil_oidc_issuer')   || '',
  oidcClientId: localStorage.getItem('anvil_oidc_client_id') || '',
};

// ---- 全局状态 ----
window._anvil = { CFG, page: 'bootstrap' };

// ---- 入口 ----
export function init() {
  _checkOIDCCallback();
  _renderShell();
  window._anvil.page = _getPageFromHash();
  _renderPage();
  window.addEventListener('hashchange', () => {
    const next = _getPageFromHash();
    if (next !== window._anvil.page) {
      window._anvil.page = next;
      _renderPage();
    }
  });
}

// ---- OIDC 回调 ----
async function _checkOIDCCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code) return;

  const oidc = OIDC.popOIDCState();
  if (!oidc.state || oidc.state !== state) return;

  try {
    const tokens = await OIDC.exchange(
      CFG.oidcIssuer, CFG.oidcClientId,
      window.location.origin + window.location.pathname,
      code, oidc.verifier
    );
    Auth.save(tokens);
  } catch (err) {
    Output.showStatus(document.getElementById('status-area'),
      `OIDC 登录失败: ${err.message}`, 'err');
  }
  history.replaceState(null, '', window.location.pathname);
}

// ---- Shell ----
function _renderShell() {
  document.getElementById('app').innerHTML = `
    <nav class="nav">
      <div class="nav-brand"><span class="nav-logo">◆</span> anvil</div>
      <div class="nav-links" id="nav-links"></div>
      <div class="nav-user" id="nav-user"></div>
    </nav>
    <main id="main" class="container"></main>
    <div id="status-area"></div>`;
  _renderNav();
  _renderLogin();
}

function _renderNav() {
  const p = window._anvil.page;
  const items = [
    { id: 'bootstrap', label: '🚀 冷启动' },
    { id: 'deploy',    label: '📦 Job 提交' },
  ];
  if (Auth.role() === 'admin') items.push(
    { id: 'approval',    label: '📋 审批' },
    { id: 'maintenance', label: '🔧 维护' },
    { id: 'audit',       label: '📊 审计' }
  );

  document.getElementById('nav-links').innerHTML = items.map(i =>
    `<a href="#${i.id}" class="nav-link${p===i.id?' active':''}" data-page="${i.id}">${i.label}</a>`
  ).join('');

  document.getElementById('nav-links').addEventListener('click', e => {
    const a = e.target.closest('[data-page]');
    if (a) {
      e.preventDefault();
      if (a.dataset.page !== window._anvil.page) {
        window._anvil.page = a.dataset.page;
        window.location.hash = a.dataset.page;
        _renderPage();
      }
    }
  });
}

async function _renderLogin() {
  // 构建 OIDC 登录 URL
  let loginUrl = '';
  if (CFG.oidcIssuer && CFG.oidcClientId) {
    const verifier = OIDC.codeVerifier();
    const challenge = await OIDC.codeChallenge(verifier);
    const state = OIDC.codeVerifier();
    OIDC.persistOIDCState(verifier, state);
    loginUrl = OIDC.buildAuthUrl(
      CFG.oidcIssuer, CFG.oidcClientId,
      window.location.origin + window.location.pathname,
      challenge, state
    );
  }

  LoginUI.render(document.getElementById('nav-user'), {
    loginUrl,
    onLogout: () => {
      _renderPage();
    },
    onLogin: () => _renderLogin(),
  });
}

// ---- 路由 ----
function _getPageFromHash() {
  const h = window.location.hash.replace('#', '');
  return h || 'bootstrap';
}

async function _renderPage() {
  const page = window._anvil.page;
  _renderNav();
  const main = document.getElementById('main');
  const status = document.getElementById('status-area');
  status.innerHTML = '';

  const loader = PAGES[page];
  if (!loader) {
    window._anvil.page = 'bootstrap';
    return _renderPage();
  }
  const mod = await loader();
  mod.render(main, status, CFG);
}
