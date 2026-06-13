// site/ui/login.js
// 职责：登录按钮 + 用户状态显示
// 纯 DOM 视图

import { html as esc } from '../lib/escape.js';
import * as Auth from '../lib/auth.js';
import { t } from '../lib/i18n.js';

export function render(container, { loginUrl, onLogin, onLogout }) {
  if (Auth.isLoggedIn()) {
    container.innerHTML = `
      <span class="lu-name">${esc(Auth.userName())}</span>
      <span class="lu-role">${Auth.role()}</span>
      <button class="btn btn-sm btn-outline" id="btn-logout">${t('login.logout')}</button>`;
    container.querySelector('#btn-logout').addEventListener('click', () => {
      Auth.clear();
      onLogout();
    });
  } else {
    container.innerHTML = `
      <button class="btn btn-sm" id="btn-login">${t('login.btn')}</button>`;
    container.querySelector('#btn-login').addEventListener('click', () => {
      if (loginUrl) window.location.href = loginUrl;
      onLogin?.();
    });
  }
}
