// site/ui/login.js
// 职责：登录按钮 + 用户状态显示
// 纯 DOM 视图

import { html as esc } from '../lib/escape.js';
import * as Auth from '../lib/auth.js';

export function render(container, { loginUrl, onLogin, onLogout }) {
  if (Auth.isLoggedIn()) {
    container.innerHTML = `
      <span class="lu-name">${esc(Auth.userName())}</span>
      <span class="lu-role">${Auth.role()}</span>
      <button class="btn btn-sm btn-outline" id="btn-logout">退出</button>`;
    container.querySelector('#btn-logout').addEventListener('click', () => {
      Auth.clear();
      onLogout();
    });
  } else {
    container.innerHTML = `
      <button class="btn btn-sm" id="btn-login">🔑 登录</button>`;
    container.querySelector('#btn-login').addEventListener('click', () => {
      if (loginUrl) window.location.href = loginUrl;
      onLogin?.();
    });
  }
}
