// site/lib/oidc.js
// 职责：OIDC PKCE 流程
// 纯函数：codeVerifier, codeChallenge, buildAuthUrl, parseToken
// 副作用：exchange（fetch）

export function codeVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function codeChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(hash));
}

// 纯函数：构建授权 URL
export function buildAuthUrl(issuer, clientId, redirectUri, challenge, state) {
  return `${issuer}/oauth2/authorize?` + new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
}

// 副作用：持久化 OIDC 状态到 sessionStorage
export function persistOIDCState(verifier, state) {
  sessionStorage.setItem('oidc_state', state);
  sessionStorage.setItem('oidc_verifier', verifier);
}

export function popOIDCState() {
  const s = sessionStorage.getItem('oidc_state');
  const v = sessionStorage.getItem('oidc_verifier');
  sessionStorage.removeItem('oidc_state');
  sessionStorage.removeItem('oidc_verifier');
  return { state: s, verifier: v };
}

// 网络调用：交换 token
export async function exchange(issuer, clientId, redirectUri, code, verifier) {
  const r = await fetch(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  if (!r.ok) throw new Error(`OIDC exchange failed: ${r.status}`);
  return r.json();
}

// 纯函数：解析 JWT payload
export function parseToken(idToken) {
  try {
    const payload = idToken.split('.')[1];
    return JSON.parse(atob(payload));
  } catch { return {}; }
}

function base64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
