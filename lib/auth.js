// site/lib/auth.js
// 职责：会话管理 + 角色解析
// 存储：sessionStorage

import { parseToken } from './oidc.js';

const K = 'anvil_auth';

export function save(tokens) {
  sessionStorage.setItem(K, JSON.stringify({
    access_token: tokens.access_token,
    id_token: tokens.id_token,
    claims: tokens.id_token ? parseToken(tokens.id_token) : {},
  }));
}

export function load() {
  const raw = sessionStorage.getItem(K);
  return raw ? JSON.parse(raw) : null;
}

export function clear() { sessionStorage.removeItem(K); }

export function isLoggedIn() { return !!load()?.access_token; }

export function claims() { return load()?.claims || {}; }

export function role() {
  const c = claims();
  if (c.groups?.includes('admin')) return 'admin';
  if (c.groups?.includes('devops')) return 'devops';
  return c.groups?.[0] || 'anonymous';
}

export function can(requiredRole) {
  const r = role();
  if (requiredRole === 'admin' && r !== 'admin') return false;
  if (requiredRole === 'devops' && !['admin', 'devops'].includes(r)) return false;
  return true;
}

export function userName() {
  const c = claims();
  return c.name || c.preferred_username || c.email || c.sub || 'Anonymous';
}
