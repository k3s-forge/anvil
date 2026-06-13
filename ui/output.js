// site/ui/output.js
// 职责：渲染命令块 + 状态消息
// 纯视图函数

import { html as esc, attr as escAttr } from '../lib/escape.js';

export function renderCommands(container, commands) {
  container.innerHTML = commands.map(c => `
    <div class="cmd-block">
      <div class="cmd-label">${c.isSeed ? '🥇 种子 Server' : c.role === 'server' ? '🥈 Server' : '💻 Client'}
        — ${esc(c.name)}</div>
      <pre class="cmd-pre" data-cmd="${escAttr(c.cmd)}"><span class="copy-hint">点击复制</span>${esc(c.cmd)}</pre>
      <div class="cmd-note">SSH 到目标机，粘贴执行。Gossip 密钥仅在此命令中出现。</div>
    </div>`).join('');

  container.querySelectorAll('.cmd-pre').forEach(pre => {
    pre.addEventListener('click', () => {
      const cmd = pre.dataset.cmd;
      navigator.clipboard.writeText(cmd).then(() => {
        const hint = pre.querySelector('.copy-hint');
        hint.textContent = '✓ 已复制';
        setTimeout(() => hint.textContent = '点击复制', 1500);
      });
    });
  });
}

export function showStatus(container, msg, type) {
  container.innerHTML = `<div class="status status-${type}">${esc(msg)}</div>`;
}
