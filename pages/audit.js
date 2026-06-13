// site/pages/audit.js
// 职责：审计大盘 —— 集群健康、资源成本、部署历史
// 数据源：Nomad API + GitHub API
// admin only

import * as Nomad  from '../lib/nomad-client.js';
import * as GitHub from '../lib/github-client.js';
import * as Auth   from '../lib/auth.js';
import * as Output from '../ui/output.js';
import { html as esc } from '../lib/escape.js';

// 成本模型 (USD/月)
const COST = { cpuCore: 20, ramGb: 5, diskGb: 0.10 };

export function render(main, status, CFG) {
  if (Auth.role() !== 'admin') {
    main.innerHTML = `<div class="empty"><div class="empty-icon">🔒</div>
      <div class="empty-title">仅管理员可访问</div></div>`;
    return;
  }

  main.innerHTML = `
    <div class="audit-layout">
      <div class="audit-toolbar">
        <h3>📊 审计大盘</h3>
        <div class="fg-inline">
          <label>Nomad API</label>
          <input type="text" id="au-nomad-url"
            value="${esc(CFG.nomadUrl)}"
            placeholder="http://<seed>:4647" style="width:220px">
          <button class="btn" id="au-refresh">刷新</button>
        </div>
      </div>
      <div class="audit-grid" id="au-grid">
        <div class="spinner"></div>
      </div>
    </div>`;

  document.getElementById('au-refresh').addEventListener('click', () => _load(status, CFG));
  _load(status, CFG);
}

async function _load(status, CFG) {
  const grid = document.getElementById('au-grid');
  const url = document.getElementById('au-nomad-url').value.trim();
  localStorage.setItem('anvil_nomad_url', url);

  if (!url) {
    grid.innerHTML = '<div class="empty"><p>请输入 Nomad API 地址</p></div>';
    return;
  }

  grid.innerHTML = '<div class="spinner"></div>';
  const token = Auth.load()?.access_token;

  try {
    const [nodes, jobs] = await Promise.all([
      Nomad.listNodes(url, token).catch(() => []),
      Nomad.listJobs(url, token).catch(() => []),
    ]);

    _renderHealth(grid, nodes);
    _renderResources(grid, nodes);
    _renderJobs(grid, jobs);

    // GitHub 部署历史 (独立请求，不影响 Nomad 面板)
    _renderDeployHistory(grid, CFG);

  } catch (err) {
    grid.innerHTML = `<div class="status status-err">加载失败: ${esc(err.message)}</div>`;
  }
}

function _renderHealth(grid, nodes) {
  const up = nodes.filter(n => n.Status === 'ready').length;
  const down = nodes.length - up;
  const health = nodes.length ? (up / nodes.length * 100).toFixed(0) : 0;

  const card = _card('🫀 集群健康', `
    <div class="metric-big ${health > 90 ? 'ok' : health > 50 ? 'warn' : 'err'}">${health}%</div>
    <div class="metric-row">
      <div class="metric-item"><span class="metric-val ok">${up}</span><span class="metric-label">在线</span></div>
      <div class="metric-item"><span class="metric-val ${down ? 'err' : ''}">${down}</span><span class="metric-label">离线</span></div>
      <div class="metric-item"><span class="metric-val">${nodes.length}</span><span class="metric-label">节点总数</span></div>
    </div>`);
  grid.appendChild(card);
}

function _renderResources(grid, nodes) {
  let totalCpu = 0, totalRam = 0, totalDisk = 0;
  let usedCpu = 0, usedRam = 0;

  for (const n of nodes) {
    const r = n.NodeResources || n.Resources || {};
    totalCpu  += r.Cpu?.CpuShares || r.Cpu || 0;
    totalRam  += (r.Memory?.MemoryMB || r.Memory || 0);
    totalDisk += (r.Disk?.DiskMB || r.Disk || 0);

    if (n.Drain !== true) {
      usedCpu  += (r.Cpu?.ReservedCPU || 0);
      usedRam  += (r.Memory?.ReservedMemoryMB || 0);
    }
  }

  const cpuCores = (totalCpu / 1000).toFixed(1);
  const ramGb = (totalRam / 1024).toFixed(1);
  const diskGb = (totalDisk / 1024).toFixed(1);

  // 成本计算
  const monthly = (cpuCores * COST.cpuCore + ramGb * COST.ramGb + diskGb * COST.diskGb).toFixed(0);
  const wastePct = totalCpu > 0 ? ((1 - usedCpu / totalCpu) * 100).toFixed(0) : 0;

  const card = _card('💰 资源与成本', `
    <div class="cost-total">$${monthly}<span class="cost-unit">/月 估算</span></div>
    <div class="metric-row" style="margin-top:.5rem">
      <div class="metric-item"><span class="metric-val">${cpuCores}</span><span class="metric-label">CPU 核</span></div>
      <div class="metric-item"><span class="metric-val">${ramGb}G</span><span class="metric-label">内存</span></div>
      <div class="metric-item"><span class="metric-val">${diskGb}G</span><span class="metric-label">磁盘</span></div>
    </div>
    <div class="waste-bar" style="margin-top:.75rem">
      <div class="waste-label">资源闲置 <span class="${wastePct > 50 ? 'err' : wastePct > 30 ? 'warn' : 'ok'}">${wastePct}%</span></div>
      <div class="bar"><div class="bar-fill" style="width:${100 - wastePct}%"></div></div>
    </div>`);
  grid.appendChild(card);
}

