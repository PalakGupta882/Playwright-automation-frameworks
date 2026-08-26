#!/usr/bin/env node
//
// Turns page-health.json (written by tests/scripts/page-health-report.spec.js)
// into a single self-contained HTML report.
//
//   node scripts/build-page-report.js [in.json] [out.html]
//
// Self-contained on purpose: no CDN, no external CSS, no fonts. The file can be
// opened from disk, attached to a ticket, or published as-is.

const fs = require('fs');
const path = require('path');

const IN = process.argv[2] || path.join(__dirname, '..', 'page-health.json');
const OUT = process.argv[3] || path.join(__dirname, '..', 'page-health-report.html');

if (!fs.existsSync(IN)) {
  console.error(`No ${IN}. Run:\n  npx playwright test scripts/page-health-report.spec.js --project=chromium --workers=1`);
  process.exit(1);
}

const { summary, rows } = JSON.parse(fs.readFileSync(IN, 'utf8'));

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const groups = [...new Set(rows.map((r) => r.group))];
const pct = summary.total ? Math.round((summary.ok / summary.total) * 100) : 0;

// Every distinct problem, most common first — this is the "what is actually
// wrong" view, as opposed to the per-page list.
const problemCounts = new Map();
for (const r of rows) {
  for (const p of r.problems) {
    // Collapse the numeric part so "3 broken image(s)" and "1 broken image(s)"
    // land in the same bucket.
    const key = p.replace(/^\d+/, 'N').replace(/only \d+ chars/, 'only N chars');
    if (!problemCounts.has(key)) problemCounts.set(key, []);
    problemCounts.get(key).push(r);
  }
}
const problemRank = [...problemCounts.entries()].sort((a, b) => b[1].length - a[1].length);

const slowest = [...rows].sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 10);

function statusPill(r) {
  if (!r.ok) return '<span class="pill bad">problem</span>';
  return '<span class="pill good">clean</span>';
}

function rowHtml(r) {
  const details = [];
  if (r.problems.length) {
    details.push(
      `<div class="detail warn"><strong>Problems</strong><ul>${r.problems
        .map((p) => `<li>${esc(p)}</li>`)
        .join('')}</ul></div>`
    );
  }
  if ((r.brokenImages || []).length) {
    details.push(
      `<div class="detail"><strong>Broken images</strong><ul>${r.brokenImages
        .map((b) => `<li><code>${esc(b)}</code></li>`)
        .join('')}</ul></div>`
    );
  }
  if ((r.consoleErrors || []).length) {
    details.push(
      `<div class="detail"><strong>Console errors (${r.consoleErrors.length})</strong><ul>${r.consoleErrors
        .slice(0, 8)
        .map((c) => `<li><code>${esc(c)}</code></li>`)
        .join('')}</ul></div>`
    );
  }
  if ((r.failedRequests || []).length) {
    details.push(
      `<div class="detail"><strong>Failed same-origin requests (${r.failedRequests.length})</strong><ul>${r.failedRequests
        .slice(0, 10)
        .map((f) => `<li><code>${esc(f)}</code></li>`)
        .join('')}</ul></div>`
    );
  }
  details.push(
    `<div class="detail"><strong>Rendered</strong><div class="snippet">${esc(r.bodySnippet || '(nothing)')}</div></div>`
  );

  return `<tr class="${r.ok ? 'ok' : 'bad'}" data-group="${esc(r.group)}" data-ok="${r.ok}">
  <td>${statusPill(r)}</td>
  <td class="name">${esc(r.name)}<div class="url"><code>${esc(r.url)}</code></div></td>
  <td class="num">${r.status == null ? '—' : r.status}</td>
  <td class="num">${r.text == null ? '—' : r.text.toLocaleString()}</td>
  <td class="num">${r.images == null ? '—' : r.images}</td>
  <td class="num ${r.loadersInViewport ? 'flag' : ''}">${r.loadersInViewport == null ? '—' : r.loadersInViewport}</td>
  <td class="num">${r.loadersTotal == null ? '—' : r.loadersTotal}</td>
  <td class="num ${(r.consoleErrors || []).length ? 'flag' : ''}">${(r.consoleErrors || []).length}</td>
  <td class="num">${r.ms == null ? '—' : (r.ms / 1000).toFixed(1) + 's'}</td>
  <td class="expand"><details><summary>view</summary>${details.join('')}</details></td>
</tr>`;
}

