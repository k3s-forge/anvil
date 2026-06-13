// site/lib/topology.js
// 职责：节点拓扑状态机 —— 增删改查 + 校验
// 全部纯函数

function _nextId() { return `${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }

export function createNode(name = '', ip = '', role = 'server') {
  return { _id: _nextId(), name, ip, role };
}

export function addNode(nodes) {
  return [...nodes, createNode('', '', 'server')];
}

export function removeNode(nodes, id) {
  if (nodes.length <= 1) return nodes;
  return nodes.filter(n => n._id !== id);
}

export function updateNode(nodes, id, field, value) {
  return nodes.map(n => n._id === id ? { ...n, [field]: value } : n);
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
  if (!nodes.some(n => n.role === 'server')) errors.push('至少需要 1 个 Server');
  return { valid: errors.length === 0, errors };
}

export function firstServer(nodes) {
  return nodes.find(n => n.role === 'server') || null;
}
