// Pulls failure messages out of an unpacked Playwright HTML-report bundle.
// Usage: node scripts/extract-failures.js <dir-of-report-json> <out.txt>
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const out = process.argv[3];
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

const rows = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch {
    continue;
  }
  const file = j.fileName || j.fileId || f;
  for (const t of j.tests || []) {
    for (const r of t.results || []) {
      if (r.status === 'passed' || r.status === 'skipped') continue;
      for (const e of r.errors || []) {
        rows.push({
          file,
          line: (t.location && t.location.line) || '?',
          title: (t.path || []).concat(t.title).join(' > '),
          msg: String(e.message || '').replace(ANSI, ''),
        });
      }
    }
  }
}

const text = rows
  .map((r) => `#### ${r.file}:${r.line} - ${r.title}\n${r.msg.split('\n').slice(0, 30).join('\n')}`)
  .join('\n\n');
fs.writeFileSync(out, text);
console.log('failures with errors:', rows.length);
