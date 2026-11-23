# The plan register — where it lives, rules, diagnostics

The procedure is in [SKILL.md](../SKILL.md), the house bars its top-level `thresholds` key holds in [thresholds](thresholds.md). This is what the register holds and what each rule refuses.

## One row in the store, two projections on disk

| Where                                            | What it is                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| store table `plan_register`, row `id = 'plans'`  | **The source.** The whole `{ version: 1, rows: [...], thresholds }` document as `jsonb`, plus a revision. |
| `$SLOPWEAVER_HOME/plans.json`                    | **Generated projection** of that document, `0600`, for checkouts that predate the store.                  |
| `$SLOPWEAVER_HOME/claude-accounts/accounts.json` | **Generated projection** of the Claude rows. Do not hand-edit.                                            |

`src/store/schema/planRegister.ts` declares the table: a singleton enforced by a CHECK, the revision a
compare-and-set reads. `src/plans/storePort.ts` is the orchestration and `src/plans/storeRows.ts` its
Postgres half. Both files are regenerated from the COMMITTED row after every change. Neither is ever read for
authority once a row exists, and old writers must not edit them: a file edit cannot be merged back into a
newer row, so it shows up as `PROJECTION_DIVERGED`. "Retire plan-register file projections" is the change
that stops writing them, once every reader runs through the store.

**The one-time import.** A read that finds no row consults `plans.json`, and only then:

- A valid one is inserted at revision 1 with `ON CONFLICT DO NOTHING` and read back, so a concurrent
  importer's row wins.
- An absent one inserts nothing; the derived, unadopted picture comes back with `revision: null`.
- A present but unreadable or invalid one is refused rather than derived around.

The Claude projection stays a BARE ARRAY with the `provider` discriminator removed, because that is the shape an
older checkout's `parseClaudeAccounts` already parses — wrapping it in a metadata object or adding a
generated-by comment would break the compatibility it exists to buy. JSON cannot carry a do-not-edit banner,
which is why that declaration lives here and in `src/plans/projection.ts` instead.

## One row

```json
{
  "provider": "claude",
  "alias": "plan-one",
  "storeDir": "/Users/you/.slopweaver/claude-accounts/plan-one",
  "email": "owner@example.com",
  "pinned": true,
  "paused": { "reason": "the subscription lapsed", "sinceIso": "2001-01-01T11:00:00.000Z" },
  "allowance": { "kind": "weekly-window" },
  "usageLimitPercent": 50
}
```

- `provider` — `claude` or `codex`, a closed union.
- `alias` — lowercase, hyphen-separated, ≤32 characters, unique **within its provider**. A neutral local
  label, never derived from an email: an alias names a store directory, and a store outlives whichever
  account is signed into it.
- `storeDir` — `CLAUDE_SECURESTORAGE_CONFIG_DIR` for Claude, `CODEX_HOME` for Codex. Preserved EXACTLY;
  compared NFC-normalised for duplicates, because Claude hashes the string to find its keychain service.
- `email` — a display CACHE, never a selector and never an identity. Rendered `CACHED <address>`.
- `pinned` — which row a pinned CLAUDE seat boots against; at most one Claude row, and a paused Claude pin is refused.
  Codex has no pinned seat: `plans pin` and `plans add --pinned` refuse a Codex row, and a Codex pin on disk decides nothing.
- `paused` — absent is the normal case.
- `allowance` — `weekly-window` (every Claude and ChatGPT subscription read so far; absent decodes to it)
  or `monthly-spend` (an Enterprise seat billed at API rates against a monthly dollar limit).
