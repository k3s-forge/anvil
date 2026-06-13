// site/lib/template.js
// 职责：模板加载、参数提取、校验、渲染
// 纯函数 + fetch

export async function loadList(repo, branch) {
  const url = `https://api.github.com/repos/${repo}/contents/templates?ref=${branch}`;
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) return [];
  const dirs = await r.json();
  const list = [];
  for (const d of dirs) {
    if (d.type !== 'dir') continue;
    try {
      const meta = await loadMeta(repo, branch, d.name);
      list.push({ name: d.name, ...meta });
    } catch { /* skip invalid */ }
  }
  return list;
}

export async function loadMeta(repo, branch, name) {
  const base = `https://raw.githubusercontent.com/${repo}/${branch}/templates/${name}`;
  const [metaR, hclR] = await Promise.all([
    fetch(`${base}/params.json`).then(r => r.ok ? r.json() : null),
    fetch(`${base}/job.hcl`).then(r => r.ok ? r.text() : null),
  ]);
  return {
    label: metaR?.label || name,
    description: metaR?.description || '',
    icon: metaR?.icon || '📦',
    requiredRole: metaR?.required_role || 'devops',
    requires_ci: metaR?.requires_ci || false,
    params: metaR?.params || [],
    hcl: hclR || '',
  };
}

export function validateParams(params, values) {
  const errors = {};
  for (const p of params) {
    if (p.required && !values[p.name]) {
      errors[p.name] = `${p.label || p.name} 不能为空`;
      continue;
    }
    if (p.type === 'number' && values[p.name] && isNaN(Number(values[p.name]))) {
      errors[p.name] = '必须是数字';
    }
    if (p.pattern && values[p.name] && !new RegExp(p.pattern).test(values[p.name])) {
      errors[p.name] = p.pattern_error || '格式不正确';
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function render(template, values) {
  let hcl = template.hcl || template;
  for (const [k, v] of Object.entries(values)) {
    hcl = hcl.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), v);
  }
  return hcl;
}

export function paramDefaults(params) {
  const vals = {};
  for (const p of params) {
    vals[p.name] = p.default !== undefined ? p.default : '';
  }
  return vals;
}

// 校验受保护字段权限
// protected 字段仅 admin 可修改默认值
export function validatePermissions(params, values, role) {
  if (role === 'admin') return { valid: true, violations: [] };
  const violations = [];
  for (const p of params) {
    if (!p.protected) continue;
    const current = values[p.name];
    const original = p.default !== undefined ? String(p.default) : '';
    if (current !== original) {
      violations.push({
        field: p.name,
        label: p.label || p.name,
        expected: original,
        submitted: current,
      });
    }
  }
  return { valid: violations.length === 0, violations };
}
