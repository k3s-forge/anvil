// site/ui/topology-form.js
// 职责：渲染节点表单 —— 纯视图，零状态
// 输入：nodes[], onEvent({type, id?, field?, value?})
// 约定：nodes[0] 为种子 Server，不可删除、不可改角色
// 输出：DOM 更新，事件通过回调通知父组件

import { html as esc } from '../lib/escape.js';

export function render(container, nodes, onEvent) {
  container.innerHTML = '';

  const seed = nodes[0];

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const isSeed = i === 0;
    const row = document.createElement('div');
    row.className = `node-row${isSeed ? ' node-seed' : ''}`;
    row.dataset.id = n._id;

    // 种子 Server 标记
    const badge = isSeed ? '<span class="seed-badge">🔑 种子</span>' : '';

    // join 字段：非种子 Server 显示，自动填入种子 IP
    const joinField = (!isSeed && n.role === 'server')
      ? `<div class="fg fg-join"><label>加入</label>
           <input type="text" class="nf-join" value="${esc(seed.ip || '')}" readonly
                  title="自动加入种子节点"></div>`
      : '';

    row.innerHTML = `
      <div class="fg fg-name"><label>节点名 ${badge}</label>
        <input type="text" class="nf-name" value="${esc(n.name)}" placeholder="seed-1"></div>
      <div class="fg fg-ip"><label>IP</label>
        <input type="text" class="nf-ip" value="${esc(n.ip)}" placeholder="x.x.x.x"></div>
      ${isSeed
        ? '<div class="fg fg-role"><label>角色</label><div class="seed-role-locked">Server</div></div>'
        : `<div class="fg fg-role"><label>角色</label>
             <select class="nf-role">
               <option value="server" ${n.role==='server'?'selected':''}>Server</option>
               <option value="client" ${n.role==='client'?'selected':''}>Client</option>
             </select></div>`}
      ${joinField}
      ${!isSeed ? '<button class="btn btn-sm btn-danger nf-rm" title="移除">✕</button>' : ''}`;

    // 事件绑定：name, ip, role
    const nameEl = row.querySelector('.nf-name');
    const ipEl = row.querySelector('.nf-ip');
    const roleEl = row.querySelector('.nf-role');

    if (nameEl) nameEl.addEventListener('input', () =>
      onEvent({ type: 'update', id: n._id, field: 'name', value: nameEl.value }));
    if (ipEl) ipEl.addEventListener('input', () =>
      onEvent({ type: 'update', id: n._id, field: 'ip', value: ipEl.value }));
    if (roleEl) roleEl.addEventListener('change', () =>
      onEvent({ type: 'update', id: n._id, field: 'role', value: roleEl.value }));

    // 删除按钮
    const rmEl = row.querySelector('.nf-rm');
    if (rmEl) rmEl.addEventListener('click', () =>
      onEvent({ type: 'remove', id: n._id }));

    container.appendChild(row);
  }

  const add = document.createElement('button');
  add.className = 'btn btn-sm topo-add-btn';
  add.textContent = '+ 添加节点';
  add.addEventListener('click', () => onEvent({ type: 'add' }));
  container.appendChild(add);
}
