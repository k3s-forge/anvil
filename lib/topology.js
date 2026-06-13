// site/lib/topology.js
// 职责：节点拓扑状态机 —— 增删改查 + 校验
// 全部纯函数
// 约定：nodes[0] 始终为种子 Server，不可删除、不可改角色

function _nextId() { return `${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }

export function createNode(name = '', ip = '', role = 'server') {
  return {
    _id: _nextId(), name, ip, role,
    hostname: '', timezone: '', os: 'linux', bbr: true, network: 'dhcp',
  };
}

export function addNode(nodes) {
  // 新增节点默认 Client（种子已是 Server）
  return [...nodes, createNode('', '', 'client')];
}

export function removeNode(nodes, id) {
  if (nodes.length <= 1) return nodes;
  // 种子节点不可删除
  if (nodes[0]._id === id) return nodes;
  return nodes.filter(n => n._id !== id);
}

export function updateNode(nodes, id, field, value) {
  return nodes.map(n => {
    if (n._id !== id) return n;
    // 种子节点角色不可改
    if (field === 'role' && nodes[0]._id === id) return n;
    return { ...n, [field]: value };
  });
}

export function validate(nodes) {
  const errors = [];
  if (nodes.length === 0) errors.push('至少需要 1 个节点');

  const seen = new Set();
  for (const n of nodes) {
    if (!n.name.trim()) errors.push('节点名不能为空');
    if (seen.has(n.name)) errors.push(`节点名重复: ${n.name}`);
    seen.add(n.name);
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(n.ip.trim()))
      errors.push(`IP 格式不正确: ${n.ip || '(空)'}`);
  }

  // 种子校验
  if (nodes[0] && nodes[0].role !== 'server') errors.push('种子节点必须是 Server');
  if (nodes[0] && !nodes[0].ip.trim()) errors.push('种子节点 IP 不能为空');

  // Raft: 法定人数要求奇数 ≥ 3（含种子）
  const servers = nodes.filter(n => n.role === 'server');
  if (servers.length === 2) errors.push('Raft 需要奇数台 Server（当前 2 台，会脑裂）');
  if (servers.length === 4) errors.push('Raft 需要奇数台 Server（当前 4 台，无多数派）');
  if (servers.length === 0) errors.push('至少需要 1 个 Server');

  return { valid: errors.length === 0, errors };
}
