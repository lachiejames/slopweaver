# Reaching a session: submitted, queued, or interrupted

Everything the supervisor's one channel into a running session — typing into its input — actually does, and
the six measured facts that make `slopweaver cmux send` more than a wrapper around `cmux send`.

## The incident

A session (`github-attach-blocked-by-org-saml`) was sent the owner's instruction to re-open the login
browser while it was parked on a long wait. It sat in the session's input queue for about
an hour; the supervisor eventually did the login itself, a job that took thirty seconds once someone ran it.
The owner found it odd that it was stuck for an hour.

Nothing was broken. `cmux send` reported `submitted`, the socket had accepted the call, and the text really
was on the surface. What no one could see was that the session had not TAKEN it.

## Fact 1 — a raw `cmux send` never self-submits

A paste alone is swallowed by bracketed paste on any line long enough to wrap, and a `send-key enter` fired
immediately after is absorbed by the paste still being processed. `slopweaver cmux send` does both halves
with the measured delay between them (`SEND_SUBMIT_DELAY_MS`, `src/cmux/client.ts`). This is why the verb
exists at all, alongside its other reason — a stale `workspace:N` ref silently types into whatever surface is
FOCUSED rather than failing, so the verb resolves every ref to an id first.

## Fact 2 — neither delivery witness can see a queued line

Measured live on a scratch workspace (cmux 0.64.22, Claude Code 2.1.241) parked mid-turn on a
foreground command, then sent a line:

| Witness                       | Fired at | Line actually taken at | Verdict           |
| ----------------------------- | -------- | ---------------------- | ----------------- |
| `latest_submitted_message`    | +0 s     | +140 s                 | blind to queueing |
| `agent.hook.UserPromptSubmit` | +0 s     | +140 s                 | blind to queueing |

Both fire on DELIVERY to the surface, not on pickup by the agent. So `src/cmux/sendEvidence.ts` — and
anything built on the event stream — can confirm a line arrived and can never confirm it was read. A spawn is
unaffected (a freshly booted session is not mid-turn), but a supervisor reaching a working session is exactly
the case they cannot answer.

## Fact 3 — the screen can, within a second

A Claude Code session running a turn renders `esc to interrupt` in its footer. A line queued behind that turn
additionally replaces the input placeholder with `Press up to edit queued messages`, and that marker was
visible on the first poll at **+1 s** and every poll out to +31 s. An idle session renders neither.

`src/cmux/turnBusy.ts` owns those patterns and the one rule that makes them sound: **the busy marker alone is
not evidence of queueing**, because a line that LANDS on an idle session makes it busy too. Only the queued
marker is decisive, and a screen belonging to a host with no measured marker (`codex`) answers `unknown`
rather than `submitted`.

## Fact 4 — one Escape interrupts, and the line then lands

`surface.send_key escape` took a session from `esc to interrupt` to `Interrupted · What should Claude do
instead?` in **under three seconds**, after which the line was answered in about twelve. `--interrupt` does
exactly that, before sending, and only when a turn is visibly running.

```bash
slopweaver cmux send --workspace <ws> "<text>"              # honest: submitted / QUEUED / resubmitted / STRANDED
slopweaver cmux send --workspace <ws> --interrupt "<text>"  # one Escape first, then deliver
```

Through [the session harness](../../../docs/session-harness.md) these are deliveries `turn` and `now`. A
third, `later` (hold the line until the turn ends), is refused on cmux rather than degraded.

**`--interrupt` discards whatever mid-step work the turn was doing.** That is why it is opt-in per send and
not the default: most instructions can wait for the turn to end, and the ones that cannot are a judgement the
caller is making, not one the verb should make for them.

**A queue is FIFO, and one Escape frees one turn.** Measured on the proof run: with a line already queued,
`--interrupt` released THAT line into a fresh turn and the new line queued behind it — reported honestly as
queued, with the advice to send again rather than the useless "pass `--interrupt`".

## Fact 5 — the line can simply never leave the composer, and Facts 2 and 3 are all blind to that

A screenshot showed one workspace holding a peer message from another in its composer, unsent: a message typed
into a peer session's input was sometimes never sent. That was not intentional.

A stranded screen shows no `esc to interrupt` and no queued marker, and it DOES carry the `❯` Fact 3's
classifier recognises — so it answered `submitted`. MEASURED over all 20 live workspaces:
**2 of 20 composers held `kind: "typed"` text**, one a peer message and one a supervisor brief, and the peer
one held TWO concatenated sends, because a second `cmux send` appends to a composer the first stranded.

