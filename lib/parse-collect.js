// lib/parse-collect.js
// 职责：解析 collect.sh 输出的 JSON → 预填节点字段
// 输入：JSON string
// 输出：{ ok, fields?, error? }
// 纯函数，零副作用

export function parse(jsonStr) {
  let data;
  try { data = JSON.parse(jsonStr); }
  catch (e) { return { ok: false, error: 'JSON 解析失败: ' + e.message }; }

  const required = ['hostname'];
  const missing = required.filter(k => !data[k]);
  if (missing.length) return { ok: false, error: '缺少必要字段: ' + missing.join(', ') };

  const fields = {
    name:      data.hostname || '',
    ip:        data.best_ip || '',
    hostname:  data.hostname || '',
    timezone:  data.timezone || 'UTC',
    os:        (data.os === 'freebsd') ? 'freebsd' : 'linux',
    network:   (data.network_type === 'static' && data.best_gateway) ? 'static' : 'dhcp',
    bbr:       true,  // always sensible default
    // Extra metadata — not node fields, but useful for display
    _collected: {
      os_pretty:      data.os_pretty || '',
      kernel:         data.kernel || '',
      arch:           data.arch || '',
      best_iface:     data.best_iface || '',
      best_gateway:   data.best_gateway || '',
      mem_mb:         data.mem_mb || 0,
      disk_gb:        data.disk_gb || 0,
      pkg_mgr:        data.pkg_mgr || '',
      nomad_installed: !!data.nomad_installed,
      nomad_version:  data.nomad_version || '',
    }
  };

  return { ok: true, fields };
}

// Check if a node has enough data for --auto mode
// Returns true if all the key fields are filled
export function canAuto(node) {
  return !!(node.ip && node.ip !== 'NODE_IP_PLACEHOLDER'
         && node.hostname
         && node.timezone
         && node.os);
}
