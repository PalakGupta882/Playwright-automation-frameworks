// PostToolUse hook: syntax-check edited test files.
//
// Reads the hook payload on stdin, and if the edited file lives under tests/
// and ends in .js, runs `node --check` on it. Parse-only — no browser, no
// network, nothing touches the live site.
//
// Scoped to tests/ on purpose: those files are CommonJS, while
// playwright.config.js uses ESM syntax that `node --check` would reject.

const { execFileSync } = require('child_process');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let filePath = '';
  try {
    const payload = JSON.parse(raw);
    filePath =
      (payload.tool_response && payload.tool_response.filePath) ||
      (payload.tool_input && payload.tool_input.file_path) ||
      '';
  } catch {
    process.exit(0); // unreadable payload is not this hook's problem
  }

  if (!/[\\/]tests[\\/].*\.js$/.test(filePath)) process.exit(0);

  try {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
  } catch (err) {
    const detail = (err.stderr || '').toString().trim() || err.message;
    process.stderr.write(`Syntax error in ${filePath}\n${detail}\n`);
    process.exit(2); // surfaces the error back to Claude
  }
});
