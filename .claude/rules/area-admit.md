---
paths:
  - "src/admit/**"
---

# Working in `src/admit/`

The door every side-effecting action passes through, the catalogue of the seams allowed to bypass it, and the
one `PreToolUse` process whose checks keep a session on the doored path. Scoped to this tree; the doctrine it
implements is `AGENTS.md` rule 3 (one door), and the authorities are
[the Slack admit door](../../docs/security/slack-admit-door.md),
[the browser write surface](../../docs/security/browser-write-surface.md) and
[registered and bounded hooks](../../docs/hooks/registered-and-bounded.md).

**It states the norm and what new code does, not an inventory.** A file that predates a rule, and each gate's
blind spot, is named in that module's own header, which wins where the two disagree; a deviation you meet is
debt to record, never a licence to copy it.

## Tripwires, not fences — and which of the two you are editing

Almost everything here is a WORKFLOW TRIPWIRE: it catches a session reaching past a verb, and **a block
confirms you were wrong while its absence means nothing**. `classifyRawCommand` (`rawTools.ts`) is
deliberately narrow — read-only `git`/`gh` and everything unrecognised pass, bar the `gh` watch shapes its
header names (a poll is a read it still blocks), and each block names a real way forward. `liveWrite.ts` says the same of its own
detection. Widening one of these into a fence is a design change, not a fix.

A few things here ARE boundaries, and they are the opposite shape: the door's decision, the bot's live-write
rule, the profile hold, the browser door. Know which you are in before you choose a failure direction.

## The door decides, and the ledger records before the effect

`door.ts` runs the ordered gate list, applies any explicit per-action override and returns `pass`, `warn`
or `hold`. It is not pure: a warn whose override is journalled is waived by a live grant, read from the
hatch-grant journal for the session in `process.env`. `warn` is a self-correctable finding re-issued past with
`$SLOPWEAVER_DOOR_OVERRIDE=<token>`; `hold` is the irreversible-harm core and is NOT waivable by that token.
The one rule the door owns rather than delegates: a request with `meta.requiresApproval` and no approval gate
is `hold` (`approval.ts`).

**The audit trail records BEFORE the effect.** `doorLedgerPort.ts` is how a live door decision
reaches the store's `door_event` table (the one-time `store import-fleet --only door` backfill writes it
directly); a store that cannot open is `DOOR_STORE_UNAVAILABLE`, never a file fallback, so an outage refuses the effect rather than performing it unaudited. Only a composition root builds the real port;
a unit test passes a plain port value (`src/__tests__/doorLedgerFixture.ts`), never a mock.

**`doorRefusalLines` (`doorRefusal.ts`) is the ONE renderer of a door refusal**, and it always prints the
override token; a `hold` prints why it has none and the route instead. `escape-hatch` refuses a door finding
rendered as text anywhere else. A warn finding is the [error handling](error-handling.md) refusal shape with a
`To satisfy it instead:` correction line after the head, five lines in all; a `hold` is four.

## A sanctioned seam is one row, with its class and its reason

`sanctionedSeams.ts` is the catalogue of every repo file allowed to call a side-effecting primitive directly,
and `coverage.ts` is the scan that reads it. A seam is `door-internal`, `local-state`, `read-only-tool` or
`dev-tooling`; anything else is `open` and FAILS. A verb marked `external-write` that is not door-routed fails
too; a verb with no `effect` cannot compile, because `CommandMeta` requires one.

- **Adding a seam is an edit to the catalogue; changing how one is found is an edit to `coverage.ts`.** A row
  goes in the category file whose theme its module belongs to — the six are listed in `sanctionedSeams.ts`'s
  header — and a category file nearing the 300-code-line cap splits again, never takes a marker.
- **The scan proves an INVENTORY, not protection.** Every seam it read is sanctioned or routed; whether the
  door's gate lists are sufficient is a product decision it does not assess. A partial scan is not-ok, never
  a smaller denominator.

## One `PreToolUse` process, first refusal wins

`preToolUseChecks.ts` is the registry (the effectful shell handing each runner its real seams) and
`preToolUseDispatch.ts` the pure combining rule. Three rules there are decisions, not detail:

- **Order is load-bearing and the first refusal SHORT-CIRCUITS**, so a later check's side effects fire only
  for a call that will really run. The profile hold runs first, then the bot's live-write rule ahead of
  `admit` so a bot turn meets the owner's rule rather than the generic raw-tool refusal.
- **Each check declares what its own unhandled error means** (`onUnhandledError`): a boundary fails closed,
  a tripwire fails open. One check's exception never decides another's verdict.
- **The folded rows' matchers are copied from their old `hooks.json` entries** (`disk-scan-guard` never was
  one, and the registry's header says so), **and every matcher is evaluated through `hookMatcher.ts`**, Claude
  Code's own rule, never `new RegExp(matcher)`. Re-deriving a "better" matcher is a guard change wearing a
  refactor's clothes. Advisories merge into one stdout document.

A new guard is a pure decision module plus a `<guard>GuardRunner.ts` that injects every reader, so its test
needs no mock, and one row in the registry — never an extra hook process. The one third registration is the
read side of `protected-path-guard`: `Read`/`Grep`/`Glob`/`NotebookEdit` reach ONLY that row, start no Node process
without a registry, and fail open ([protected paths](../../docs/security/protected-paths.md)).

## Raw commands, the browser, and the main checkout

- **Raw Bash is refused like Python** (`rawBash.ts`): one command through read-only filters, or two within the
  character budget; [why](../../docs/doctrine-rationale/no-raw-bash.md). `rawGhWriteRoute.ts` names only the
  `gh` subcommands a `github` verb really covers, because a hint at a verb that cannot do the job misdirects.
  The `production-cli` class takes a journalled, expiring, tool-scoped grant (`reachGrant.ts`), never the
  ambient raw hatch.
- **Every browser host has an answer** (`browserSurface.ts`): a host missing from the write-policy register
  reads and refuses to click. A platform's entry is `browserWrite` on its integration manifest, so switching its
  category is one word there. What a hook needs from the verdicts is `browserVerdictVocabulary.ts`, kept free of
  the register so a tool call loads no manifest; `manifestLaziness.test.ts` holds that.
- **The main-checkout guards protect every DECLARED main checkout** (`declaredMainCheckouts.ts`, from the
  profile), from any session, and may only block on state they resolve unambiguously.

Every override these refusals name is a row in `src/hatch/*Hatches.ts` — `escape-hatch` refuses an `ALLOW`
name with none. The main-checkout guards still word their own refusal text around that row's variable.
