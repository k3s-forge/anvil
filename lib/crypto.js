// site/lib/crypto.js
// 职责：密钥生成、哈希、集群密钥封/解（PBKDF2 + AES-256-GCM）
// 零外部依赖，零副作用

const ITER = 600000;               // PBKDF2 iterations
const SALT_LEN = 16;
const IV_LEN = 12;                 // AES-GCM nonce

export function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// ── Cluster password: seal / unseal ────────────────────────

/** PBKDF2 → AES-256-GCM encrypt. Returns base64(salt + iv + ciphertext). */
export async function seal(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv   = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key  = await _derive(password, salt);
  const enc  = new TextEncoder().encode(plaintext);
  const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
  // salt | iv | ciphertext → base64
  const buf = new Uint8Array(salt.length + iv.length + ct.byteLength);
  buf.set(salt, 0);
  buf.set(iv, salt.length);
  buf.set(new Uint8Array(ct), salt.length + iv.length);
  return btoa(String.fromCharCode(...buf));
}

/** Reverse of seal(). Throws on wrong password or corruption. */
export async function unseal(b64, password) {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const salt   = raw.slice(0, SALT_LEN);
  const iv     = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ct     = raw.slice(SALT_LEN + IV_LEN);
  const key    = await _derive(password, salt);
  const dec    = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(dec);
}

async function _derive(password, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
