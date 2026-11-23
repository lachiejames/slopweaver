---
paths:
  - "src/cli/**"
---

# Working in `src/cli/`

The verb surface. Scoped to this tree; the doctrine it implements is `AGENTS.md` rules 3 and 4 — one door,
and a command surface that is skills.

## One declaration, and the reason it is one

`CommandMeta` is owned by the MANIFESTS (`cli/manifests/<noun>.ts`) and by nothing else. `NOUN_GROUPS` folds
straight from the manifest barrel, so the manifest copy is what `--help`, `catalog`, `discoverCommands` and
the door-coverage gate all read. The barrel's rows live in five family files beside it (`setupManifests.ts`,
`corpusManifests.ts`, `fleetManifests.ts`, `doorManifests.ts`, `atlasManifests.ts`) spread into one array: a new
noun appends ONE row to its family, never a second row for a noun already there.

`defineCommand` used to take the same fields a second time and nothing compared the copies. Swept once
across every verb entry the manifest then held, twenty fields disagreed, and the two most recent pull
requests had each added a fresh disagreement. Every one was dead metadata that looked authoritative. The
second declaration is GONE rather than corrected: a copy that cannot exist cannot drift. Do not reintroduce
one. Enumerate the surface with `slopweaver catalog`.

## `cli/` depends on product code, never the reverse

No file outside `src/cli/` statically imports `src/cli/commands/` — 17 such imports once made verb modules a
library (the bot's answer path loaded the Slack verb's chat wiring). A helper a verb defined first and a product
module now wants moves DOWN to the tree owning its concept, and the verb imports it from there. Gated by
`cli-command-boundary` (`src/devLint/cliCommandBoundary.ts`); a dynamic `import()` thunk is its named blind spot.
It does not make the tree graph acyclic: product code still imports `cli/`'s registry and parsers, and the
gate's header carries that measurement.

## Metadata is eager, the run function is lazy

A `VerbManifestEntry` separates a verb's metadata from its run function: the `import()` inside a `lazy`
loader fires only when that exact verb is dispatched, so a verb's heavy transitive dependencies stay off
every unrelated invocation's load path. Keep `manifest.ts`, `defineCommand.ts` and `router.ts` pure: no I/O,
no console, no global state.

**The barrel is metadata-only, and a test keeps it so.** A usage string a manifest quotes lives in a
`*Usage.ts` leaf beside its command, which the command imports back; a leaf imports only other leaves.
`manifestBarrelClosure.test.ts` walks the static closure of `nounGroups.ts` and fails on any command module,
any npm package or builtin, or a shared leaf not in its pinned list. Its header carries the
measurement. Copy `commands/listen/listenUsage.ts`.

## A seat's verdict is its OWN TREE's verdict

`slopweaver` resolves to the worktree you are standing in, so every verb a long-lived seat runs is that
seat's code — read against a `$SLOPWEAVER_HOME` every other seat also writes. Old code over current state is
what makes a stale seat lie in one direction: MEASURED, one seat sat 258 commits behind, and
its `autonomy list` refused all 522 rows while `automation due` printed 47 REJECTED, both fixed upstream days
earlier. It cost three board rows, a p0 relay to the pinned chair and two repair acts on live state that
needed no repair.

`main.ts` therefore calls `maybeWarnStaleSeat` BEFORE it loads the verb's module. `staleSeat.ts` carries the
criterion, the discrimination table and why a commit-distance threshold was weighed and dropped; the
BLOCKING half sits at `commands/handover/staleEvidenceGate.ts`, which refuses a `--finding` row whose own
evidence paths the trunk already rewrote (hatch `SLOPWEAVER_ALLOW_STALE_SEAT_FINDING`,
[finding-page](../../skills/handover/reference/finding-page.md)). Its paths come from
`src/handover/evidenceRefs.ts`, which `handover reconcile`'s trunk-moved hold reads too.

**Silence from either is a LOWER BOUND, never a clearance.** Discovery is depth one and the comparison is
against the last fetched ref, so confirm a CODE defect against `origin/main` yourself before you register it.
The advisory routes to stderr and never touches an exit code, exactly like the skill reminder beside it.

## Two things run AHEAD of the verb, and one of them refuses