**The criterion is the composer's faint ATTRIBUTE, never its text.** The live strand read back as
`…and one of them was alread[Pasted text #5 +6 lines]ph is still owed…`: Claude Code collapses a long paste,
so no text comparison can match exactly the long messages that strand most.

`cmux send` reads the composer back after every send and presses ONE bare Enter on a line that never
left it — never a loop, and never on a `suggestion` Claude Code wrote itself. It answers `resubmitted` when
that clears the box and **`STRANDED`** when it does not, printing what is stuck. A `STRANDED` answer means
something is holding the key (a dialog, a menu): **look at the session before sending again**, because a
second send appends rather than replaces.

```bash
slopweaver cmux strands                # every composer in the fleet, with the denominator
slopweaver cmux strands --submit       # press each stranded one through; skips the pinned supervisor
slopweaver cmux submit --workspace <ws> # just this one
```

The sweep is not redundant with the send-side read-back: that acts only on its own send, and cannot clear a
composer already holding a line or one a different path stranded.

## Fact 6 — a long paste can lose its MIDDLE, and nothing on the send path can see it

A 1,418-character relay once reached its seat as the first 96 and the last 400 characters,
the 922 between them gone, and `cmux send` answered `submitted` (after a RESCUE). The seat did not guess; it
released its run, and the chair had to put the owner's word in the handover doc and respawn.

MEASURED over every supervisor send that could be matched to the user turn the TARGET
session recorded (whitespace collapsed): **125 relays, 123 whole, 2 missing a middle chunk** — 1,418 chars
losing 922, and 2,695 losing 1,015. Whole deliveries reached 1,852, so it is intermittent, not a hard cap.
Both lost chunks exceed 800, where Claude Code collapses a paste into `[Pasted text #N]` (Fact 5).

Neither witness can catch it: the composer shows the collapsed placeholder, not the text, and
`latest_submitted_message` stops at 240 characters. So **the limit is 800 characters per paste, its newline included
(`RELAY_INLINE_MAX_CHARS`)**, and over it `cmux send` never pastes. It writes the text to
`$SLOPWEAVER_HOME/cmux-relays/<stamp>-<sha12>.txt`, reads it back byte for byte, and types one line:
_"Relay of N characters, sent as a file … Read ALL of it before acting: <path> (sha256 <12 hex>)"_. A file
that will not write or read back is a REFUSAL with nothing typed, never a fallback to the paste. The
receiving seat reads the whole file before acting. Implementation and measurement: `src/cmux/relayFile.ts`.

## Why raw `cmux` is blocked

Raw `cmux` is refused by the admit guard; the `slopweaver cmux` verbs are the route. The ref-to-id
resolution that stops a stale `workspace:N` addressing somebody else's session lives in those verbs, and a
raw call looks identical to a correct one when it happens to work — which is exactly the failure mode a
tripwire has to catch. `docs/cmux-client/socket-and-measured-facts.md` § 2a carries the measurement behind it.

## Resuming a session that is stuck, or running the wrong `--plugin-dir`

A tracked session can look alive and be going nowhere: logged out after a restore, parked mid-turn, or booted
against the main checkout's plugin dir instead of its own worktree's. **`slopweaver cmux reseat <ws>`** stops its
`claude` and relaunches the SAME session id in the SAME surface with `--resume`, on a routed plan's setup token —
unless that id has no transcript on disk, or its resume prints `No conversation found` and the tab returns to a bare
prompt: then it boots fresh ONCE and reports `fresh-seated`, which means the conversation was NOT recovered and the seat stands with no pickup. A
bare-shell seat whose saved id has no transcript is refused `NO_RESUMABLE_SESSION` rather than booted fresh. The
chair is included. It runs from any cmux terminal tab, a plain shell too, so the seat gate cannot stand in its way;
a terminal outside cmux is refused by cmux's own socket. `--dry-run` prints the line without stopping anything, and
`--all` does every walled seat, the chair first. What it decides, and why each piece:

- **Which session**: the one pid in the workspace's `cmux processes` tree that Claude Code's registry
  (`~/.claude/sessions/<pid>.json`) names. When cmux attributes NO pid to the tab at all, the one start-stamp-validated
  live session whose own `ps` row sits on the tab's one surface `tty` (two running seats read
  `no-process` without it). With none, it refuses and names `session re-seat`. With two, it refuses.