function _renderJobs(grid, jobs) {
  const running = jobs.filter(j => j.Status === 'running').length;
  const pending = jobs.filter(j => j.Status === 'pending').length;
  const dead    = jobs.filter(j => j.Status === 'dead').length;

  const card = _card('📦 Job 状态', `
    <div class="metric-row">
      <div class="metric-item"><span class="metric-val ok">${running}</span><span class="metric-label">运行中</span></div>
      <div class="metric-item"><span class="metric-val warn">${pending}</span><span class="metric-label">等待中</span></div>
      <div class="metric-item"><span class="metric-val err">${dead}</span><span class="metric-label">已停止</span></div>
      <div class="metric-item"><span class="metric-val">${jobs.length}</span><span class="metric-label">总计</span></div>
    </div>
    ${jobs.length > 0 ? `
    <div style="margin-top:.75rem;max-height:180px;overflow-y:auto">
      ${jobs.slice(0, 10).map(j => `
        <div class="job-row">
          <span class="job-name">${esc(j.Name || j.ID)}</span>
          <span class="tag tag-${j.Status === 'running' ? 'ok' : j.Status === 'pending' ? 'warn' : 'err'}">${j.Status}</span>
          <span class="job-type">${esc(j.Type || '')}</span>
        </div>`).join('')}
    </div>` : ''}`);
  grid.appendChild(card);
}

async function _renderDeployHistory(grid, CFG) {
  const card = _card('📈 部署历史', '<div class="spinner"></div>');
  grid.appendChild(card);

  try {
    const commits = await _fetchCommits(CFG.repo, CFG.branch);
    const body = card.querySelector('.card-body');
    if (!commits.length) {
      body.innerHTML = '<p class="text-muted">暂无部署记录</p>';
      return;
    }

    // 近 30 天统计
    const now = Date.now();
    const d30 = now - 30 * 86400000;
    const recent = commits.filter(c => new Date(c.date) > d30);
    const deploys = recent.filter(c => c.message.includes('coldstart') || c.message.includes('approval') || c.message.includes('deploy'));

    body.innerHTML = `
      <div class="metric-row">
        <div class="metric-item"><span class="metric-val">${deploys.length}</span><span class="metric-label">30天部署</span></div>
        <div class="metric-item"><span class="metric-val">${commits.length}</span><span class="metric-label">总提交</span></div>
      </div>
      <div style="margin-top:.75rem;max-height:160px;overflow-y:auto">
        ${commits.slice(0, 8).map(c => `
          <div class="commit-row">
            <span class="commit-msg">${esc(c.message.split('\n')[0].slice(0, 60))}</span>
            <span class="commit-date">${_relativeDate(c.date)}</span>
          </div>`).join('')}
      </div>`;
  } catch {
    card.querySelector('.card-body').innerHTML = '<p class="text-muted">无法加载 GitHub 历史</p>';
  }
}

async function _fetchCommits(repo, branch) {
  const url = `https://api.github.com/repos/${repo}/commits?sha=${branch}&per_page=30`;
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.map(c => ({
    message: c.commit.message,
    date: c.commit.author.date,
    sha: c.sha.slice(0, 7),
    author: c.commit.author.name,
  }));
}

function _card(title, body) {
  const div = document.createElement('div');
  div.className = 'card chart-card';
  div.innerHTML = `<div class="card-header">${title}</div><div class="card-body">${body}</div>`;
  return div;
}

function _relativeDate(d) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff/86400)}d ago`;
  return new Date(d).toLocaleDateString();
}
