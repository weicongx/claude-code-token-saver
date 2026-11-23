---
name: compact-plan
description: Write the single best context-reduction command (/compact <focus> or /handoff) for the work still ahead.
disable-model-invocation: true
argument-hint: "[optional: what comes next]"
---

Decide how to shrink this conversation's context with the least loss for the work still ahead.
Do not run tools or start any work. Use only what this conversation already contains.

Extra notes from the user about what comes next (may be empty): $ARGUMENTS

1. Work out the plan ahead: the open task list, any steps still pending, and the user's notes above.
2. Choose one:
   - `/compact <focus>` if the remaining work builds on this conversation.
   - `/handoff` if the remaining work is unrelated to it, so a fresh session is cheaper.
   - Nothing, if the context is small (under ~40% of the compact window) and the next step is short. Say so in one line.
3. When compacting, write the focus as one line, under ~500 characters, in this order:
   - the goal
   - the remaining steps
   - decisions already made that must not be reopened
   - the exact paths, names, commands and error text still needed
   - what may be dropped (finished side tasks, raw logs, superseded attempts)

Output exactly:
- one fenced code block holding only the command, ready to paste
- one line: why this choice
