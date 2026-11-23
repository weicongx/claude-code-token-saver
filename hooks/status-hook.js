#!/usr/bin/env node
// token-saver hook. One script for three events, picked by hook_event_name:
//   UserPromptSubmit       status "<model> · <effort> | ctx <used>K/<compact-at>K (<pct>%) | <folder>" for the
//                          top of the reply, plus compact advice when context is high.
//   PostToolUse            mid-turn context check. Once per band (75/82/90% by default) it asks Claude to write
//                          a short focus note, so a long uninterrupted turn still gets a focused compaction.
//   PreCompact             hands the latest focus note to the summarizer as compaction instructions.
//   SessionStart (compact) re-injects the latest focus note after a compaction, verbatim (backup).
// Never fails or blocks anything: on any error it prints nothing and exits 0.
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAIL_BYTES = 1024 * 1024; // only the end of the transcript is needed for usage
const WARN_PCT = Number(process.env.TOKEN_SAVER_COMPACT_PCT) || 75;
const URGENT_PCT = Number(process.env.TOKEN_SAVER_URGENT_PCT) || 90;
const MID_PCT = Math.round((WARN_PCT + URGENT_PCT) / 2);
const PAUSE = process.env.TOKEN_SAVER_PAUSE === '1'; // stop at 90% and hand the user a /compact command
const MARKER = '[token-saver focus]';
const NOTE_MAX = 2000;
const STATE_DIR = path.join(os.tmpdir(), 'claude-token-saver');

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

// Context use as of the last main-session API call, or null if there is none yet.
function usage(input) {
  const entry = input.transcript_path && fs.existsSync(input.transcript_path)
    ? lastMainAssistant(input.transcript_path)
    : null;
  if (!entry) return null;
  const u = entry.message.usage;
  const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
  const model = entry.message.model || '';
  const win = compactWindow(model);
  return {
    used,
    model,
    effort: entry.effort || entry.perTurnEffort || '',
    win,
    pct: win ? Math.round((used / win) * 100) : null,
  };
}

function bandOf(pct) {
  if (pct == null) return 0;
  return pct >= URGENT_PCT ? 3 : pct >= MID_PCT ? 2 : pct >= WARN_PCT ? 1 : 0;
}

function statePath(sessionId) {
  return path.join(STATE_DIR, String(sessionId || 'unknown').replace(/[^\w-]/g, '_') + '.json');
}
function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8'));
  } catch {
    return { band: 0 };
  }
}
function writeState(sessionId, st) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(statePath(sessionId), JSON.stringify(st));
}

function out(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

function onPrompt(input) {
  const cwd = input.cwd || process.cwd();
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || '';
  const u = usage(input);
  let parts;
  let advice = '';
  if (!u) {
    parts = ['new session', folder];
  } else {
    let ctx = `ctx ${Math.round(u.used / 1000)}K`;
    let warn = '';
    if (u.win) {
      ctx += `/${Math.round(u.win / 1000)}K (${u.pct}%)`;
      if (u.pct >= WARN_PCT) {
        warn = 'consider /compact';
        const when = u.pct >= URGENT_PCT
          ? 'Auto-compact is close: do this at the end of this reply.'
          : 'Do this only if this reply finishes a self-contained piece of work.';
        advice = `token-saver compact advice: ${when} Based on the plan of tasks still ahead, ` +
          'end the reply with one fenced code block holding the single best command for the user to run: ' +
          'either `/compact <focus>` (focus = the goal, remaining steps, decisions not to reopen, exact paths/names/errors still ' +
          'needed, and what can be dropped; under ~500 characters) or `/handoff` if the remaining work is unrelated to this ' +
          'conversation. Add one short line saying why.';
      }
    }
    parts = [prettyModel(u.model) + (u.effort ? ` · ${u.effort}` : ''), ctx, warn, folder];
  }
  const status = parts.filter(Boolean).join(' | ');
  return out('UserPromptSubmit', `token-saver status: ${status}` + (advice ? `\n${advice}` : ''));
}

function onToolUse(input) {
  if (input.agent_id) return null; // a subagent's tool call: its context is not the main session's
  const u = usage(input);
  if (!u) return null;
  const band = bandOf(u.pct);
  const st = readState(input.session_id);
  if (band === 0) {
    if (st.band) writeState(input.session_id, { band: 0 }); // back under the line (e.g. after a compaction)
    return null;
  }
  if (band <= (st.band || 0)) return null; // already asked at this level
  writeState(input.session_id, { band });

  let text = `token-saver: context is at ${u.pct}% of the auto-compact point. When the current step is done, ` +
    `write a focus note as plain text in your reply (no tool call), starting with the exact line ${MARKER} and ` +
    `under ~${NOTE_MAX / 4} characters: the goal; the approved plan's file path, if any; steps done; steps left; ` +
    'decisions not to reopen; exact paths, names, commands and errors still needed; what can be dropped. ';
  if (st.band) text += 'It replaces your earlier focus note. ';
  text += PAUSE && band === 3
    ? 'Then stop at that step boundary and end the reply with one fenced code block holding `/compact <the focus ' +
      'note text>` for the user to run, and tell them to type "continue" afterwards.'
    : 'Then continue working without stopping.';
  return out('PostToolUse', text);
}

// Latest focus note the main session wrote, or null.
function latestNote(transcript) {
  const lines = fs.readFileSync(transcript, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes(MARKER) || !line.includes('"assistant"')) continue;
    try {
      const o = JSON.parse(line);
      if (o.type !== 'assistant' || o.isSidechain || !o.message || !Array.isArray(o.message.content)) continue;
      for (let j = o.message.content.length - 1; j >= 0; j--) {
        const b = o.message.content[j];
        if (b.type !== 'text' || typeof b.text !== 'string') continue;
        const at = b.text.search(/^\[token-saver focus\]/m); // the note starts a line; mentions mid-sentence don't count
        if (at >= 0) return b.text.slice(at, at + NOTE_MAX).trim();
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

// Plain stdout from a PreCompact hook becomes instructions for the compaction summary.
function onPreCompact(input) {
  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return null;
  const note = latestNote(input.transcript_path);
  if (!note) return null;
  return 'Put this focus note, verbatim, at the top of the summary. Keep everything it lists (steps left, decisions, ' +
    'exact paths, names, commands and errors) in full detail; summarize what it says can be dropped in one line:\n' + note;
}

function onSessionStart(input) {
  if (input.source !== 'compact') return null;
  writeState(input.session_id, { band: 0 }); // context is small again; re-arm the mid-turn checks
  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return null;
  const note = latestNote(input.transcript_path);
  if (!note) return null;
  return out('SessionStart', 'token-saver: the focus note you wrote before this compaction, verbatim. Treat it as the ' +
    `plan of record for the remaining work:\n${note}`);
}

function main(input) {
  switch (input.hook_event_name) {
    case 'PostToolUse': return onToolUse(input);
    case 'PreCompact': return onPreCompact(input);
    case 'SessionStart': return onSessionStart(input);
    default: return onPrompt(input);
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let result;
  try {
    result = main(raw.trim() ? JSON.parse(raw) : {});
  } catch {
    result = null; // stay silent rather than block anything
  }
  if (result) process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result));
  process.exit(0);
});
