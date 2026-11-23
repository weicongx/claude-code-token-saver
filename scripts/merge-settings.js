#!/usr/bin/env node
// Merge token-saver settings into a Claude Code settings.json without clobbering anything else.
// Usage: node merge-settings.js <settings.json path> <statusline.js path> [compactWindow]
const fs = require('fs');

const [, , settingsPath, statusScript, windowArg] = process.argv;
if (!settingsPath || !statusScript) {
  console.error('usage: node merge-settings.js <settings.json> <statusline.js> [compactWindow]');
  process.exit(2);
}
// Forward slashes work in both Git Bash and PowerShell, which is what Claude Code uses on Windows.
const statusCommand = `node "${statusScript.replace(/\\/g, '/')}"`;
const WINDOW = Number(windowArg) || 200000;

let s = {};
if (fs.existsSync(settingsPath)) {
  const text = fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, '');
  try {
    s = text.trim() ? JSON.parse(text) : {};
  } catch (e) {
    console.error(`settings.json is not valid JSON, refusing to touch it: ${e.message}`);
    process.exit(1);
  }
}

const changes = [];

// 1. Compact earlier (default 200K; Claude Code minimum is 100K).
if (typeof s.autoCompactWindow !== 'number' || s.autoCompactWindow > WINDOW) {
  changes.push(`autoCompactWindow: ${JSON.stringify(s.autoCompactWindow)} -> ${WINDOW}`);
  s.autoCompactWindow = WINDOW;
}
// Per-model values override the top-level one, so lower any that are larger.
for (const [model, cfg] of Object.entries(s.modelSettings || {})) {
  if (cfg && typeof cfg.autoCompactWindow === 'number' && cfg.autoCompactWindow > WINDOW) {
    changes.push(`modelSettings.${model}.autoCompactWindow: ${cfg.autoCompactWindow} -> ${WINDOW}`);
    cfg.autoCompactWindow = WINDOW;
  } else if (cfg && cfg.autoCompactWindow === 'auto') {
    changes.push(`note: modelSettings.${model}.autoCompactWindow is "auto" and overrides the top-level value; left as is`);
  }
}

// 2. Status line (only if none is configured yet, so a custom one is never replaced).
if (!s.statusLine) {
  s.statusLine = { type: 'command', command: statusCommand };
  changes.push(`statusLine: added (${statusCommand})`);
} else if (s.statusLine.command !== statusCommand) {
  changes.push('note: a different statusLine already exists; left as is');
}

fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n', 'utf8');
console.log(changes.length ? changes.map((c) => '  ' + c).join('\n') : '  settings already up to date');