`maybeWarnStaleSeat` advises. `rulingGateDoor` (`cli/rulingGateDoor.ts`) refuses: it reads the standing
ruling gates the board projected and stops a verb the owner's own recorded word gates
([ruling-gates](../../skills/handover/reference/ruling-gates.md)). Three placement facts are the design:

- **Before dispatch, never inside it.** `main.ts` asks before the router loads any verb; a check installed in
  one dispatch path would silently exempt every verb reached another way, and no test of the verdict would
  notice, because the exempted verbs simply never ask. `../../src/__tests__/unit/cli/mainGatePlacement.test.ts` is the
  structural guard, because nothing about a verdict function can express an ORDER.
- **And at the top of every body another verb calls in-process.** An imported verb function never passes
  `main.ts`, so a verb body an in-process path reaches opens with `const gated = refuseRunnerOnStandingRuling(…)`
  and `if (gated !== undefined) return …` — exactly that shape, the guard reads no other — in the deepest
  shell, so no caller can enter below it (a fresh audit found 47 such paths ungated). Writing a new
  path into an ungated body fails `../../src/__tests__/unit/cli/inProcessRulingGate.test.ts`.
- **`--help` is never gated at the boundary.** Help is not an action, and a gated verb whose usage cannot be
  read is a refusal with no next move. A BODY's gate exempts nothing: `main` answers help before a body runs,
  so a body handed `-h` would run, and `-h` can be another flag's value.
- **An argv `--home` only ADDS gates.** The boundary runs before the verb parses its flags and
  `slopweaverHome()` answers from the environment alone, so `gateHomes` reads the environment's projection
  always and an argv home's as well, in both spellings. Reading only the environment's let a gate in `<dir>`
  through; reading only argv's let `--home <empty>` switch every gate off (audit finding 04).

It costs one small file read, plus one per other home argv names: the measurement is in
`../../src/handover/rulingGateIndex.ts`, and a guardrail that taxes every invocation is one that gets removed.

## Exit codes carry meaning a harness reads

`0` is success. Three non-zero shapes are the verb working as designed and must not be counted as faults by a
reliability harness: `EXIT_USAGE` (2) is a caller mistake refused BEFORE the act phase,
`EXIT_EXPECTED_EMPTY` (3) is a legitimate non-success STATUS — no results, nothing to do, a prerequisite
absent — where the non-zero exit is the SIGNAL, so `verb || alert` still fires, and `EXIT_DEFERRED` (4) is
NOT YET: the verb ran, found a prerequisite still in progress, and did nothing so that running it again
unchanged is correct.

**`3` and `4` are not interchangeable, and a scheduler is where the difference bites.** An expected-empty
row did its work and there was none, so `automation run-due` and `automation claim` STAMP it; a deferred row has not
done its work at all, so both leave it unstamped and it is still due on the next tick. Reaching for `3` on a
not-yet would silence the row until its next firing — measured on the vulnerability-fix digest (`cli/commands/vulnerabilityFix/digest.ts` § `digestDeferral`).

`EXIT_ERROR` (1) is everything else, and it is not only a crash: a deliberate policy refusal exits 1 too, as
`codex status --check` does — its failure lines, then the four-line refusal
[error-handling.md](error-handling.md) mandates. Nothing about an exit 1 says which you got. Read the output.

**All of that is a contract, not an invariant.** Nothing gates it. The rule a path is held to: a file that
cannot be READ, a checkout that cannot be listed or is no repository, is `EXIT_ERROR`; only the argv, or content
that was read and is wrong (malformed JSON, an empty task file, a refused schema), is `EXIT_USAGE`. Measured,
these verbs returned `EXIT_USAGE` for a failed read or a missing checkout (`github vuln`,
`datadog submit`, `supervisor state-check`, `sop lint|publish`, `proposal lint|publish`, `browser image-record`,
`codex plan`, `codex plan-fallback`, `knowledge prune`); the catch-shaped ones reproduce with
`grep -rnE -B4 "return EXIT_USAGE" src/cli | grep catch`. When you touch a verb, check its failure paths
return what actually happened.

## The verb contract is the exception this tree runs into most

`(argv: readonly string[]) => number | Promise<number>` is dictated by the runtime, and
[typescript-patterns.md](typescript-patterns.md) exempts it by name. It is not the only exemption, and that
file's list is the authority: a type predicate such as `isTerminalDocStatus` is another one this repository
relies on. Read the list rather than assuming a single carve-out.
