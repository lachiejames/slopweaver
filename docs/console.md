# The console, the board, and the session ledger

Surfaces over the same question — _what is in flight, and what needs the owner?_ — and one rule that
makes them trustworthy: **state is derived in exactly one place, and nothing caches it.** A hand-maintained
board that disagreed with the repository caused duplicate work twice in one day; a cached one would hide
the drift the board exists to surface.

## The console

The console is a Next.js app under `site/` — Queue, Fleet, Workstreams, Pull requests, Talk,
Alignment and the rest (`site/content/console/*.mdx`) — served at `http://localhost:3000` by
`scripts/docs-site.sh`, listening on 127.0.0.1 only so nothing off this machine can reach it, and opened in a native window by the desktop app (`desktop/`, `slopweaver desktop
install`). Most of what it does goes through `slopweaver` verbs: reads on the allowlist in `site/lib/liveVerbs.ts`, a
fresh reading a page takes for itself in `site/lib/syncVerbs.ts`, and writes in `site/lib/actVerbs.ts`. Some
routes read or write a file directly instead of spawning the CLI — the voice call's lease, written on each
beat while a call is live (`site/app/api/console/call/route.ts`), and a queued draft's media
(`site/lib/draftMediaServe.ts`) among them. The owner reads the Queue page and what
arrives; the rest is the fleet's. Its pages are listed at the foot of this file.

## The terminal surfaces

```bash
slopweaver fleet status                       # the board in a terminal (add --json for a machine)
slopweaver pane pr-status --json              # just the open pull requests, ranked, with why each is blocked
```

`fleet status` calls `src/measurement/board.ts`, the one call site every surface goes through, which calls
`src/measurement/workstream.ts` once per workstream. **A surface may choose what to SHOW; none of them may
choose what is TRUE.**

Every field is measured at call time from git, the PR checks and the run journal, and every failure becomes
a printable reason — a `gh` that is not authenticated prints `NOT MEASURED — …` rather than vanishing from
the row. There is no cache and no background refresh.

## The session ledger

```bash
slopweaver session list        # every chat the supervisor is tracking, and its current state
slopweaver session record      # note a session's status, registering it if this is the first note
slopweaver session watch       # fold cmux's hook events into needs-input / idle / silent / working, plus a logged-out or limit-retrying screen
slopweaver session standing    # Slack loop and credential keep-alive live, and the commit each standing session runs
slopweaver session close       # by hand; `cmux close` does it automatically for a spawned session
slopweaver session close-done  # the sweep: close every finished/settled/terminal workspace and every ended bot-turn child whose screen is idle, every finished fleet resume tab, and every drifted row
```

A session here is keyed by a string the caller already knows for certain — the handover slug for one
`cmux spawn` opened, or a free-form key the supervisor chooses for a chat it did not spawn. It is **never**
keyed by a Claude Code session id, which is assigned by the harness after the tab boots and cannot be known
at spawn time, and **never** by a pid: measured, `fleet status` printed thirteen rows all reading
`exited` while four of those sessions were demonstrably running, because a run journal's `pid` belongs to
the short-lived `slopweaver` command, not to the session.

## Where it lives

- **`src/measurement/`** — the one derivation. `workstream.ts` composes a doc, its journal, its git drive
  and the world; `board.ts` is the single call site every surface goes through; `measure.ts` turns each
  read-only shell command and each of its failures into a `Measured` value; `sessions.ts` answers liveness
  by session identity rather than by pid.
- **`site/`, `desktop/`** — the console and its native shell, above.
- **`src/pane/`** — `pane pr-status`'s ranked pull requests (`src/pane/sections/prStatus*.ts`).
- **`src/sessions/`** — the supervisor's own append-only ledger and the fold that turns it into each
  session's current state, and the Claude session store (`liveSessionStore.ts`, `liveSessions.ts`) and
  per-turn token cost (`sessionCost.ts`) every session read shares.

## What it does NOT do

- **`pane pr-status` is `external-read`, not a writer.** It shells `gh` per watched repository and reads
  the Slack ask record; it mutates nothing in the world and nothing under `$SLOPWEAVER_HOME`.
