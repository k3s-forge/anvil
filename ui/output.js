// site/ui/output.js
// 职责：渲染命令块 + 状态消息
// 纯视图函数

import { html as esc, attr as escAttr } from '../lib/escape.js';
import { t } from '../lib/i18n.js';

export function renderCommands(container, commands) {
  if (!commands.length) {
    container.innerHTML = `<div class="empty"><p>${t('common.empty')}</p></div>`;
    return;
  }

  container.innerHTML = commands.map((c, i) => `
    <div class="cmd-block">
      <div class="cmd-label">${c.isSeed ? t('bs.cmd.seed') : t('bs.cmd.join', {n: i+1})}
        — ${esc(c.name)} ${c.auto ? '<span class="auto-badge">🤖 Auto</span>' : ''}</div>
      <pre class="cmd-pre" data-cmd="${escAttr(c.cmd)}"><span class="copy-hint">${t('bs.cmd.copy')}</span>${esc(c.cmd)}</pre>
      <div class="cmd-note">${c.isSeed ? t('bs.cmd.seedNote') : t('bs.cmd.joinNote')}</div>
    </div>`).join('');

  container.querySelectorAll('.cmd-pre').forEach(pre => {
    pre.addEventListener('click', () => {
      const cmd = pre.dataset.cmd;
      navigator.clipboard.writeText(cmd).then(() => {
        const hint = pre.querySelector('.copy-hint');
        hint.textContent = t('bs.cmd.copied');
        setTimeout(() => hint.textContent = t('bs.cmd.copy'), 1500);
      });
    });
  });
}

export function showStatus(container, msg, type) {
  container.innerHTML = `<div class="status status-${type}">${esc(msg)}</div>`;
}
