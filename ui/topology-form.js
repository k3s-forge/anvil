// site/ui/topology-form.js
// 职责：渲染节点表单 —— 纯视图，零状态
// 输入：nodes[], onEvent({type, id?, field?, value?})
// 输出：DOM 更新，事件通过回调通知父组件

import { html as esc } from '../lib/escape.js';

const FIELDS = { '.nf-name': 'name', '.nf-ip': 'ip', '.nf-role': 'role' };

export function render(container, nodes, onEvent) {
  container.innerHTML = '';

  for (const n of nodes) {
    const row = document.createElement('div');
    row.className = 'node-row';
    row.dataset.id = n._id;

    row.innerHTML = `
      <div class="fg"><label>节点名</label>
        <input type="text" class="nf-name" value="${esc(n.name)}" placeholder="seed-1"></div>
      <div class="fg"><label>IP</label>
        <input type="text" class="nf-ip" value="${esc(n.ip)}" placeholder="x.x.x.x"></div>
      <div class="fg"><label>角色</label>
        <select class="nf-role">
          <option value="server" ${n.role==='server'?'selected':''}>Server</option>
          <option value="client" ${n.role==='client'?'selected':''}>Client</option>
        </select></div>
      <button class="btn btn-sm btn-danger nf-rm" title="移除">✕</button>`;

    for (const [sel, field] of Object.entries(FIELDS)) {
      const el = row.querySelector(sel);
      ['change', 'input'].forEach(ev => el.addEventListener(ev, () => {
        onEvent({ type: 'update', id: n._id, field, value: el.value });
      }));
    }

    row.querySelector('.nf-rm').addEventListener('click', () => {
      onEvent({ type: 'remove', id: n._id });
    });

    container.appendChild(row);
  }

  const add = document.createElement('button');
  add.className = 'btn btn-sm';
  add.textContent = '+ 添加节点';
  add.addEventListener('click', () => onEvent({ type: 'add' }));
  container.appendChild(add);
}
