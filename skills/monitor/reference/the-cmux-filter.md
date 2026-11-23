# The cmux notification filter — no cmux banner reaches the owner; the floating note is the one surface

The owner's words: cmux is always notifying for non-supervisor stuff, so poor signal to noise ratio. And
later, in the owner's words: the owner is thinking of just dropping cmux notifications entirely and just using these floating macOS
notes. They're quite nice, and the owner likes when they link the owner to something useful when the owner clicks. A cmux banner
carries neither the act nor a link to it; a `hand post` note carries both. So every cmux banner is off, the
supervisor chair's included, and a step or question aimed at the owner goes up as a note.

## What it changes, and what it deliberately leaves alone

cmux pipes one notification's policy as JSON on stdin and takes the script's stdout as the updated policy.
Seven effects are independently switchable. The filter touches **two**:

| Effect                                                             | Every workspace, the chair's too |
| ------------------------------------------------------------------ | -------------------------------- |
| `desktop`, `sound`                                                 | **false**                        |
| `record`, `markUnread`, `reorderWorkspace`, `paneFlash`, `command` | untouched                        |

So nothing is lost. A suppressed row still lands in cmux's own list, still marks unread, still reorders the
sidebar — it just stops interrupting whatever the owner is doing. The one interruption is the floating note.

## Two files, two lifetimes

`monitor filter install` writes **the filter** under `$SLOPWEAVER_HOME/hooks/`, rewritten on every install,
and **a one-line `exec` shim** at the path cmux's config already names, written once. The owner's `cmux.json` is
heavily commented JSONC; rewriting it to point at a new path would lose those comments and need a reload, so
the filter never touches the config; its one writer is `fleet restore-policy --apply`, a single key added in
place with its comments kept ([fleet](../../fleet/SKILL.md)). Whatever stood at the hook path is copied to `<path>.slopweaver.bak`
first, and only if no backup is already there.

The hook path is discovered from `~/.config/cmux/cmux.json` when `--hook-script` is absent, and the verb
refuses rather than guessing when the config declares no hook or more than one.

## It fails open

No `jq` on the PATH, or a payload `jq` cannot parse — each passes the policy through unchanged, because
cmux's own behaviour on a hook error is its default policy anyway. The worst case here is the noise that was
already there, never a policy cmux cannot read.

## The decision log is the witness

Every judgement appends one line, naming the workspace that spoke, to `$SLOPWEAVER_HOME/hooks/cmux-notification-decisions.jsonl`, and
`monitor filter status` reports the count. That is what makes "the filter is installed and working" a thing
you can check rather than assume — a hook that is wired up but never invoked and a hook that is passing
everything look identical from the outside otherwise.

## Refuses rather than escapes

Script composition is pure (`src/monitor/filter.ts`) and a path containing a quote, a backslash, a dollar or
a newline is **refused** with `SCRIPT_UNSAFE` rather than escaped. Shell escaping is where a generator like
this goes wrong quietly; a state home with a quote in its path is a case that should stop and say so.
`unit/monitor/filter.test.ts` runs the emitted script for real, over a JSON payload on stdin, rather than
asserting on its text.
