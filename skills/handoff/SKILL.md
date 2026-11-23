---
name: handoff
description: Write a short handoff note so the current task can continue in a fresh, small-context session.
disable-model-invocation: true
argument-hint: "[optional focus for the next session]"
---

Write a handoff note for continuing this work in a new session. Base it only on what happened in this conversation; don't invent status.

Output exactly one fenced `text` block, at most 8 lines, in this shape:

```text
GOAL: <what the user is trying to achieve, one line>
DONE: <what is finished and verified>
STATE: <what is changed but unverified or uncommitted; branch name if any>
KEY FILES: <the few paths that matter, comma-separated>
DECISIONS: <choices already made that the next session must not reopen>
NEXT: <the very next concrete step>
WATCH OUT: <gotchas, failing tests, open questions; or "none">
```

If the user passed a focus ($ARGUMENTS), shape NEXT around it.

After the block, add one line: "Start a new session and paste this note as the first message." Nothing else.
