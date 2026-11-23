#!/usr/bin/env node
// Claude Code status line: "<model> | ctx <used>K (<pct>%) | <folder>"
// Adds "| consider /compact" once context passes TOKEN_SAVER_WARN_K thousand tokens (default 150).
// Reads the JSON Claude Code passes on stdin; never throws.

const WARN_K = Number(process.env.TOKEN_SAVER_WARN_K) || 150;

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

  const cw = d.context_window || {};
  const pct = typeof cw.used_percentage === 'number' ? cw.used_percentage : null;
  const size = typeof cw.context_window_size === 'number' ? cw.context_window_size : null;

  let ctx = 'ctx ?';
  let warn = '';
  if (pct !== null) {
    if (size) {
      const usedK = Math.round((pct / 100) * size / 1000);
      ctx = `ctx ${usedK}K (${Math.round(pct)}%)`;
      if (usedK >= WARN_K) warn = 'consider /compact';
    } else {
      ctx = `ctx ${Math.round(pct)}%`;
    }
  }

  const cwd = (d.workspace && d.workspace.current_dir) || d.cwd || '';
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || '';

  process.stdout.write([model, ctx, warn, folder].filter(Boolean).join(' | '));
});