- **Which model**: `--model` if you typed it, else the argv's own, else Fable for the chair, else the ledger row's
  pinned `bootModel`. Otherwise it refuses and never boots the saved default. A restored chair's argv keeps only
  `--settings` and `--resume` (measured), so the fallbacks are the common path.
- **Which credential**: the same gate `cmux spawn` runs (`gateSpawnStore`, then the plan's setup token against the
  seat's own unbound store). A relaunch typed into a shell carries no prefix of its own, and a bare one boots on
  the machine-wide DEFAULT keychain slot, which nothing keeps alive. MEASURED: that item's token had
  expired four days earlier while all four stores were live. Reseat never signs that slot out either.
- **What it refuses**: the caller's own workspace; a session mid-turn behind no wall (unless `--force`, since the
  stop discards the turn); a typed Fable on a worker without `ALLOW_FABLE_OVERRIDE=1`; a tab another live reseat
  holds, `RESEAT_CONTENDED`, having stopped and typed nothing — rerun once that one has finished. Each tab's reseat
  lock spans its plan to its read-back (`fleet resume` holds it through its wall re-check too), the wall read again
  under it, and a dead holder's is taken over at once (`src/cli/commands/cmux/reseatOperation.ts`). A tab picked for
  a wall that is gone under the lock is `WALL_CLEARED`, `--force` or not, having stopped and typed nothing.
- **Order**: route, then capacity (for workers, never the chair), then SIGTERM. Nothing is typed until the old
  process is gone, because a line typed into a live composer is submitted as a prompt. It then waits for a LIVE
  session whose own process runs in THIS tab under a new pid, at a Claude composer, answers the resume-in-full
  prompt with **2**, and prints `claude seat`'s plan line. A resume that printed `No conversation found` waits for
  the bare prompt and types one fresh line, or is refused `RELAUNCH_FAILED` when no bare prompt comes back; any
  other launch left unproven is `UNCONFIRMED`. The send
  goes through the cmux client rather than the `cmux send` verb, so the chair needs no unpin, and `--resume` keeps
  the id the supervisor pin record names.

Residue: a worker relaunches on its role's default launch template, because nothing records the template a seat
booted on. `cmux processes --workspace <ws>` still shows the tree when you want to see what reseat read.

## Reporting TO the chair: resolve before each send, and an unanswered report is unconfirmed

The chair hands over at its 500k warn or its plan-and-version cadence (SKILL.md § 6a), so the chair a reporter correctly resolved can stop
reading inside one report. MEASURED over 17 successive chairs: 19 messages landed
on a chair after its successor took the pin and got no reply, 4 of them real reports, and `SendMessage`
returned success for every one. Two rules for the SENDER, and one mechanism for the chair:

- **Resolve the pin immediately before every report** — `slopweaver cmux list --json`, the one `pinned: true`
  workspace titled `/slopweaver:supervisor`, the session whose name matches its `currentDirectory`. This makes a
  send to a predecessor's name fail loudly; it cannot close the window, which is variable because it is depth-driven.
- **A report with no reply is UNCONFIRMED, never delivered.** Say so wherever the report mattered.
- **The live chair carries what its predecessors never answered.** `slopweaver supervisor intake` walks every
  chair's transcript and lists each message from another session with no `SendMessage` back to its sender from
  any chair: `CARRIED` when it landed after the successor's pin (the verb exits non-zero), `unanswered` when it
  sat inside the chair's own span. Reply, or clear one with `supervisor intake-mark --turn <pointer>`. It is
  derived from the pin record, so it fires on the pin transfer completing, and survives a chair that died
  without handing over. Implementation: `src/supervisor/inbound.ts`.

## Two live peer names one transposition apart

An auto-generated mnemonic pair differing only in swapped characters were live at once, and the supervisor's
own recall of which name mapped to which task got them backwards — even though `SendMessage` routed correctly
to both the whole time (each peer's later self-report matched exactly what had been sent to it). The failure
was never delivery. It was trusting a name recalled from earlier in a long conversation instead of checking
live state.

Before addressing any peer whose bare name could plausibly be confused with another live peer's, cross-check
`slopweaver cmux list --json`'s `current_directory`/`custom_title` against the ledger's recorded worktree for
that slug. When `ListAgents` appends a ` [ref]` suffix, treat it as authoritative — the tool has detected a
collision the bare name alone cannot resolve.
