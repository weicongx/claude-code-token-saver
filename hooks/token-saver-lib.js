// Shared by hooks/status-hook.js and statusline.js: context use measured from the session transcript.
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAIL_BYTES = 1024 * 1024; // only the end of the transcript is needed for usage
// Auto-compact fires about this many tokens below autoCompactWindow. Observed: window 200K compacted at
// ~168K (compact_boundary preTokens 168263); the 1M default compacts at ~967K.
const RESERVE = Number(process.env.TOKEN_SAVER_COMPACT_RESERVE) || 33000;
const WARN_PCT = Number(process.env.TOKEN_SAVER_COMPACT_PCT) || 75;
const URGENT_PCT = Number(process.env.TOKEN_SAVER_URGENT_PCT) || 90;

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

const isBoundary = (o) => o.type === 'system' && o.subtype === 'compact_boundary';

// Last main-session API response with usage; { compacted: true } if a compaction came after it; else null.
function lastMainAssistant(transcript) {
  const lines = readTail(transcript).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const maybeBoundary = line.includes('"compact_boundary"');
    if (!maybeBoundary && (!line.includes('"assistant"') || !line.includes('"usage"'))) continue;
    try {
      const o = JSON.parse(line);
      if (isBoundary(o) && !o.isSidechain) return { compacted: true };
      if (o.type === 'assistant' && !o.isSidechain && o.message && o.message.usage) return o;
    } catch {
      /* partial first line of the tail, or a non-JSON line */
    }
  }
  return null;
}

function prettyModel(id) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id || '');
  if (!m) return id || 'Claude';
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return m[3] && m[3].length <= 2 ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`;
}

function compactWindow(model) {
  try {
    const file = path.join(os.homedir(), '.claude', 'settings.json');
    const s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const per = s.modelSettings && s.modelSettings[model] && s.modelSettings[model].autoCompactWindow;
    const w = typeof per === 'number' ? per : s.autoCompactWindow;
    return typeof w === 'number' ? w : null;
  } catch {
    return null;
  }
}

// Token count at which auto-compact actually fires, or null if no window is configured.
function compactPoint(model) {
  const w = compactWindow(model);
  return w ? Math.max(w - RESERVE, Math.round(w / 2)) : null;
}

// null (no API call yet) | { compacted: true } | { used, model, effort, point, pct }
function usage(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const entry = lastMainAssistant(transcriptPath);
  if (!entry || entry.compacted) return entry;
  const u = entry.message.usage;
  const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
  const model = entry.message.model || '';
  const point = compactPoint(model);
  return {
    used,
    model,
    effort: entry.effort || entry.perTurnEffort || '',
    point,
    pct: point ? Math.round((used / point) * 100) : null,
  };
}

// "ctx 131K/167K (78%)", or "ctx 131K" when no compact window is configured.
function ctxText(u) {
  if (u.compacted) return 'ctx just compacted';
  const k = (n) => `${Math.round(n / 1000)}K`;
  return u.point ? `ctx ${k(u.used)}/${k(u.point)} (${u.pct}%)` : `ctx ${k(u.used)}`;
}

module.exports = { WARN_PCT, URGENT_PCT, isBoundary, prettyModel, usage, ctxText };
