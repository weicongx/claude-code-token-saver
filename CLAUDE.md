# Global working rules (token-saver)

## Replies
- If the prompt context has a `token-saver status:` line, make the first line of your reply that status text, verbatim, in inline code (e.g. `Opus 5.5 · high | ctx 84K/200K (42%) | my-project`), then continue normally.
- Be terse. Keep every technical fact; drop filler, pleasantries, hedging, and restating the question.
- Code, commands, error messages, file paths, commit messages and PR text stay exact and written normally.
- Write with full clarity for security warnings, irreversible actions, or when I seem confused.
- If I say "normal mode", stop being terse for the rest of the session.

## Delegation (main session = planner, designer, reviewer)
- Broad codebase searches → `Explore` subagent (Sonnet). Ask for `path:line` pointers, not file dumps.
- Test suites, builds, lint, type checks → `validator` subagent (Haiku). Don't run noisy commands in the main session.
- Well-specified, scoped implementation (files named, spec and acceptance check clear) → `fixer` subagent (Sonnet).
- Keep architecture, design, hard debugging and final review in the main session.
- Don't delegate trivial one-step work; a subagent spawn costs more than one grep or one edit.

## Context hygiene
- Send long command output to a file and read it with grep/tail; never dump it into the conversation.
- Read large files in line ranges when only part is needed.
- When a self-contained slice of work is finished, suggest `/compact <focus>` instead of waiting for auto-compact.
- When the next task is unrelated to the current one, suggest a fresh session (`/handoff` writes the note).
- Project-specific rules belong in that project's CLAUDE.md, not here.
