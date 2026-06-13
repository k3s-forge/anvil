// lib/parse-collect.js
// 职责：解析 collect.sh 输出的 JSON → 预填节点字段
// 输入：JSON string
// 输出：{ ok, fields?, error? }
// 纯函数，零副作用

export function parse(jsonStr) {
  let data;
  try { data = JSON.parse(jsonStr); }
  catch (e) { return { ok: false, error: 'JSON parse failed: ' + e.message }; }

  if (!data.hostname && !data.auto_hostname) {
    return { ok: false, error: 'Missing required fields: hostname or auto_hostname' };
  }

  // Prefer auto-generated hostname (FQDN-based), fall back to raw hostname
  const name = data.auto_hostname || data.hostname || '';

  const fields = {
    name:      name,
    ip:        data.best_ip || '',
    hostname:  name,
    timezone:  data.timezone || 'UTC',
    os:        (data.os === 'freebsd') ? 'freebsd' : 'linux',
    network:   (data.network_type === 'static' && data.best_gateway) ? 'static' : 'dhcp',
    bbr:       true,
    // FQDN metadata
    country_iso:   data.country_iso || 'xx',
    region_name:   data.region_name || 'unknown',
    final_type:    data.final_type || 'unknown',
    auto_fqdn:     data.auto_fqdn || '',
    auto_hostname: data.auto_hostname || '',
    merchant:      '',  // user fills in UI
    // Extra metadata
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
      has_ipv4:       !!data.has_ipv4,
      has_ipv6:       !!data.has_ipv6,
      is_cgnat:       !!data.is_cgnat,
      country_iso:    data.country_iso || '',
      region_name:    data.region_name || '',
      final_type:     data.final_type || '',
    }
  };

  return { ok: true, fields };
}

export function canAuto(node) {
  return !!(node.ip && node.ip !== 'NODE_IP_PLACEHOLDER'
         && node.hostname
         && node.timezone
         && node.os);
}
