# The relay courier — the chair's typist for a console cmux refused

**Start `slopweaver talk courier --follow` as a background task at EVERY boot**, through MAIN forced, beside the
keep-alive ([standing-sessions.md](standing-sessions.md#the-keep-alive-dies-with-its-seat)). It dies with the seat
that started it, so a successor that does not start its own has none.

## Why it exists

cmux answers only a process it started, or one holding the capability token a cmux surface exports. A
`docs-site.sh --refresh` run from a plain terminal once restarted the console with neither, and every voice relay landed
on the board while cmux refused the chat write: `Access denied - only processes started inside cmux can connect`
([measured facts](../../../docs/cmux-client/socket-and-measured-facts.md)). Widening cmux's access mode is the owner's call
and is not made here. The courier is a process cmux did start — a background task of this chat — so it can type.

## What it does

- **A spoken relay waits for the owner's quiet.** Its row lands on the board at once, then the relay is HELD: its request
  stays in `talk/courier/pending/` and its delivery reads `held` until a quiet batch carries it (the owner's word:
  one turn per quiet stretch, two minutes after the owner's last word). A relay the owner TYPED on the console is not
  held — no speech follows it — and is typed at once, exactly as before.
- Every 5s while following, the courier asks the chair wake whether the owner has been quiet for `QUIET_BEFORE_DELIVERY_MS`
  since the owner's last word, a stretch's newest snapshot or a relay's hold (`src/talk/chairWake.ts`). If so it types ONE
  `[voice batch]` line naming every unread stretch and held relay, in order, and settles each relay it named; a batch
  line skipped or failed leaves them held for the next pass. A batch still being typed keeps its relays out of a
  concurrent one, so no relay is named twice.
- A typed relay whose console cmux refuses drops a request naming only its turn id in `talk/courier/pending/` and
  waits 3s for a courier to take it (`src/talk/relayCourierHandoff.ts`). The courier takes it by rename, reads the
  turn off disk, and types it only when the row is registered and carries no delivery yet (`src/talk/relayCourier.ts`),
  so [routing § 3a′](routing.md) reads it as a direct relay. It claims the delivery before typing, so a courier stopped
  mid-type never types the line twice: at its next start a request it took and never claimed is requeued, and one it
  had claimed is left on the board, untyped.
- **Before each batch pass it checks whether boots are refused.** An open `mon-claude-register-…` card means every new
  Claude seat refuses; the courier re-reads the register and types ONE `[boots refused <card>]` line per card,
  never waiting on the owner's quiet, claimed under `talk/boot-refusals/` before the keystroke
  ([boots refused](boots-refused.md), `src/talk/bootRefusalWakeShell.ts`).
- It refuses anywhere but the pinned chair's workspace (`CMUX_WORKSPACE_ID`), and the hook refuses it from every
  other session. A second courier is harmless: one rename and one delivery claim win.

## It keeps itself on main's code

A follower runs the code it loaded at boot. The chair's courier was once still a worktree's from before
the quiet batch landed, and typed a wake per stretch and a line per relay through a whole call. So every 60s, after
a batch pass, it measures itself (`src/talk/courierFreshness.ts`): running from any tree but MAIN, or MAIN's HEAD
past its start by a commit touching `src`, `bin`, `package.json` or `yarn.lock`, seen twice running, re-executes it
IN PLACE as `<MAIN>/bin/slopweaver talk courier --follow`, in MAIN with `SLOPWEAVER_CLI_DIR=<MAIN>` — the same pid and pipe,
so this task never ends and you hear only its `talk courier: re-executing in place …` line. The exec marks the
launcher `SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER=1`, so source starts as tsx's child under the wrapper already there,
never a new wrapper per landing (24 idle ones were measured); a courier from before that fix adds one
last wrapper, then none. Never kill a wrapper in the chain: it relays its signal to the live courier. A docs-only landing
restarts nothing; a follower an exec started refuses another for five minutes, read off the
`SLOPWEAVER_COURIER_REEXEC_AT` stamp the exec leaves in its environment, and skips the startup recovery a boot
runs, since the image it replaced had nothing in flight. The stamp counts only beside
`SLOPWEAVER_COURIER_REEXEC_PID` naming its own pid, which an exec keeps, so a process that merely inherits it boots. Nothing is dropped: the relays and
the wake store are on disk, and a batch due mid-restart is typed by the next pass.

A launcher that fails its executable check (a regular file, executable, opening on `#!`), or a MAIN whose launcher would pick a built CLI its own staleness guard
refuses, is said once on stderr and the courier follows on until a later check finds it fixed. One removed between
that check and the exec ends the task (Node 24 aborts a failed exec, `src/cli/commands/talk/courierReexec.ts`), and
so does a MAIN no boot could start, so start it again as at boot once MAIN runs. The new image is admitted afresh: a cmux lookup that fails there, or finds no chair
pinned, is asked again every 5s until cmux names the chair, as the follower it replaced would have waited; another
workspace pinned ends it at once.

## What the owner sees when there is no courier

A typed relay no courier takes within 3s is recorded `failed (courier-unavailable)`. A held spoken relay waits on
the board for the next batch; `supervisor intake` counts one still held 12 minutes after its hold
(`HELD_OVERDUE_AFTER_MS`, `src/talk/relayIntake.ts`) as never reaching the chair. The voice says nothing of either
unless the owner asks whether the steer landed, so the board row and your next pass are what
carry it. `slopweaver talk log` shows each relay's delivery, its refusal class and whether the courier carried it. A
sweep can drain a leftover, and type a due batch, by hand:

```bash
slopweaver talk courier --once
```
