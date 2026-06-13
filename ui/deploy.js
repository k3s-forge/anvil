// site/ui/deploy.js
// 职责：部署页 —— 模板选择 + 参数表单 + 提交
// 组合 template.js 纯函数 + DOM 视图

import { html as esc } from '../lib/escape.js';
import * as Tpl  from '../lib/template.js';
import * as Auth from '../lib/auth.js';

export async function render(container, { repo, branch, onEvent }) {
  container.innerHTML = `
    <div class="deploy-layout">
      <div class="deploy-sidebar" id="tpl-list"><div class="spinner"></div></div>
      <div class="deploy-main" id="tpl-main">
        <div class="empty"><div class="empty-icon">📦</div>
          <div class="empty-title">选择模板</div></div>
      </div>
    </div>`;

  const listEl = document.getElementById('tpl-list');
  const mainEl = document.getElementById('tpl-main');

  try {
    const templates = await Tpl.loadList(repo, branch);
    _renderList(listEl, templates, mainEl, { repo, branch, onEvent });
  } catch (err) {
    listEl.innerHTML = `<div class="status status-err">加载失败: ${esc(err.message)}</div>`;
  }
}

function _renderList(el, templates, mainEl, ctx) {
  if (!templates.length) {
    el.innerHTML = '<div class="empty"><p>暂无模板</p><p class="text-muted">在 templates/ 目录下添加</p></div>';
    return;
  }

  const userRole = Auth.role();

  el.innerHTML = templates.map(t => {
    const locked = !Auth.can(t.requiredRole);
    return `<div class="tpl-item ${locked ? 'tpl-locked' : ''}"
      data-name="${esc(t.name)}" title="${locked ? '需要 ' + t.requiredRole + ' 权限' : ''}">
      <span class="tpl-icon">${t.icon}</span>
      <span class="tpl-label">${esc(t.label)}</span>
      ${locked ? '<span class="tpl-badge">🔒</span>' : ''}
    </div>`;
  }).join('');

  el.querySelectorAll('.tpl-item:not(.tpl-locked)').forEach(item => {
    item.addEventListener('click', () => {
      el.querySelectorAll('.tpl-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const t = templates.find(t => t.name === item.dataset.name);
      if (t) _renderForm(mainEl, t, ctx);
    });
  });
}

function _renderForm(el, template, ctx) {
  const vals = Tpl.paramDefaults(template.params);
  const userRole = Auth.role();
  const isAdmin = userRole === 'admin';

  const fields = template.params.map(p => {
    const isNum = p.type === 'number';
    const locked = p.protected && !isAdmin;
    const isSelect = !!p.options;

    return `<div class="fg">
      <label>${esc(p.label || p.name)} ${p.required ? '<span class="req">*</span>' : ''}
        ${locked ? '<span class="lock-badge" title="仅管理员可修改">🔒</span>' : ''}</label>
      ${isSelect
        ? `<select class="ff-${esc(p.name)}" ${locked ? 'disabled' : ''}>
             ${p.options.map(o => `<option value="${esc(o)}" ${o===vals[p.name]?'selected':''}>${esc(o)}</option>`).join('')}
           </select>`
        : `<input type="${isNum ? 'number' : 'text'}" class="ff-${esc(p.name)}"
             value="${esc(vals[p.name])}" placeholder="${esc(p.description || '')}"
             ${locked ? 'disabled readonly' : ''}>`}
      ${p.description ? `<span class="fg-hint">${esc(p.description)}</span>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span>${template.icon} ${esc(template.label)}</span>
        <span class="text-muted">${esc(template.description)}</span>
      </div>
      <div class="card-body">
        ${fields}
        <div class="fg" id="tpl-errors" style="display:none"></div>
        <div class="fg">
          <label>Job (预览)</label>
          <pre class="hcl-preview" id="tpl-preview"></pre>
        </div>
        <button class="btn btn-primary" id="btn-submit">提交 Job</button>
      </div>
    </div>`;

  el.querySelector('#btn-submit').addEventListener('click', () => {
    const values = {};
    template.params.forEach(p => {
      const inp = el.querySelector(`.ff-${p.name}`);
      values[p.name] = inp ? inp.value : '';
    });

    // 1. 参数校验
    const { valid, errors } = Tpl.validateParams(template.params, values);
    const errEl = el.querySelector('#tpl-errors');
    if (!valid) {
      errEl.style.display = 'block';
      errEl.innerHTML = Object.values(errors).map(e => `<span class="err">${esc(e)}</span>`).join('<br>');
      return;
    }

    // 2. 权限拦截：非 admin 修改 protected 字段 → 物理熔断
    const perm = Tpl.validatePermissions(template.params, values, userRole);
    if (!perm.valid) {
      errEl.style.display = 'block';
      errEl.innerHTML = perm.violations.map(v =>
        `<span class="err">🔒 ${esc(v.label)}: 仅管理员可修改 (当前: ${esc(v.submitted)}, 默认: ${esc(v.expected)})</span>`
      ).join('<br>');
      return;
    }

    errEl.style.display = 'none';
    const hcl = Tpl.render(template, values);
    ctx.onEvent({
      type: 'submit',
      template: template.name,
      label: template.label,
      requiresCI: !!template.requires_ci,
      values,
      hcl,
    });
  });

  // 实时预览
  const preview = el.querySelector('#tpl-preview');
  const inputs = el.querySelectorAll('[class^="ff-"]');
  inputs.forEach(inp => {
    inp.addEventListener('input', () => {
      const values = {};
      template.params.forEach(p => {
        const el2 = document.querySelector(`.ff-${p.name}`);
        values[p.name] = el2 ? el2.value : '';
      });
      preview.textContent = Tpl.render(template, values);
    });
  });
  preview.textContent = Tpl.render(template, vals);
}
