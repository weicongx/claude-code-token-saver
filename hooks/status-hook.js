#!/usr/bin/env node
// UserPromptSubmit hook: computes "<model> · <effort> | ctx <used>K/<compact-at>K (<pct>%) | <folder>"
// from the session transcript and hands it to Claude as context, so the reply can start with it.
// Works in the desktop app, where status lines are not rendered. Never fails the prompt.
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAIL_BYTES = 1024 * 1024; // only the end of the transcript is needed
const WARN_PCT = Number(process.env.TOKEN_SAVER_COMPACT_PCT) || 75; // suggest a compact command at slice ends
const URGENT_PCT = Number(process.env.TOKEN_SAVER_URGENT_PCT) || 90; // suggest one on every reply

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

function lastMainAssistant(transcript) {
  const lines = readTail(transcript).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
    try {
      const o = JSON.parse(line);
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

function main(input) {
  const cwd = input.cwd || process.cwd();
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || '';
  let parts;
  let advice = '';

  const entry = input.transcript_path && fs.existsSync(input.transcript_path)
    ? lastMainAssistant(input.transcript_path)
    : null;

  if (!entry) {
    parts = ['new session', folder];
  } else {
    const u = entry.message.usage;
    const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
    const model = entry.message.model || '';
    const effort = entry.effort || entry.perTurnEffort || '';
    const win = compactWindow(model);
    const usedK = Math.round(used / 1000);
    let ctx = `ctx ${usedK}K`;
    let warn = '';
    if (win) {
      const pct = Math.round((used / win) * 100);
      ctx += `/${Math.round(win / 1000)}K (${pct}%)`;
      if (pct >= WARN_PCT) {
        warn = 'consider /compact';
        const when = pct >= URGENT_PCT
          ? 'Auto-compact is close: do this at the end of this reply.'
          : 'Do this only if this reply finishes a self-contained piece of work.';
        advice = `token-saver compact advice: ${when} Based on the plan of tasks still ahead, ` +
          'end the reply with one fenced code block holding the single best command for the user to run: ' +
          'either `/compact <focus>` (focus = the goal, remaining steps, decisions not to reopen, exact paths/names/errors still ' +
          'needed, and what can be dropped; under ~500 characters) or `/handoff` if the remaining work is unrelated to this ' +
          'conversation. Add one short line saying why.';
      }
    }
    parts = [prettyModel(model) + (effort ? ` · ${effort}` : ''), ctx, warn, folder];
  }

  const status = parts.filter(Boolean).join(' | ');
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `token-saver status: ${status}` + (advice ? `\n${advice}` : ''),
    },
  };
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let out;
  try {
    out = main(raw.trim() ? JSON.parse(raw) : {});
  } catch {
    out = null; // stay silent rather than block the prompt
  }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