- `usageLimitPercent` — the share of that allowance the fleet may take, 10 to 100 in steps of ten; absent decodes
  to 100, never written back. Routing excludes a weekly window AT `min(house bar, limit)` (`usage-limit`, even when
  the provider also rejected it), the five-hour keeps the house bar, and a row below 100 with no readable week is
  held at its limit. A Claude `monthly-spend` row is the fallback lane, routed on its hour-fresh spend ([its
  reader](monthly-spend.md)); a Codex one is NOT MEASURED; neither is probed by `claude gauge` or `claude watch`. No
  `--force` or hatch crosses either; a `--plan` spawn whose register cannot be reread is refused outright. Written
  only by `plans set-usage-limit`, whose `--from <percent>` (the Fleet page's raise) refuses unless the row still holds it.
  The [survival trend](../../supervisor/reference/plan-survival.md) holds each plan to it too, and never counts the share above it **stranded**.
- `lapsesAtIso` — when the paid subscription ends, strict ISO-8601 as typed (`plans lapse`; a renewal replaces it).
  It pauses, skips and reroutes nothing, even past; a Claude row's rides `accounts.json` into every `PLAN` line.

**A field this version does not declare survives every change.** The raw rows are carried beside the typed
ones precisely so an older or newer writer's key is not silently dropped by a pause performed here.

## What the parser refuses, and what it deliberately does not

`parsePlanRegister` (`src/plans/register.ts`) enforces STRUCTURE only:

- a duplicate alias or store directory **within one provider**;
- more than one pinned Claude row, or one also paused; a Codex pin decides nothing, so neither checks it;
- a malformed `removed` list: each alias `plans remove` took off, with the one store it may return at ([why](removing-a-plan.md)).

It enforces **no count**. The write path runs `parseClaudeAccounts` over the projection it is about to publish,
so a Codex-only install, an EMPTY register and a single Claude plan are all valid: one plan runs the whole
fleet, supervisor hand-offs included. Pausing every Claude plan is valid too, and every unpinned spawn then
refuses as `paused`, naming `claude resume`, as does a pinned spawn whose own plan is paused. A Codex-only
install: [codex routing](codex-routing.md#either-provider-alone).

## Diagnostics

| Code                         | What it means                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `DERIVED_REGISTER`           | Nothing adopted; this picture was computed. Normal — `validate` exits 0 on it alone. |
| `PROJECTION_DIVERGED`        | A generated file no longer matches the row. `--repair-projection` regenerates both.  |
| `UNKEYED_QUOTA_UNATTRIBUTED` | `codex-quota.json` holds a cap credited to no destination. Inert — deletable.        |
| `UNKNOWN_CAPACITY`           | Nothing measured for a destination yet.                                              |
| `AMBIENT_PASS_UNREGISTERED`  | A pass was recorded against the ambient home rather than a registered destination.   |

## Failures

`PlanRegisterError` (`src/plans/errors.ts`) is the register's own union:

- `REGISTER_UNREADABLE`, `REGISTER_INVALID`, `UNKNOWN_DESTINATION` and `MUTATION_CONFLICT`;
- `REGISTER_STORE_UNAVAILABLE`: no store selected, a stale or unreachable one, or a failed query. It is a
  refusal and NEVER a fall back to `plans.json`, because a store outage seated on an ambient credential is
  the failure routing exists to prevent;
- `REGISTER_REVISION_CONFLICT`: a compare-and-set that lost;
- `PROJECTION_WRITE_FAILED`, which carries `registerCommitted: true`, the `committedRevision`, and every
  path that failed. The row DID land, so rerun `--repair-projection`; never re-apply the change;
- `SEAT_PASSES_NOT_CLEARED`: `live/seat-pass` could not be cleared BEFORE the commit, so nothing committed — a stale
  pass would keep a limited seat on the bash fast path. Fix that directory's permissions and apply it again.

**Only `ENOENT` reads as absent**, in the legacy files the import reads too. A present but unreadable file
(`EACCES`, `EISDIR`) leaves this install's destinations UNKNOWN, and seating anyway seats the ambient credential.

**The three READ failures (`PlanRegisterReadError`) refuse every Claude spawn**, pin and hatch included: the owner's
usage limits went unread with the register. `claude-plan-unusable` floats ONE card keyed by the fault (path, sorted
problems, or code) and leaves every plan's own card standing until a pass reads the register again.

## Concurrency

A write reads revision N, makes its one pure judgement (`prepareRegisterChange`, `src/plans/mutate.ts`), and
updates `WHERE revision = N`. If no row comes back, the write is `REGISTER_REVISION_CONFLICT`, and nothing
replays it: replaying a change against a register that moved is a new judgement, and that judgement belongs
to the caller. `--repair-projection` rewrites the files from the row as it stands without bumping its
revision, because repairing copies is not a change to the register.

## What reads the register, per provider

One register, read through ONE door — `planRegisterPort()` (`src/plans/port.ts`), supplied at each composition
root and injected below it, so a unit test passes `src/__tests__/planRegisterFixture.ts`'s in-memory port and
never a real store — and two provider-shaped readers:

- **Claude** — `src/claude/spawnAccounts.ts` narrows it to the bare array `parseClaudeAccounts` has always
  read, so `cmux spawn`'s seat pinning, `--plan` on a Claude `cmux spawn` or `cmux reseat`, and `claude watch`
  ask the source rather than the generated copy. A paused row cannot be named by `--plan`: it refuses, printing
  the `plans resume` that brings it back.
- **Codex** — `src/codex/destinations.ts` pairs each Codex row's alias with its own `CODEX_HOME`. Both terms travel
  together because a cap is established from two places addressed differently: the cached record by ALIAS, the
  rollout log by that destination's own home. `codexDestinations()` and `codexDestinationFor()` answer a `Result`, so
  a store outage stays an error and never reads as `[]` or an unknown alias. `src/codex/fleetRead.ts` reads every
  Codex row at once for routing, deliberately NOT through `codexDestinations()`, which drops pause and pin.

**Three things spend a Codex destination, and all three ask the same ranking.** A cmux seat
(`src/cmux/seatRoute.ts`), an SDK pass (`src/cli/commands/codex/passDeps.ts`'s `routedCodexPass`, asked once per
ADMITTED pass, each review property when its slot opens, reserving a limited account's point on top of the ranking — [routing](codex-routing.md) — and building its client via `productionCodexClientFor`), and every reader of "is Codex
capped" (`src/codex/fleetCap.ts` — `codex status --check`, both landing gates, both fallback verbs). The
pass hands the SDK `codexClientEnvironment`: this process's whole environment plus the routed `CODEX_HOME`,
because the SDK's `env` option REPLACES `process.env` rather than extending it, and the bundled CLI reads
that home's own OAuth login.

**With `OPENAI_API_KEY`, `CODEX_API_KEY` and `CODEX_ACCESS_TOKEN` REMOVED**, because the CLI reads those
three in preference to the routed home's `auth.json`. Inheriting one exported into the shell would spend an
API-key account while every ledger row, cap record and refusal named the registered destination — a routing
decision silently undone by an environment variable. `src/codex/client.ts` carries the measurement.

**A cap is a fact about the FLEET, never about the ambient account.** One destination exhausted beside an
open one is a routing decision, so the open one takes the pass; only a register where nothing can take it is
a cap, and a fully PAUSED fleet is unavailable without being one.

**An alias no row carries resolves to `undefined`, never to the ambient destination.** Substituting one
would read one account's rollout log under another account's name and report the wrong account capped. So
`codex quota` with no `--plan` takes the row whose store IS the ambient home, and refuses when no row's is.

**A cap is per-destination.** `$SLOPWEAVER_HOME/codex-quota/<alias>.json`, one per destination, keyed by alias
so a path holding a separator cannot name a stray file. `slopweaver codex quota clear --plan <alias>` writes
`codex-quota/cleared/<alias>.clear-mark.json` and deletes nothing: what it covers stops refusing, a later cap never does.
`show` prints it, its `clearedAtIso`, and `caches`: every alias holding an uncovered record, de-registered too.

## Which destination new Codex work takes

One pool, drawn down alike, paused for new work at the register's Codex `pauseAtPercent` (99 by default), or at a
row's lower weekly usage limit: the order, the pause bar, exclusions and what the fleet read prints are in [Codex routing](codex-routing.md).

## Why Codex can never render `bound`

`src/plans/render.ts` reuses `src/claude/accountBinding.ts`'s trust vocabulary rather than minting a second
one. `CodexAccountCell` is `Extract<ClaudeAccountCell, { trust: "cached" } | { trust: "unmapped" }>`, so the
TYPE — not a reviewer — is what stops a Codex row claiming a bound address. An enrollment binds an address to
a live Claude token through the organisation header the gauge probe already reads; Codex has no such join
here, and manufacturing one would mean comparing emails, hashing tokens or decoding a JWT, none of which this
repository does.

## Where the tests are

- `src/__tests__/unit/plans/register.test.ts` — decode, derive, structural refusals.
- `src/__tests__/unit/plans/mutate.test.ts` — one change applied to one snapshot.
- `src/__tests__/unit/plans/projection.test.ts` — what the projection holds, and divergence.
- `src/__tests__/unit/plans/store.test.ts` — the file edge: import, projections, divergence, a failed projection.
  `storePort.test.ts` — row over file, the import race, CAS misses, refused queries, the connection closed.
- `src/__tests__/unit/plans/port.test.ts` — the production port refusing with no store selected.
- `src/__tests__/integration/planRegisterStore.test.ts` — opt-in, a throwaway database: CHECKs, `jsonb`, CAS race.
- `src/__tests__/unit/cli/commands/plans/run.test.ts` — every verb's mutation, exit code and output.
- `src/__tests__/unit/codex/destinations.test.ts` — the Codex reader, including the refused substitution.
- `src/__tests__/unit/codex/quotaCache.test.ts` — the per-destination cache, its listing, a malformed alias.
- `src/__tests__/unit/codex/rank.test.ts` — exact orders: 5%-before-60% beating the reset tie-break, a swapped
  slot, an unmeasured home, an out-of-scale or future reading, an offset reset, refusing-excluded, a Codex pin
  drawn down alike, and the 99% bar (98.99 routes, 99 pauses, either window trips it, undatable never does).
- `src/__tests__/unit/codex/routeRun/` — two REAL homes, one's log beside another's row; `routeRunCleared.test.ts` the clear mark.
- `src/__tests__/unit/codex/accountLiveParse.test.ts` and `subprocess/codex/accountLive.test.ts` — the live
  answer parsed, and the read over a fake app-server: parallel stores, a silent or flooding one cut off.
- `src/__tests__/unit/plans/rankKeys.test.ts` — the shared lexicographic mechanic both providers rank on.
