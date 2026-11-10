// codemod: app/pages + app/components 下 shape-1 formatTime → 北京时间委托 (一次性)
const fs = require('fs');
const path = require('path');

const glob = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? glob(path.join(dir, e.name)) : e.name.endsWith('.vue') ? [path.join(dir, e.name)] : [],
  );

const files = [...glob('app/pages'), ...glob('app/components')];

const re = /function formatTime\(([^)]*)\) \{\n  if \(!t\) return ('—'|'-')\n  const d = new Date\((?:String\(t\)|t)(\.replace\(' ', 'T'\))?\)\n  if \((?:isNaN|Number\.isNaN)\(d\.getTime\(\)\)\) return (?:t|String\(t\))\n  return d\.toLocaleString\('zh-CN', \{([^}]+)\}\)\n\}/g;

let changed = 0;
let filesChanged = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let n = 0;
  const out = src.replace(re, (m, sig, ph, _rep, opts) => {
    n++;
    const delegate = opts.includes('year') || opts.includes('second') ? 'bjTime' : 'bjShort';
    return (
      'function formatTime(' +
      sig +
      ') {\n  // 北京时间 (v2.3.0): DB 为 UTC 存储, naive 串按 UTC 解析后统一按 Asia/Shanghai 展示\n  return ' +
      delegate +
      '(t) || ' +
      ph +
      '\n}'
    );
  });
  if (n) {
    fs.writeFileSync(f, out);
    changed += n;
    filesChanged++;
    console.log(path.relative(process.cwd(), f), '→', n);
  }
}
console.log('TOTAL replaced:', changed, 'in', filesChanged, 'files');
