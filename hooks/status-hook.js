#!/usr/bin/env node
// token-saver hook. One script for four events, picked by hook_event_name:
//   UserPromptSubmit       status "<model> · <effort> | ctx <used>K/<compact-at>K (<pct>%) | <folder>" for the
//                          top of the reply, plus compact advice when context is high.
//   PostToolUse            mid-turn context check. Once per band (75/83/90% of the real auto-compact point by
//                          default) it asks Claude for a short focus note, so long uninterrupted turns still get
//                          a focused compaction.
//   PreCompact             hands the latest focus note (this compaction cycle only) to the summarizer as
//                          instructions, and saves it for the next step.
//   SessionStart (compact) re-injects that saved note verbatim after the compaction, and re-arms the bands.
// Never fails or blocks anything: on any error it prints nothing and exits 0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./token-saver-lib.js');

const MID_PCT = Math.round((lib.WARN_PCT + lib.URGENT_PCT) / 2);
const PAUSE = process.env.TOKEN_SAVER_PAUSE === '1'; // stop at the last band and hand the user a /compact command
const MARKER = '[token-saver focus]';
const NOTE_MAX = 2000;
const STATE_ROOT = path.join(os.tmpdir(), 'claude-token-saver');
const STATE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const out = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

function bandOf(pct) {
  if (pct == null) return 0;
  return pct >= lib.URGENT_PCT ? 3 : pct >= MID_PCT ? 2 : pct >= lib.WARN_PCT ? 1 : 0;
}

// Per-session state: marker files b1..b3 (one per band already asked) and note.txt (saved by PreCompact).
function stateDir(sessionId) {
  const dir = path.join(STATE_ROOT, String(sessionId || 'unknown').replace(/[^\w-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
// Atomic, so parallel tool calls can't both claim the same band.
function claimBand(dir, band) {
  try {
    fs.closeSync(fs.openSync(path.join(dir, `b${band}`), 'wx'));
    return true;
  } catch {
    return false;
  }
}
function resetBands(dir) {
  for (const b of [1, 2, 3]) fs.rmSync(path.join(dir, `b${b}`), { force: true });
}
function pruneOldState() {
  for (const name of fs.readdirSync(STATE_ROOT)) {
    const p = path.join(STATE_ROOT, name);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > STATE_MAX_AGE_MS) fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* in use or already gone */
    }
  }
}

function onPrompt(input) {
  const cwd = input.cwd || process.cwd();
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || '';
  const u = lib.usage(input.transcript_path);
  let parts;
  let advice = '';
  if (!u) {
    parts = ['new session', folder];
  } else if (u.compacted) {
    parts = [lib.ctxText(u), folder];
  } else {
    let warn = '';
    if (u.pct >= lib.WARN_PCT) {
      warn = 'consider /compact';
      const when = u.pct >= lib.URGENT_PCT
        ? 'Auto-compact is close: do this at the end of this reply.'
        : 'Do this only if this reply finishes a self-contained piece of work.';
      advice = `token-saver compact advice: ${when} Based on the plan of tasks still ahead, ` +
        'end the reply with one fenced code block holding the single best command for the user to run: ' +
        'either `/compact <focus>` (focus = the goal, remaining steps, decisions not to reopen, exact paths/names/errors still ' +
        'needed, and what can be dropped; under ~500 characters) or `/handoff` if the remaining work is unrelated to this ' +
        'conversation. Add one short line saying why.';
    }
    parts = [lib.prettyModel(u.model) + (u.effort ? ` · ${u.effort}` : ''), lib.ctxText(u), warn, folder];
  }
  const status = parts.filter(Boolean).join(' | ');
  return out('UserPromptSubmit', `token-saver status: ${status}` + (advice ? `\n${advice}` : ''));
}

function onToolUse(input) {
  if (input.agent_id) return null; // a subagent's tool call: its context is not the main session's
  const u = lib.usage(input.transcript_path);
  if (!u || u.compacted) return null;
  const band = bandOf(u.pct);
  const dir = stateDir(input.session_id);
  if (band === 0) {
    resetBands(dir); // under the line again (e.g. after a compaction the SessionStart hook missed)
    return null;
  }
  if (!claimBand(dir, band)) return null; // already asked at this level
  const earlier = [1, 2, 3].some((b) => b < band && fs.existsSync(path.join(dir, `b${b}`)));

  let text = `token-saver: context is at ${u.pct}% of the auto-compact point. When the current step is done, ` +
    `write a focus note as plain text in your reply (no tool call), starting with the exact line ${MARKER} and ` +
    `under ~${NOTE_MAX / 4} characters: the goal; the approved plan's file path, if any; steps done; steps left; ` +
    'decisions not to reopen; exact paths, names, commands and errors still needed; what can be dropped. ';
  if (earlier) text += 'It replaces your earlier focus note. ';
  text += PAUSE && band === 3
    ? 'Then stop at that step boundary and end the reply with one fenced code block holding `/compact <the focus ' +
      'note text>` for the user to run, and tell them to type "continue" afterwards.'
    : 'Then continue working without stopping.';
  return out('PostToolUse', text);
}

// Latest focus note the main session wrote since the last compaction, or null.
function latestNote(transcript) {
  const lines = fs.readFileSync(transcript, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const maybeBoundary = line.includes('"compact_boundary"');
    if (!maybeBoundary && (!line.includes(MARKER) || !line.includes('"assistant"'))) continue;
    try {
      const o = JSON.parse(line);
      if (lib.isBoundary(o) && !o.isSidechain) return null; // notes before it belong to an earlier cycle
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
  try {
    pruneOldState();
  } catch {
    /* best effort */
  }
  const dir = stateDir(input.session_id);
  const notePath = path.join(dir, 'note.txt');
  const note = input.transcript_path && fs.existsSync(input.transcript_path) ? latestNote(input.transcript_path) : null;
  if (!note) {
    fs.rmSync(notePath, { force: true });
    return null;
  }
  fs.writeFileSync(notePath, note);
  return 'Put this focus note, verbatim, at the top of the summary. Keep everything it lists (steps left, decisions, ' +
    'exact paths, names, commands and errors) in full detail; summarize what it says can be dropped in one line:\n' + note;
}

function onSessionStart(input) {
  if (input.source !== 'compact') return null;
  const dir = stateDir(input.session_id);
  resetBands(dir); // context is small again; re-arm the mid-turn checks
  const notePath = path.join(dir, 'note.txt');
  if (!fs.existsSync(notePath)) return null;
  const note = fs.readFileSync(notePath, 'utf8');
  fs.rmSync(notePath, { force: true }); // use it once
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
