// site/ui/topology-form.js
// 职责：渲染节点表单 —— 纯视图，零状态
// 输入：nodes[], onEvent({type, id?, field?, value?})
// 约定：nodes[0] 为种子 Server，不可删除、不可改角色
// 输出：DOM 更新，事件通过回调通知父组件

import { html as esc } from '../lib/escape.js';
import { t } from '../lib/i18n.js';

const ADV_KEYS = ['hostname', 'timezone', 'os', 'bbr', 'network'];

export function render(container, nodes, onEvent) {
  container.innerHTML = '';

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const isSeed = i === 0;
    const row = document.createElement('div');
    row.className = `node-row${isSeed ? ' node-seed' : ''}`;
    row.dataset.id = n._id;

    const badge = isSeed ? `<span class="seed-badge">${t('bs.seed.badge')}</span>` : '';

    const joinField = (!isSeed && n.role === 'server')
      ? `<div class="fg fg-join"><label>${t('bs.node.join')}</label>
           <input type="text" class="nf-join" value="${esc(isSeed ? '' : nodes[0].ip)}" readonly></div>`
      : '';

    row.innerHTML = `
      <div class="fg fg-name"><label>${t('bs.node.name')} ${badge}</label>
        <input type="text" class="nf-name" value="${esc(n.name)}" placeholder="seed-1"></div>
      <div class="fg fg-ip"><label>${t('bs.node.ip')}</label>
        <input type="text" class="nf-ip" value="${esc(n.ip)}" placeholder="x.x.x.x"></div>
      ${isSeed
        ? `<div class="fg fg-role"><label>${t('bs.node.role')}</label><div class="seed-role-locked">${t('bs.seed.role')}</div></div>`
        : `<div class="fg fg-role"><label>${t('bs.node.role')}</label>
             <select class="nf-role">
               <option value="server" ${n.role==='server'?'selected':''}>${t('bs.role.server')}</option>
               <option value="client" ${n.role==='client'?'selected':''}>${t('bs.role.client')}</option>
             </select></div>`}
      ${joinField}
      ${!isSeed ? `<button class="btn btn-sm btn-danger nf-rm" title="${t('bs.node.remove')}">✕</button>` : ''}`;

    // Advanced section
    const adv = document.createElement('div');
    adv.className = 'node-advanced';
    const hasAdv = ADV_KEYS.some(k => n[k] !== void 0 && n[k] !== '' && n[k] !== false && !(k === 'bbr' && n[k] === true) && !(k === 'network' && n[k] === 'dhcp') && !(k === 'os' && n[k] === 'linux'));
    adv.innerHTML = `
      <button class="adv-toggle" type="button">⚙ ${t('bs.node.syscfg')} ${hasAdv ? '●' : ''}</button>
      <div class="adv-body" style="display:none">
        <div class="fg fg-hostname"><label>Hostname</label>
          <input type="text" class="nf-hostname" value="${esc(n.hostname||'')}" placeholder="${esc(n.name)}"></div>
        <div class="fg fg-tz"><label>Timezone</label>
          <input type="text" class="nf-timezone" value="${esc(n.timezone||'')}" placeholder="UTC"></div>
        <div class="fg fg-os"><label>OS</label>
          <select class="nf-os">
            <option value="linux"  ${(n.os||'linux')==='linux'?'selected':''}>Linux</option>
            <option value="freebsd" ${n.os==='freebsd'?'selected':''}>FreeBSD</option>
          </select></div>
        <div class="fg fg-net"><label>Network</label>
          <select class="nf-network">
            <option value="dhcp"   ${(n.network||'dhcp')==='dhcp'?'selected':''}>DHCP</option>
            <option value="static" ${n.network==='static'?'selected':''}>Static IP</option>
          </select></div>
        <div class="fg fg-bbr"><label>
          <input type="checkbox" class="nf-bbr" ${n.bbr!==false?'checked':''}> BBR</label></div>
      </div>`;

    // Toggle advanced
    const toggle = adv.querySelector('.adv-toggle');
    const body   = adv.querySelector('.adv-body');
    toggle.addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? 'flex' : 'none';
    });

    // Event bindings — main fields
    bind(row, '.nf-name', 'name', n._id, onEvent, 'input');
    bind(row, '.nf-ip',   'ip',   n._id, onEvent, 'input');
    const roleEl = row.querySelector('.nf-role');
    if (roleEl) roleEl.addEventListener('change', () =>
      onEvent({ type: 'update', id: n._id, field: 'role', value: roleEl.value }));

    const rmEl = row.querySelector('.nf-rm');
    if (rmEl) rmEl.addEventListener('click', () =>
      onEvent({ type: 'remove', id: n._id }));

    // Event bindings — advanced fields
    bind(adv, '.nf-hostname', 'hostname', n._id, onEvent, 'input');
    bind(adv, '.nf-timezone', 'timezone', n._id, onEvent, 'input');
    bind(adv, '.nf-os',       'os',       n._id, onEvent, 'change');
    bind(adv, '.nf-network',  'network',  n._id, onEvent, 'change');
    const bbrEl = adv.querySelector('.nf-bbr');
    if (bbrEl) bbrEl.addEventListener('change', () =>
      onEvent({ type: 'update', id: n._id, field: 'bbr', value: bbrEl.checked }));

    row.appendChild(adv);
    container.appendChild(row);
  }

  const add = document.createElement('button');
  add.className = 'btn btn-sm topo-add-btn';
  add.textContent = t('bs.node.add');
  add.addEventListener('click', () => onEvent({ type: 'add' }));
  container.appendChild(add);
}

function bind(el, sel, field, id, onEvent, evt) {
  const input = el.querySelector(sel);
  if (input) input.addEventListener(evt, () =>
    onEvent({ type: 'update', id, field, value: input.type === 'checkbox' ? input.checked : input.value }));
}
