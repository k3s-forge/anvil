// site/lib/nomad-client.js
// 职责：Nomad API 封装
// 输入：nomadUrl, token (OIDC access_token)
// 输出：API 响应
// 副作用：fetch

// ---- Jobs ----

export async function listJobs(nomadUrl, token) {
  return _api(nomadUrl, token, 'GET', '/v1/jobs');
}

export async function listNodes(nomadUrl, token) {
  return _api(nomadUrl, token, 'GET', '/v1/nodes');
}

export async function submitJobHCL(nomadUrl, token, hcl) {
  const r = await fetch(`${nomadUrl}/v1/jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-hcl',
    },
    body: hcl,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Nomad ${r.status}: ${data}`);
  return data;
}

// ---- Variables ----

export async function listVars(nomadUrl, token, prefix) {
  const r = await fetch(`${nomadUrl}/v1/vars?prefix=${encodeURIComponent(prefix)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Nomad vars ${r.status}: ${data}`);
  return data;
}

export async function getVar(nomadUrl, token, path) {
  const r = await fetch(`${nomadUrl}/v1/var/${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Nomad var ${r.status}: ${data}`);
  return data;
}

export async function putVar(nomadUrl, token, path, items) {
  const r = await fetch(`${nomadUrl}/v1/var/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Items: items }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Nomad var ${r.status}: ${data}`);
  return data;
}

export async function deleteVar(nomadUrl, token, path) {
  const r = await fetch(`${nomadUrl}/v1/var/${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const data = await r.json();
    throw new Error(`Nomad var delete ${r.status}: ${data}`);
  }
  return true;
}

// ---- internal ----

async function _api(base, token, method, path, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(`${base}${path}`, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(`Nomad ${r.status}: ${JSON.stringify(data)}`);
  return data;
}