const html = `<title>BytePe Page Health</title>
<style>
  :root {
    --bg: #ffffff; --panel: #f7f7f8; --border: #e3e3e6; --text: #16161a;
    --muted: #6b6b76; --good: #0f7b45; --good-bg: #e6f4ec;
    --bad: #b3261e; --bad-bg: #fdeceb; --accent: #2f5fd0;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #131316; --panel: #1c1c21; --border: #2e2e35; --text: #ececf1;
      --muted: #9a9aa6; --good: #4ecb8a; --good-bg: #14301f;
      --bad: #ff8a80; --bad-bg: #341a19; --accent: #8fb0ff;
    }
  }
  :root[data-theme="dark"] {
    --bg: #131316; --panel: #1c1c21; --border: #2e2e35; --text: #ececf1;
    --muted: #9a9aa6; --good: #4ecb8a; --good-bg: #14301f;
    --bad: #ff8a80; --bad-bg: #341a19; --accent: #8fb0ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 4rem;
    background: var(--bg); color: var(--text);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .3rem; letter-spacing: -.01em; }
  .sub { color: var(--muted); margin: 0 0 1.75rem; font-size: .92rem; }
  h2 { font-size: 1.1rem; margin: 2.25rem 0 .75rem; letter-spacing: -.01em; }
  .cards { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: .9rem 1rem; }
  .card .n { font-size: 1.75rem; font-weight: 650; letter-spacing: -.02em; }
  .card .l { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  .card.good .n { color: var(--good); } .card.bad .n { color: var(--bad); }
  .bar { height: 9px; border-radius: 99px; background: var(--bad-bg); overflow: hidden; margin: 1.1rem 0 0; border: 1px solid var(--border); }
  .bar > i { display: block; height: 100%; background: var(--good); width: ${pct}%; }
  .note { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--accent);
          border-radius: 8px; padding: .8rem 1rem; margin: 1.25rem 0; font-size: .9rem; color: var(--muted); }
  .scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; min-width: 900px; font-size: .88rem; }
  th { text-align: left; background: var(--panel); font-weight: 600; font-size: .74rem;
       text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
       padding: .6rem .7rem; border-bottom: 1px solid var(--border); position: sticky; top: 0; }
  td { padding: .6rem .7rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  tr.bad { background: var(--bad-bg); }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .num.flag { color: var(--bad); font-weight: 650; }
  .name { min-width: 230px; }
  .url { color: var(--muted); font-size: .8rem; margin-top: .15rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .85em; }
  .pill { display: inline-block; padding: .12rem .5rem; border-radius: 99px; font-size: .72rem;
          font-weight: 650; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
  .pill.good { background: var(--good-bg); color: var(--good); }
  .pill.bad { background: var(--bad-bg); color: var(--bad); }
  details summary { cursor: pointer; color: var(--accent); font-size: .82rem; }
  .detail { margin: .6rem 0 0; font-size: .84rem; }
  .detail ul { margin: .25rem 0 0; padding-left: 1.1rem; }
  .detail.warn strong { color: var(--bad); }
  .snippet { color: var(--muted); font-size: .8rem; margin-top: .2rem;
             max-height: 5.5rem; overflow: auto; word-break: break-word; }
  .filters { display: flex; gap: .5rem; flex-wrap: wrap; margin: 0 0 .8rem; }
  .filters button { font: inherit; font-size: .82rem; padding: .3rem .75rem; cursor: pointer;
                    background: var(--panel); color: var(--text);
                    border: 1px solid var(--border); border-radius: 99px; }
  .filters button[aria-pressed="true"] { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  ol.rank { padding-left: 1.2rem; }
  ol.rank li { margin: .35rem 0; }
  ol.rank .count { color: var(--bad); font-weight: 650; }
  footer { color: var(--muted); font-size: .82rem; margin-top: 2.5rem;
           border-top: 1px solid var(--border); padding-top: 1rem; }
</style>

<div class="wrap">
  <h1>BytePe page health</h1>
  <p class="sub">
    Every page rendered in a real browser, logged out.
    ${esc(summary.baseUrl)} &middot; ${esc(summary.generatedAt)}
  </p>

  <div class="cards">
    <div class="card"><div class="n">${summary.total}</div><div class="l">Pages checked</div></div>
    <div class="card good"><div class="n">${summary.ok}</div><div class="l">Clean</div></div>
    <div class="card bad"><div class="n">${summary.withProblems}</div><div class="l">With problems</div></div>
    <div class="card"><div class="n">${pct}%</div><div class="l">Pass rate</div></div>
  </div>
  <div class="bar"><i></i></div>

  <div class="note">
    <strong>How to read this.</strong>
    A page is flagged only for something a shopper would notice: a 4xx, the 404 shell
    behind a 200, almost no text, a broken image, or a loader still on screen
    <em>in the viewport</em>. Skeletons below the fold are lazy loading working correctly
    &mdash; they are counted in &ldquo;loaders (total)&rdquo; but never flagged.
    ${
      summary.productsSkipped > 0
        ? `<br><br><strong>Coverage:</strong> ${summary.productsChecked} of ${summary.productsInFixture} product pages were rendered; ${summary.productsSkipped} were not checked.`
        : `<br><br><strong>Coverage:</strong> all ${summary.productsInFixture} product pages in the fixture were rendered.`
    }
  </div>

  ${
    problemRank.length
      ? `<h2>What is actually wrong</h2>
  <ol class="rank">${problemRank
    .map(
      ([p, rs]) =>
        `<li><span class="count">${rs.length}</span> &times; ${esc(p)}
       <div class="url">${esc(rs.slice(0, 6).map((r) => r.name).join(', '))}${
         rs.length > 6 ? ` and ${rs.length - 6} more` : ''
       }</div></li>`
    )
    .join('')}</ol>`
      : '<h2>What is actually wrong</h2><p>Nothing. Every page checked came back clean.</p>'
  }

  <h2>Slowest pages</h2>
  <div class="scroll"><table>
    <thead><tr><th>Page</th><th class="num">Load</th><th class="num">Text</th></tr></thead>
    <tbody>${slowest
      .map(
        (r) =>
          `<tr><td class="name">${esc(r.name)}<div class="url"><code>${esc(r.url)}</code></div></td>
         <td class="num">${(r.ms / 1000).toFixed(1)}s</td>
         <td class="num">${(r.text || 0).toLocaleString()}</td></tr>`
      )
      .join('')}</tbody>
  </table></div>

  <h2>Every page</h2>
  <div class="filters">
    <button data-f="all" aria-pressed="true">All (${summary.total})</button>
    <button data-f="bad" aria-pressed="false">Problems only (${summary.withProblems})</button>
    ${groups
      .map(
        (g) =>
          `<button data-f="${esc(g)}" aria-pressed="false">${esc(g)} (${
            rows.filter((r) => r.group === g).length
          })</button>`
      )
      .join('')}
  </div>
  <div class="scroll"><table id="pages">
    <thead><tr>
      <th>State</th><th>Page</th><th class="num">HTTP</th><th class="num">Text</th>
      <th class="num">Imgs</th><th class="num">Loaders<br>in view</th><th class="num">Loaders<br>total</th>
      <th class="num">Console<br>errors</th><th class="num">Load</th><th></th>
    </tr></thead>
    <tbody>${rows.map(rowHtml).join('\n')}</tbody>
  </table></div>

  <footer>
    Generated by <code>tests/scripts/page-health-report.spec.js</code> &rarr;
    <code>scripts/build-page-report.js</code>.
    Session: ${esc(summary.session)}.
  </footer>
</div>

<script>
  const buttons = [...document.querySelectorAll('.filters button')];
  const rows = [...document.querySelectorAll('#pages tbody tr')];
  buttons.forEach((b) => b.addEventListener('click', () => {
    buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const f = b.dataset.f;
    rows.forEach((r) => {
      const show = f === 'all' ? true
        : f === 'bad' ? r.dataset.ok === 'false'
        : r.dataset.group === f;
      r.style.display = show ? '' : 'none';
    });
  }));
</script>
`;

fs.writeFileSync(OUT, html);
console.log(`wrote ${OUT}  (${summary.ok}/${summary.total} clean, ${summary.withProblems} with problems)`);
