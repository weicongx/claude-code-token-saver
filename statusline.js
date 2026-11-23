#!/usr/bin/env node
// Claude Code status line: "<model> | ctx <used>K/<compact-at>K (<pct>%) | <folder>", measured the same way as the
// reply status (hooks/token-saver-lib.js). Adds "| consider /compact" at TOKEN_SAVER_COMPACT_PCT (default 75%).
// Falls back to Claude Code's own context_window percentage if the transcript can't be read. Never throws.
const path = require('path');

let lib = null;
try {
  lib = require(path.join(__dirname, 'hooks', 'token-saver-lib.js'));
} catch {
  /* fall back below */
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let d = {};
  try {
    d = JSON.parse(raw);
  } catch {
    /* fall through with defaults */
  }
  const model = (d.model && (d.model.display_name || d.model.id)) || 'Claude';

  let ctx = 'ctx ?';
  let warn = '';
  let u = null;
  try {
    u = lib ? lib.usage(d.transcript_path) : null;
  } catch {
    u = null;
  }
  if (u) {
    ctx = lib.ctxText(u);
    if (u.pct >= lib.WARN_PCT) warn = 'consider /compact';
  } else if (d.context_window && typeof d.context_window.used_percentage === 'number') {
    ctx = `ctx ${Math.round(d.context_window.used_percentage)}% of window`;
  }

  const cwd = (d.workspace && d.workspace.current_dir) || d.cwd || '';
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || '';
  process.stdout.write([model, ctx, warn, folder].filter(Boolean).join(' | '));
});
