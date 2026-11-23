# Claude Code token-saver

A token-saving setup for Claude Code, for someone with a single Claude subscription: model tiering,
log-free subagents, terse replies, earlier and better-focused compaction, and live context visibility.
It uses only built-in Claude Code features: no third-party plugins, nothing on `@latest`.

## What gets installed (into `~/.claude`)

| File | What it does |
|---|---|
| `agents/Explore.md` | Overrides the built-in **Explore** subagent to run on **Haiku**. The built-in runs on the parent session's model, which is Opus if that's your default. |
| `agents/validator.md` | **Haiku, medium effort.** Runs tests, builds and lint, saves the full log to `$TMPDIR/claude-logs/`, and returns pass/fail plus at most 5 verbatim failure excerpts and the log path. |
| `agents/fixer.md` | **Sonnet, high effort.** Implements a precise, already-decided spec, stays in scope, stops on ambiguity, and returns a short change list. |
| `CLAUDE.md` (marked block) | About 25 lines of global rules: terse replies (code, errors and commands stay exact), when to delegate to each agent, and context hygiene. Anything else already in your `CLAUDE.md` is kept. |
| `skills/handoff/SKILL.md` | `/handoff` writes a note of 8 lines or fewer for continuing in a fresh session. It is user-invoked only (`disable-model-invocation`), so it costs nothing per turn. |
| `statusline.js` | Status line: `Opus 5.5 \| ctx 64K (6%) \| my-project`. It adds `consider /compact` past 150K tokens. |
| `settings.json` (merged) | `autoCompactWindow: 200000`, top level and for any per-model value above it, plus the `statusLine` entry (added only if you don't already have one). |

Subagents get an explicit `tools:` allowlist. Per the Claude Code docs, that means they do **not**
inherit MCP tools, so worker agents carry no MCP schemas.

## Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Options: `-CompactWindow 150000` (min 100000), `-SkipExploreOverride`, `-ClaudeDir <path>`.
The installer backs up everything it touches to `~/.claude/token-saver-backup-<timestamp>/` and
is idempotent. Start a **new** session afterwards, since agents and `CLAUDE.md` load at session start.

Requires Node.js, which runs the status line and the settings merge.

## Verify (in a new session)

1. Ask "Which subagent types can you launch?" and check that `validator` and `fixer` are listed.
2. Ask for something like "use the validator to run `node --version`". You should get the short
   `RESULT / COMMAND / LOG` report.
3. Ask "Quote the first heading of your user-level CLAUDE.md." The answer should be "Global working rules (token-saver)".
4. Type `/handoff`. It should produce the GOAL/DONE/NEXT note.
5. In the terminal CLI, the status line should show at the bottom. The desktop app may not render status lines.

## Design principles

| Principle | Here |
|---|---|
| Tier models: frontier model plans and reviews, cheap model does volume work | Main session stays Opus. Explore and validator run on Haiku, fixer on Sonnet. |
| A validator keeps raw logs out of the main context | `validator` writes logs to a file and returns excerpts |
| Worker agents get no MCP schemas and no skills | Explicit `tools:` allowlists |
| Don't run test loops at max effort | Validator runs at `medium` |
| Compress at phase boundaries, not at 95% full | `/compact <focus>` rule, plus auto-compact at 200K instead of the default (about 967K on 1M-token models) |
| Terse output, but code, errors and commands stay exact, and normal mode for warnings | "Lite" terseness rule. Say "normal mode" to switch it off. |
| Global instructions stay small; project rules live in the repo | Global block is about 25 lines |
| Disable unused MCP servers, load lazily | Claude Code already defers MCP tool schemas by default (tool search) |
| Fresh session per unrelated task, with a short handoff note | `/handoff` |
| Logs in files, never pasted into chat | `CLAUDE.md` rule plus validator behaviour |
| Live token visibility | Status line, plus `/context` and `/cost` |
| Back up and merge, never clobber | Installer backups, marked `CLAUDE.md` block, non-destructive JSON merge |

## Deliberately left out

- **Third-party plugins on `@latest` or auto-update** (context pruners, output compressors): unreviewed code
  that can change silently. Claude Code's built-in compaction and deferred MCP loading cover the same ground.
- **Using a Claude subscription in a third-party harness**: Anthropic's terms prohibit third-party harnesses
  on Pro/Max OAuth.
- **Separate orchestrator, oracle and designer agents**: the main Opus session already does these jobs, and extra
  agents only add description tokens.
- **A separate arbiter (review) agent**: the built-in `/code-review` covers it.
- **Extreme terseness** (dropping articles and grammar): saves little compared with context size and hurts clarity.
- **Deleting synced skills or connectors**: those are managed from claude.ai and the app. Turn off ones
  you never use there.

## Trade-offs to know

- **Haiku Explore** is cheaper and faster but shallower. Use `-SkipExploreOverride` or delete
  `~/.claude/agents/Explore.md` if searches start missing things.
- **Compacting at 200K** keeps each turn cheaper but summarizes earlier detail sooner. Re-run with
  a larger `-CompactWindow` or use `/autocompact` to tune it.
- Terseness rules apply to prose only. If replies get too clipped, say "normal mode" or edit the block.

## Uninstall

1. Delete `~/.claude/agents/{Explore,fixer,validator}.md`, `~/.claude/skills/handoff/` and `~/.claude/statusline.js`.
2. Remove the `<!-- token-saver:begin -->` … `<!-- token-saver:end -->` block from `~/.claude/CLAUDE.md`.
3. Restore `settings.json` from the earliest `~/.claude/token-saver-backup-*` folder.
