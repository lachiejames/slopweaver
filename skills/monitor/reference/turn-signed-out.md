# `turn-signed-out`: an answer waiting on the owner's sign-in, before it is posted

The owner's ask, after an answer leaned on admin.google.com, which signs out after about an hour: a future
improvement is ensuring that anything useful is reachable before the fleet answers, which might mean a floating
note or a high-priority queue card asking for a sign-in to https://admin.google.com/ right now.

## What fires it

A Slack turn standing `blocked-on-human` with `need: sign-in` and a `signInOrigin` — written by `turn block
--need sign-in --sign-in-url <page>`, or by `turn reach` finding a page signed out
([blocked-on-human](../../loop-bot/reference/blocked-on-human.md)). A sign-in block with no page (a CLI login) is
not its subject.

## What the owner sees

- **One card per origin**, however many turns wait on it: `Log into <host> now in the work Chrome window just
opened — a Slack answer is waiting on it`. It is a `work` card, the tier the Queue draws first.
- **The floating note** is raised with it, through the chair's lane, never by the session holding the turn.
- **The page opens in the owner's work Chrome** through the pin, only when the pin exists; without one the card says
  to log in in the owner's work Chrome instead of claiming a window opened.

## When it fires and settles

- Fired at the block itself (`turn block` and `turn reach` run `--only turn-signed-out --fire`), and on every
  `supervisor tick open` (reading `turn-sign-ins`).
- Settled when the last turn on that origin leaves the waiting state — `turn unblock` fires the pass again.
- The owner's Done HOLDS the card until a NEWER turn blocks on that origin: the session holding the turn unblocks it,
  so the card does not come back for the block the owner already answered.
- Datadog and GitHub sign-ins are the fleet's (the owner's ruling): held, not carded, until a fresh
  `browser sign-in` look found the step genuinely the owner's — the same gate `resync-signed-out` reads.

## What it cannot see

An ask-lifecycle line that does not decode and could have been a block or its lift (an older-schema
`dispatched` row cannot, and is not counted), an unreadable `live/slack/asks.jsonl` or an unreadable hand register
is a blind spot on the reading, never a clear. Declared in `src/monitor/turnSignedOutDefinition.ts`; the pure
evaluator is `src/monitor/turnSignedOut.ts`, the reader `src/monitor/turnSignedOutSource.ts`.
