# The dev gate + the state home

Two foundations every later slice builds on: one typed contract for everything the agent persists, and
one gate every PR must pass.

## The state home (`$SLOPWEAVER_HOME`)

Everything on disk lives under `$SLOPWEAVER_HOME` (default `~/.slopweaver`) and every path comes from ONE
place — [`src/stateHome.ts`](../src/stateHome.ts), the entry that composes one module per area from
`src/stateHome/`. No other module derives a home sub-path; a guard test
(`src/__tests__/unit/stateHome.guard.test.ts`) fails the build if one tries, in `src/`, `site/` or `desktop/`
— the console and the shell, which cannot import `src/`, each keep one owner of their own reading — and fails it
if a module under `src/stateHome/` is imported from anywhere but the entry.

What is rebuildable and machine-level is not in the home at all: the native-binary exec store, the Codex plugin
export, the console's run records and saved readings, and the last desktop update notice sit under the cache
root, [`src/cacheHome.ts`](../src/cacheHome.ts) (`SLOPWEAVER_CACHE_HOME`, else the OS cache directory;
`slopweaver doctor` prints it). The same guard refuses a path to one of those built anywhere else.

```
$SLOPWEAVER_HOME/
├── .home-version.json        # layout-version marker
├── corpus/                   # the medallion store: bronze → silver → gold + caches + .watermark.json
├── knowledge/lessons.jsonl   # append-only lesson history; `knowledge import-lessons` loads it into memories
├── ledgers/                  # append-only run logs (dev-gate log + diff live here)
├── profile.json              # the persona/profile seed (seeded from a template)
├── hygiene-denylist.txt      # your private, uncommitted leak denylist
└── .cache/                   # rebuildable scratch
```

- **`slopweaver init`** scaffolds this idempotently — it creates missing dirs and seeds the marker/seed
  files, and NEVER overwrites a file you've edited. It runs automatically on SessionStart and is safe to
  re-run. It is additive: it never touches any other state home you may keep for an unrelated tool.
- **`slopweaver doctor`** reports the home read-only: layout version, which parts exist/are empty, and
  whether `profile.json` parses and whether a retired `identity.json` is still present — never their
  contents; `--deep` also peeks the identity roster's store row (revision and record count).

## The gate (`slopweaver dev gate`)

One command, one non-zero exit, four composed checks (all run — one pass tells you everything that's wrong):

1. **hygiene** — the public leak-class scan + your private denylist and private terms (`src/hygiene/`). In CI the
   terms are absent and not applied, and that denylist is ABSENT in `lint` and EMPTY in `dev-gate`; the gate says
   which on every run — see
   [security/hygiene-gate.md](./security/hygiene-gate.md#where-the-private-denylist-actually-applies) § "Where the private denylist actually applies".
2. **PR-format** — the PR-description schema (`src/prformat/`). A missing body is a failure, not a skip.
3. **evidence-handoff** — the evidence-handoff contract (`src/devGate/handoffCheck.ts`): frozen records
   packed by the real shard planner, a frozen set of reader findings, and the exact kept/refused/unanswered
   counts the collector owes. It is grounding accounting, NOT a retrieval-quality measurement: there is no
   ranker to score ([hard constraint 1a](./constraints/hard.md#1a-retrieval-is-postgres-full-text-over-the-store-nothing-else)), so no baseline to move and no rebaseline command.
4. **answer-quality** — the substance scorer's own ordering properties
   ([answer-quality-scorer.md](./answer-quality-scorer.md)), over the committed synthetic fixture always and
   over the private ten-golden rubrics when the machine holds them. Beside the check above, never instead of
   it: `evidence-handoff` grades which records reached an answer, this grades what the answer SAID, at the
   owner's request. **In CI the private lane is always absent** — a fresh `$RUNNER_TEMP` home has no rubrics — so
   the summary names both lanes and says which one did not run, in the same sentence as the pass.

It writes a JSONL run log (`ledgers/dev-gate.jsonl`) under the home. CI runs the **same** `yarn dev:gate`
path on every PR.

```bash
yarn dev:gate                       # PR body from $PR_BODY (or --pr-body-file <path>)
```

**Running it before you have a PR body is a normal way to get hygiene + evidence-handoff + answer-quality
signal early** — there is no standalone command for the first two, so `dev gate` is genuinely the only way to
see them mid-change, before a description exists to review. The gate composes all four checks with no
short-circuit, so those three lines print and mean exactly what they say even though the run as a whole exits
non-zero:
`pr-format: no PR body provided …` is the expected shape of that failure, not a signal that anything else is
wrong — read the three lines above it, not the exit code, and re-run with `--pr-body-file <path>` (or
`$PR_BODY`) only once you actually have a body to check against.

> Scope note: `dev gate` is the leak/format/regression bar. `yarn typecheck` + `yarn test:unit` stay the
> standard build steps, run in CI alongside the gate — the gate does not re-run them. A seat reads CI's
> `typecheck` with `slopweaver github checks --wait`: `whole-tree-check-guard` refuses it locally.

## The other gate: `slopweaver dev lint`

`dev gate` is the leak/format/regression bar. **`dev lint` is the static-analysis bar**, and it is a
different, larger family — the five external tools (Prettier, oxlint, knip, yarn constraints, hygiene) plus
the bespoke ratchets in `src/devLint/`, run all together with no short-circuit so one pass tells you
everything that is wrong.

**There is no prose list of the ratchets here, and there should not be one.** The registry in
`src/devLint/gateGroups.ts` names every check in run order and carries, beside each, the defect this repo
actually shipped before that gate existed. That comment block IS the documentation; a second copy would rot
against it. To see the live set:

```bash
yarn lint                                   # run them all: CI's lane; a seat is refused and watches github checks --wait
slopweaver dev lint --only <gate>[,<gate>…] # re-check named gates only, refusing a name that is not one
```

Three adjacent ratchets run in the **unit suite** rather than in `dev lint`, because each needs the real
manifest loaded rather than a text scan. `src/canon/staleReferences.ts` catches a doc naming a verb, flag or
path that does not exist; `src/canon/diagramReferences.ts` applies the same resolution to the labels inside
`docs/diagrams/*.mmd`, where a stale name is a lie drawn in a box; and `src/canon/docCoverage.ts` catches the
mirror defect — code no document has ever named. See
[coverage/undocumented.md](./coverage/undocumented.md).

`src/devGate/devGate.ts` is the composer for `dev gate` itself: pure check evaluators and log-line builder,
with one thin effectful edge that reads the body, runs the hygiene scan, loads the fixture and baseline,
and writes the ledger.