- **The board is not the register of what is in flight.** That is `slopweaver handover list` — see
  [workstreams.md](./workstreams.md).

- [The work console at localhost:3000](./console/work-console.md)
  - [The styling system: Tailwind v4, shadcn/ui and the `ai` SDK's UI layer](./console/styling-reads-and-acts.md)
    - [The second read by id: one session's latest turn, `app/api/session-turn`](./console/styling-reads-and-acts.md#the-second-read-by-id-one-sessions-latest-turn-appapisession-turn)
    - [The one door that writes: `site/lib/actVerbs.ts` and `app/api/act/[verb]`](./console/styling-reads-and-acts.md#the-one-door-that-writes-sitelibactverbsts-and-appapiactverb)
  - [`content/console/pull-requests.mdx` — the trust class, and the readings ledger under it](./console/pull-requests.md)
    - [The shared kit its readers stand on](./console/pull-requests.md#the-shared-kit-its-readers-stand-on)
  - [`content/console/fleet.mdx` — what the fleet did, is doing, and will land next](./console/fleet-and-workstreams.md)
    - [`content/console/workstreams.mdx` — how far each of the owner's outcomes is from the loop closed](./console/fleet-and-workstreams.md#contentconsoleworkstreamsmdx--how-far-each-of-the-owners-outcomes-is-from-the-loop-closed)
  - [`content/console/queue.mdx` — what needs the owner's hands, the owner's priorities and what unblocks the fleet](./console/queue-and-triage.md)
  - [`content/console/alignment.mdx` — was this, or would this be, the right call: voice, general rulings, the acts](./console/alignment.md)
    - [the tag filter — `?tag=` over board-row tags](./console/queue-tag-filter.md)
    - [an opened card's properties — status, priority, effort, workstream, related](./console/queue-card-properties.md)
    - [how many looks a card took the owner — laps, whose each was, and the owner's steers between](./console/queue-card-laps.md)
    - [a Slack draft drawn as Slack draws it — faces, inline pictures, what record refuses](./console/slack-draft-fidelity.md)
    - [a Codex draft beside the Claude draft — the A-or-B the owner picks on every new draft card](./console/draft-comparison.md)
    - [Citations: one chip for every reference on every page](./console/citations.md)
  - [The voice's context pack — what a lookup reads before it calls anything](./console/voice-context-and-calls.md)
    - [Continuity across calls — a fresh call knows what the owner last steered](./console/voice-context-and-calls.md#continuity-across-calls--a-fresh-call-knows-what-the-owner-last-steered)
    - [The call is written down as it runs — a dropped call is still read](./console/voice-context-and-calls.md#the-call-is-written-down-as-it-runs--a-dropped-call-is-still-read)
    - [Every word the owner speaks reaches the chair](./console/voice-context-and-calls.md#every-word-the-owner-speaks-reaches-the-chair)
    - [How the chair reads a call file — the cursor, the batch and the residue](./console/how-the-chair-reads-a-call-file.md)
    - [The walk's silences — a lookup, a relay or the owner's pause never leaves the owner waiting](./console/walk-silences.md)
      - [The page's resume — the calls that shaped what holds it and the turn it opens](./console/resume-cases.md)
    - [A turn answers the owner once per thing they said](./console/answered-once.md)
    - [The voice says what became of a send, never that it is done](./console/voice-says-what-became-of-a-send.md)
    - [What the owner says with a card open lands on that card](./console/card-landing.md)
    - [The voice puts the card it is talking about in front of the owner before it speaks](./console/voice-opens-the-card.md)
    - [A triage pass: one Queue card at a time, on a clock the owner sets, every card seen](./console/voice-triage-pass.md)
    - [One spoken line when the owner drifts from the plan the owner said, read from window names](./console/voice-notices-drift.md)
    - [One spoken nudge naming an ISO card when the owner strays off ISO in work hours](./console/voice-nudges-iso.md)
    - [No join heads-up for a meeting the owner said they have had or will not go to](./console/voice-notices-meetings.md)
    - [The voice sees the owner's screen when the owner says "look at this"](./console/voice-sees-the-owners-screen.md)
    - [The presence moves to what we discuss — a design note, not built](./console/presence-moves-to-what-we-discuss.md)
