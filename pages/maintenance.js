// site/pages/maintenance.js
// 职责：维护面板 —— 全局真理源控制 + 滚动升级编排
// 核心机制：Nomad Variable maintenance_mode → 全网 HCL 反应式重刷
// admin only

import * as Nomad  from '../lib/nomad-client.js';
import * as Auth   from '../lib/auth.js';
import * as Output from '../ui/output.js';
import { html as esc } from '../lib/escape.js';

const VAR_MAINTENANCE = 'anvil/maintenance';
const VAR_UPGRADE     = 'anvil/upgrade_target';

export function render(main, status, CFG) {
  if (Auth.role() !== 'admin') {
    main.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div>
      <div class="empty-title">仅管理员可访问</div></div>`;
    return;
  }

  main.innerHTML = `
    <div class="maint-layout">
      <div class="maint-toolbar">
        <h3>🔧 集群维护</h3>
        <div class="fg-inline">
          <label>Nomad API</label>
          <input type="text" id="mt-nomad-url"
            value="${esc(CFG.nomadUrl)}"
            placeholder="http://<seed>:4647" style="width:220px">
          <button class="btn" id="mt-refresh">刷新</button>
        </div>
      </div>

      <div class="maint-grid" id="mt-grid">
        <div class="spinner"></div>
      </div>
    </div>`;

  document.getElementById('mt-refresh').addEventListener('click', () => _load(status));
  _load(status);
}

async function _load(status) {
  const grid = document.getElementById('mt-grid');
  const url = document.getElementById('mt-nomad-url').value.trim();
  localStorage.setItem('anvil_nomad_url', url);
  const token = Auth.load()?.access_token;

  if (!url) {
    grid.innerHTML = '<div class="empty"><p>请输入 Nomad API 地址</p></div>';
    return;
  }

  grid.innerHTML = '<div class="spinner"></div>';

  try {
    const [nodes, jobs] = await Promise.all([
      Nomad.listNodes(url, token).catch(() => []),
      Nomad.listJobs(url, token).catch(() => []),
    ]);

    // 读取真理源变量
    let maintenanceMode = false;
    let upgradeTarget = '';
    try {
      const mv = await Nomad.getVar(url, token, VAR_MAINTENANCE);
      maintenanceMode = _decodeVar(mv.Items, 'mode') === 'true';
    } catch { /* 变量不存在 = 正常模式 */ }
    try {
      const uv = await Nomad.getVar(url, token, VAR_UPGRADE);
      upgradeTarget = _decodeVar(uv.Items, 'version') || '';
    } catch { /* 无升级目标 */ }

    _renderMode(grid, maintenanceMode, url, token, status);
    _renderNodes(grid, nodes);
    _renderUpgrade(grid, nodes, jobs, upgradeTarget, url, token, status);

    document.getElementById('mt-refresh')?.addEventListener('click', () => _load(status));
  } catch (err) {
    grid.innerHTML = `<div class="status status-err">加载失败: ${esc(err.message)}</div>`;
  }
}

// ---- 维护模式开关 ----
function _renderMode(grid, active, url, token, status) {
  const card = document.createElement('div');
  card.className = 'card chart-card';
  card.id = 'mt-mode-card';
  card.innerHTML = `
    <div class="card-header">
      <span>🧊 维护模式</span>
      <span class="tag tag-${active ? 'warn' : 'ok'}">${active ? '冻结中' : '正常运行'}</span>
    </div>
    <div class="card-body">
      <p class="text-muted">
        ${active
          ? '全网哈希环冻结 · 数据卷锁定 · 驱逐时钟挂起'
          : '30s 大租约 · 动态自愈 · 哈希环自适应'}
      </p>
      <div class="maint-effects">
        <div class="effect-item ${active ? 'active' : ''}">🔒 存储拓扑冰封</div>
        <div class="effect-item ${active ? 'active' : ''}">⏸️ 驱逐时钟 5min</div>
        <div class="effect-item ${active ? 'active' : ''}">🛡️ PF synproxy 代答</div>
      </div>
      <button class="btn ${active ? 'btn-primary' : 'btn-warn'}" id="mt-toggle-mode">
        ${active ? '解冻 · 恢复常态' : '冻结 · 进入维护'}
      </button>
    </div>`;
  grid.appendChild(card);

  card.querySelector('#mt-toggle-mode').addEventListener('click', async () => {
    const newMode = !active;
    try {
      await Nomad.putVar(url, token, VAR_MAINTENANCE, [
        { Key: 'mode', Value: btoa(String(newMode)) },
        { Key: 'updated_at', Value: btoa(new Date().toISOString()) },
        { Key: 'updated_by', Value: btoa(Auth.userName()) },
      ]);
      Output.showStatus(status,
        newMode ? '🔒 维护模式已激活 — 全网拓扑冻结' : '✅ 维护模式已解除 — 恢复动态自愈',
        'ok');
      _load(status);
    } catch (err) {
      Output.showStatus(status, `操作失败: ${err.message}`, 'err');
    }
  });
}

// ---- 节点清单 ----
function _renderNodes(grid, nodes) {
  const up = nodes.filter(n => n.Status === 'ready');
  const draining = nodes.filter(n => n.Drain);
  const ineligible = nodes.filter(n => n.SchedulingEligibility === 'ineligible');

  const card = document.createElement('div');
  card.className = 'card chart-card';
  card.innerHTML = `
    <div class="card-header">
      <span>🖥️ 节点状态</span>
      <span class="text-muted">${up.length}/${nodes.length} 在线</span>
    </div>
    <div class="card-body" style="max-height:300px;overflow-y:auto">
      ${nodes.map(n => {
        const s = n.Status === 'ready' ? 'ok' : 'err';
        const draining = n.Drain ? ' ⏳排水' : '';
        const inel = n.SchedulingEligibility === 'ineligible' ? ' 🚫' : '';
        return `<div class="node-row-sm">
          <span class="node-dot ${s}"></span>
          <span class="node-name">${esc(n.Name || n.ID)}</span>
          <span class="text-muted">${esc(n.Address || '')}${draining}${inel}</span>
          <span class="tag tag-${s}">${n.Status}</span>
        </div>`;
      }).join('') || '<p class="text-muted">无节点</p>'}
    </div>`;
  grid.appendChild(card);
}

// ---- 滚动升级 ----
function _renderUpgrade(grid, nodes, jobs, upgradeTarget, url, token, status) {
  const card = document.createElement('div');
  card.className = 'card chart-card';
  card.id = 'mt-upgrade-card';
  card.innerHTML = `
    <div class="card-header">
      <span>🔄 滚动升级</span>
      ${upgradeTarget ? `<span class="tag tag-warn">目标: ${esc(upgradeTarget)}</span>` : ''}
    </div>
    <div class="card-body">
      <p class="text-muted">
        按几何隔离带 (10% 不相邻节点) 并发执行。<br>
        内核原地手术: nextboot → PF synproxy → reboot → 秒级复活。
      </p>
      <div class="fg">
        <label>升级目标 (Nomad 版本 / FreeBSD 补丁)</label>
        <div class="fg-inline">
          <input type="text" id="mt-upgrade-ver" placeholder="nomad-1.10.0" style="flex:1"
            value="${esc(upgradeTarget)}">
          <button class="btn btn-primary" id="mt-start-upgrade">启动滚动升级</button>
        </div>
      </div>
      <div id="mt-upgrade-progress" style="margin-top:.75rem"></div>
    </div>`;
  grid.appendChild(card);

  card.querySelector('#mt-start-upgrade').addEventListener('click', async () => {
    const ver = card.querySelector('#mt-upgrade-ver').value.trim();
    if (!ver) {
      Output.showStatus(status, '请输入升级目标版本号', 'err');
      return;
    }

    Output.showStatus(status, '启动滚动升级...', 'loading');
    try {
      // 1. 设置升级目标变量 (真理源)
      await Nomad.putVar(url, token, VAR_UPGRADE, [
        { Key: 'version',    Value: btoa(ver) },
        { Key: 'started_at', Value: btoa(new Date().toISOString()) },
        { Key: 'started_by', Value: btoa(Auth.userName()) },
        { Key: 'status',     Value: btoa('in_progress') },
        { Key: 'max_parallel', Value: btoa('10%') },
        { Key: 'strategy',   Value: btoa('geometric_isolation') },
      ]);

      // 2. 确保维护模式打开
      try {
        await Nomad.putVar(url, token, VAR_MAINTENANCE, [
          { Key: 'mode', Value: btoa('true') },
          { Key: 'updated_at', Value: btoa(new Date().toISOString()) },
          { Key: 'updated_by', Value: btoa(Auth.userName()) },
        ]);
      } catch { /* 可能已存在 */ }

      Output.showStatus(status,
        `🔧 滚动升级已启动 → ${ver} · 几何隔离 10% · 拓扑冰封`, 'ok');
      _load(status);
    } catch (err) {
      Output.showStatus(status, `启动失败: ${err.message}`, 'err');
    }
  });
}

function _decodeVar(items, key) {
  if (!items) return null;
  for (const it of items) {
    if (it.Key === key) {
      try { return atob(it.Value); } catch { return it.Value; }
    }
  }
  return null;
}
