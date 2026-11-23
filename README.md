# Claude Code token-saver

A token-saving setup for Claude Code, for someone with a single Claude subscription: model tiering,
log-free subagents, terse replies, earlier and better-focused compaction, and live context visibility.
It uses only built-in Claude Code features: no third-party plugins, nothing on `@latest`.

## What gets installed (into `~/.claude`)

| File | What it does |
|---|---|
| `agents/Explore.md` | Overrides the built-in **Explore** subagent to run on **Sonnet**. The built-in runs on the parent session's model, which is Opus if that's your default. |
| `agents/validator.md` | **Haiku, medium effort.** Runs tests, builds and lint, saves the full log to `$TMPDIR/claude-logs/`, and returns pass/fail plus at most 5 verbatim failure excerpts and the log path. |
| `agents/fixer.md` | **Sonnet, high effort.** Implements a precise, already-decided spec, stays in scope, stops on ambiguity, and returns a short change list. |
| `CLAUDE.md` (marked block) | About 25 lines of global rules: terse replies (code, errors and commands stay exact), when to delegate to each agent, and context hygiene. Anything else already in your `CLAUDE.md` is kept. |
| `skills/handoff/SKILL.md` | `/handoff` writes a note of 8 lines or fewer for continuing in a fresh session. It is user-invoked only (`disable-model-invocation`), so it costs nothing per turn. |
| `skills/compact-plan/SKILL.md` | `/compact-plan [what comes next]` has the main session read the plan ahead and output one ready-to-paste command, `/compact <focus>` or `/handoff`, plus a one-line reason. It is user-invoked only. |
| `hooks/status-hook.js` + `token-saver-lib.js` | Hook for `UserPromptSubmit`, `PostToolUse`, `PreCompact` and `SessionStart`. On each prompt it reads the session transcript and passes `Opus 5.5 · high \| ctx 122K/167K (73%) \| my-project` (tokens against the auto-compact point) to Claude. A `CLAUDE.md` rule makes that the **first line of every reply**. Works in the desktop app. At 75% or more it adds `consider /compact` and **compact advice** (see below). |
| `statusline.js` | Status line for the terminal CLI: `Opus 5.5 \| ctx 64K/167K (38%) \| my-project`, measured the same way as the reply status. It adds `consider /compact` at 75%. |
| `settings.json` (merged) | `autoCompactWindow: 200000`, top level and for any per-model value above it. Also the `statusLine` entry (added only if you don't already have one) and the `UserPromptSubmit`, `PostToolUse`, `PreCompact` and `SessionStart` (`compact`) hooks, each added once. |

Subagents get an explicit `tools:` allowlist. Per the Claude Code docs, that means they do **not**
inherit MCP tools, so worker agents carry no MCP schemas.

## Automatic compact advice

Claude Code doesn't let hooks or Claude run `/compact`, so this setup does the next best thing: it
writes the command for you and you paste it.

- **75% or more** of the compact window (`TOKEN_SAVER_COMPACT_PCT`): at the end of a reply that finishes a
  self-contained piece of work, Claude adds one fenced `/compact <focus>` (or `/handoff`) command and a reason.
- **90% or more** (`TOKEN_SAVER_URGENT_PCT`): it does this on every reply, because auto-compact is close.
- The focus line is written by the **main session**, which already knows the plan ahead. A separate
  agent would start cold and would have to re-read the conversation just to write one line.
- Run `/compact-plan` at any time to get the same command on demand.

**Percentages are relative to the real compaction point**, not to `autoCompactWindow`. Claude Code
keeps a reserve of about 33K below the window. In a measured session, a 200K window auto-compacted
at 168K (`compact_boundary` `preTokens: 168263`), so the status shows `ctx 131K/167K (78%)`. Override
the reserve with `TOKEN_SAVER_COMPACT_RESERVE` if your version differs.

Set the `TOKEN_SAVER_*` variables in the `"env"` block of `~/.claude/settings.json`, for example
`"env": { "TOKEN_SAVER_PAUSE": "1" }`. Hooks inherit Claude Code's environment.

### During long uninterrupted turns (plan → approve → work)

A long autonomous turn is a single prompt, so the advice above fires only once, at the start. If
context reaches the auto-compact point mid-turn, Claude Code compacts with a generic summary. To
make that compaction focused without stopping the work:

1. **Mid-turn check (`PostToolUse`).** After every tool call, the hook silently recomputes context
   use. The first time it crosses each band (75%, 83% and 90% of the compaction point by default), it asks Claude to finish the
   current step, write a short note starting with `[token-saver focus]` (goal, plan file, steps done and
   left, locked decisions, exact paths and errors, what to drop), then **keep working**. That's two or
   three notes per session at most. Subagent tool calls are ignored.
2. **Summarizer instructions (`PreCompact`).** Just before any compaction, auto or manual, the hook
   finds the latest note written since the previous compaction, so an old note is never reused, and prints it. Per the hooks docs, a `PreCompact` hook's
   stdout becomes instructions for the compaction summary: keep the note verbatim and keep what it lists
   in full detail. A matching `CLAUDE.md` rule backs this up.
3. **Re-injection (`SessionStart`, matcher `compact`).** Right after any compaction, the hook finds
   the latest note in the transcript and adds it back word for word, so it survives even if the
   summary drops it.

In effect, auto-compact runs with a focus that Claude wrote from the plan. Set `TOKEN_SAVER_PAUSE=1`
if you'd rather have Claude stop at 90% and hand you an exact `/compact <focus>` command. You paste
it, then type "continue".

## Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Options: `-CompactWindow 250000` (min 100000), `-SkipExploreOverride`, `-ClaudeDir <path>`.
`-CompactWindow` sets the window exactly, raising or lowering it, at the top level and on any numeric
per-model value. Without it, the first install lowers a window above 200K, and later re-installs
leave the current window alone. With a 250K window the status reads `ctx …/217K`.
The installer backs up everything it touches to `~/.claude/token-saver-backup-<timestamp>/` and
is idempotent. Start a **new** session afterwards, since agents and `CLAUDE.md` load at session start.

Requires Node.js, which runs the status line and the settings merge.

The installer is Windows-only (PowerShell). On macOS or Linux, copy `agents/`, `skills/`, `hooks/` and
`statusline.js` into `~/.claude/`, add the `CLAUDE.md` block by hand, and run
`node scripts/merge-settings.js ~/.claude/settings.json ~/.claude/statusline.js` to merge the settings.

## Verify (in a new session)

1. Ask "Which subagent types can you launch?" and check that `validator` and `fixer` are listed.
2. Ask for something like "use the validator to run `node --version`". You should get the short
   `RESULT / COMMAND / LOG` report.
3. Ask "Quote the first heading of your user-level CLAUDE.md." The answer should be "Global working rules (token-saver)".
4. Type `/handoff`. It should produce the GOAL/DONE/NEXT note. Then type `/compact-plan`, which should output one command block plus a reason.
5. Every reply should start with a status line like `Opus 5.5 · high | ctx 71K/167K (43%) | my-project`.
6. In the terminal CLI, the status line should show at the bottom. The desktop app may not render status lines.

## Design principles

| Principle | Here |
|---|---|
| Tier models: frontier model plans and reviews, cheap model does volume work | Main session stays Opus. Explore and fixer run on Sonnet, validator on Haiku. |
| A validator keeps raw logs out of the main context | `validator` writes logs to a file and returns excerpts |
| Worker agents get no MCP schemas and no skills | Explicit `tools:` allowlists |
| Don't run test loops at max effort | Validator runs at `medium` |
| Compress at phase boundaries, not at 95% full | Automatic compact advice at 75% and 90%, `/compact-plan`, plus auto-compact at 200K instead of the default (about 967K on 1M-token models) |
| Terse output, but code, errors and commands stay exact, and normal mode for warnings | "Lite" terseness rule. Say "normal mode" to switch it off. |
| Global instructions stay small; project rules live in the repo | Global block is about 25 lines |
| Disable unused MCP servers, load lazily | Claude Code already defers MCP tool schemas by default (tool search) |
| Fresh session per unrelated task, with a short handoff note | `/handoff` |
| Logs in files, never pasted into chat | `CLAUDE.md` rule plus validator behaviour |
| Live token visibility | Status printed at the top of each reply (hook), terminal status line, `/context`, `/cost` |
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

- **Sonnet Explore** costs less than Opus and searches nearly as well. Switch `model:` to `haiku`
  for cheaper searches, or use `-SkipExploreOverride` to keep the built-in.
- **The reply status** shows context as of the start of the turn, from the last main-session API
  call. It costs about 30 tokens per prompt. Remove the hook and the first `CLAUDE.md` rule to drop it.
- **The mid-turn check** starts Node once per tool call (tens of milliseconds) and costs no tokens
  until a band is crossed. Each focus note costs about 150 output tokens.
- **Compacting at 200K** keeps each turn cheaper but summarizes earlier detail sooner. Re-run with
  a larger `-CompactWindow` or use `/autocompact` to tune it.
- **Fixed overhead is large, and mostly not yours to cut.** In the desktop app, the first API call of a
  measured session was already 71K tokens (system prompt, app tools and their instructions), and context
  restarted at about 92K after a compaction (71K plus a 21K summary). With a 200K window, that leaves
  about 97K of working room before the first compaction and about 75K after each later one. With 250K,
  it leaves about 146K and 125K, but each call costs more.
- **Turning off unused connectors barely helps.** In a re-measured session, turning off a connector,
  Workflows (`"enableWorkflows": false`) and prompt suggestions changed the first call from 71K to
  70.8K. Tools you don't use are deferred and cost only their names until loaded. What costs real
  tokens is tools loaded in full in every session, such as the desktop app's built-in browser
  (Settings → Claude Code → Browser). Turn those off if you never use them, and run `/context` to see
  your breakdown.
- Terseness rules apply to prose only. If replies get too clipped, say "normal mode" or edit the block.

## Uninstall

1. Delete `~/.claude/agents/{Explore,fixer,validator}.md`, `~/.claude/skills/handoff/`, `~/.claude/skills/compact-plan/`, `~/.claude/statusline.js`, `~/.claude/hooks/status-hook.js` and `~/.claude/hooks/token-saver-lib.js`.
2. Remove the `<!-- token-saver:begin -->` … `<!-- token-saver:end -->` block from `~/.claude/CLAUDE.md`.
3. Restore `settings.json` from the earliest `~/.claude/token-saver-backup-*` folder.
4. Optionally delete the `claude-token-saver` folder in your temp directory, which holds the per-session band state.
