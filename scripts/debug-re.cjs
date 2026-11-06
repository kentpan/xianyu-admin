const fs = require('fs');
const files = ['app/pages/keywords.vue', 'app/pages/orders.vue', 'app/pages/admin/logs.vue', 'app/pages/admin/backup.vue', 'app/pages/dashboard.vue'];
const seg = /  if \((?:isNaN|Number\.isNaN)\)\(d\.getTime\(\)\) return (?:t|String\(t\))\n/;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  console.log(f, '→ p3seg:', seg.test(src));
}
const full = /function formatTime\(([^)]*)\) \{\n  if \(!t\) return ('—'|'-')\n  const d = new Date\((?:String\(t\)|t)(\.replace\(' ', 'T'\))?\)\n  if \((?:isNaN|Number\.isNaN)\)\(d\.getTime\(\)\) return (?:t|String\(t\))\n  return d\.toLocaleString\('zh-CN', \{([^}]+)\}\)\n\}/;
console.log('full keywords.vue:', full.test(fs.readFileSync('app/pages/keywords.vue', 'utf8')));
