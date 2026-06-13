// site/lib/escape.js
// 职责：HTML 转义
// 输入：原始字符串
// 输出：转义后字符串

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export function html(s) { return String(s).replace(/[&<>"]/g, c => MAP[c]); }
export function attr(s) { return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
