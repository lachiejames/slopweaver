/**
 * Every gate `dev lint` runs, as the group functions that name them — lifted out of `devLint.ts` because
 * the 300-code-line cap made that file unable to accept another gate.
 * It stood at 480 code lines against a baselined 479, so registering `untested-modules` refused on the very
 * gate the cap exists to be: a file nobody can hold in their head. The split is the remedy the refusal names
 * rather than a way around it, and both files leave the debt list entirely.
 *
 * The REGISTRY lives here; the runner that spawns it, times it and composes its verdict stays in
 * `devLint.ts`, which is still the one door — `lintChecks` concatenates the two exports below, and
 * `gate-registration` still compares that single list against every `*.entry.ts`.
 *
 * Run order is the order these functions return, and it is pinned by the list in
 * `src/__tests__/unit/devLint/devLint/lintChecks.test.ts`, so a gate added here without a row there fails.
 */

import { ESBUILD_GO_MEMORY_LIMIT_MIB, goMemoryLimit } from "#lib/esbuildBounds.js";

import { type LintCheck } from "./devLint.js";

/** Resolves a local JS bin under a working directory — the one thing both halves of the plan need. */
type BinResolver = ({ name }: { name: string }) => string;

/**
 * The `prettier` gate's arguments. `--experimental-cli` is Prettier's own worker-pool CLI, shipped inside the
 * pinned package, so it adds no dependency. Single-threaded, `--check .` was the whole of lint's first
 * segment: 132.9s of a 239.9s lap on CI run 35939437166.
 *
 * MEASURED on one machine and tree, `/usr/bin/time -l node_modules/.bin/prettier <args>` per
 * spelling: `--check .` 90.8s at 868 MB peak; these arguments 33.9s at 2,111 MB; default workers (cpus−1)
 * 23.7s at 8,066 MB. Four workers keep the peak bounded beside three concurrent gates, the trade
 * `gateCapacity.ts` makes at the floor. `--no-cache` keeps the verdict off a cache file the repo does not key.
 *
 * Parity was checked, not assumed: planted misses at the root, under `__recordings__/` and in the gitignored
 * `dist-cli/` are listed identically by both CLIs, the `*.json` override applies, and a miss exits 1.
 *
 * Prettier proves formatting only. Import order and unused imports are `biome-imports`' subject, the gate
 * before it: Prettier with no organiser plugin cannot see a disordered or unused import.
 */
const PRETTIER_CHECK_ARGS: readonly string[] = [
  "--experimental-cli",
  "--no-cache",
  "--parallel-workers",
  "4",
  "--check",
  ".",
];

/**
 * The `biome-imports` gate's arguments: Biome as the import organiser only, configured by `biome.jsonc` (its
 * formatter and every lint rule but `noUnusedImports` off). It replaced `prettier-plugin-organize-imports`,
 * which calls TypeScript 6's language service and returns the source unchanged under TypeScript 7.
 * `--max-diagnostics=20` bounds a failing run's output; the exit code carries the verdict.
 */
const BIOME_CHECK_ARGS: readonly string[] = ["check", "--max-diagnostics=20", "."];

/**
 * The forbidden-identifier half of the hygiene gate: hashed person, organisation and product tokens, real
 * provider ids, team keys and non-synthetic provider workspace locations, printed as a bounded summary and
 * failing wherever `IDENTIFIER_VERDICT` in `src/hygiene/scan.ts` reads `refuse`. No `offRepoState`: its
 * subject is the tree and its rules are committed, so CI sees everything it does and runs it there. MEASURED:
 * 10.1s of gate time over the whole tree — the cost that keeps it out of `pre-push`
 * (`/usr/bin/time -p yarn slopweaver dev lint --only forbidden-identifiers`).
 *
 * @param bin resolves a local JS bin
 * @returns the forbidden-identifiers check
 */
function forbiddenIdentifiersCheck({ bin }: { bin: BinResolver }): LintCheck {
  return {
    args: ["src/devLint/forbiddenIdentifiers.entry.ts"],
    cmd: bin({ name: "tsx" }),
    name: "forbidden-identifiers",
  };
}

/**
 * The checks run by tools we did NOT write: the formatters, the linters, the dependency and hygiene gates.
 * Split out from {@link bespokeRatchets} only so each stays inside the per-function line ceiling this repo
 * enforces on itself — the run order is the concatenation, and `lintChecks` is still the one door.
 *
 * `oxlint --type-aware`: backed by `oxlint-tsgolint`, this is the type-aware lane ESLint/typescript-eslint used
 * to own (floating promises, misused promises, switch exhaustiveness, …) — see `.oxlintrc.jsonc`'s own comment
 * for the full rule-by-rule port. `--tsconfig`: the same tree ESLint's `TS_GLOBS` used to cover (src/eval/hooks),
 * which the root `tsconfig.json` alone does not include.
 *
 * Its `exclusive` and `GOMAXPROCS`: the type-aware pass is the Go binary `tsgolint`, holding the whole ~18k-file
 * Program, and it starts one checker worker per core. MEASURED alone on a 10-core, 16 GB Mac, one run each,
 * max RSS then wall: uncapped 7.30 GB / 48.7s; GOMAXPROCS=4 5.71 GB / 22.2s; =2 6.63 GB / 27.8s; =1
 * 5.67 GB / 43.8s; =4 with GOMEMLIMIT=3GiB 6.07 GB / 48.4s at 2.3x the CPU, the collector churning, so about
 * 5.7 GB is live Program and only the workers' share is cuttable. Four is the fastest, and within 0.04 GB of
 * the lowest peak. Reproduce one figure with `GOMAXPROCS=4 /usr/bin/time -l node_modules/.bin/oxlint <these
 * args>`. Even capped, it is a pool slot nearly twice over (`gateCapacity.ts` gives a 16 GB machine five
 * 3,072 MiB slots). Uncapped beside five other gates during a lap, the process table read the tsgolint process
 * itself at 10 GB resident with the machine 8.3 of 9 GB into swap, so it runs alone.
 *
 * @param bin resolves a local JS bin
 * @returns the external checks, in run order
 */
export function externalChecks({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // CI's: its subject is the tree. Before `prettier`, the order `yarn format` and the pre-commit hook write
    // in, because Prettier may rewrap an import line Biome wrote and a second Biome pass then changes nothing.
    { args: BIOME_CHECK_ARGS, cmd: bin({ name: "biome" }), name: "biome-imports" },
    // CI's, like every gate whose subject is the tree. It was the single slowest one in the plan — 76.6s of
    // a 260.8s lint lap, MEASURED (reproduce one gate
    // with `time yarn slopweaver dev lint --only prettier`) — and its absence from `pre-push` costs very
    // little that was not already covered: the `pre-commit` hook runs Prettier over the staged files and
    // re-stages them, so a formatting miss reaching a push at all means the commit bypassed that hook.
    { args: PRETTIER_CHECK_ARGS, cmd: bin({ name: "prettier" }), name: "prettier" },
    // `oxlint`: `--type-aware`, `exclusive` and `GOMAXPROCS` are explained on this function's own doc comment.
    // The seat lane's narrowed form (`seatLint.ts`) runs LAST and ALONE and is withheld while a lap holds the
    // machine: narrowing the file list barely narrows the memory. MEASURED on a 16 GB M1, two points: 37 changed
    // files ran 3.27 s at max resident 4,455,120,896 bytes (about 4,249 MiB); 71 ran 4.48 s at 4,961,337,344
    // bytes (about 4,731 MiB). Both are past the 3,072 MiB bespoke-gate slot, and the peak GROWS with the file
    // count, so either figure is a floor for a larger diff, never a constant. Reproduce:
    // `/usr/bin/time -l node_modules/.bin/oxlint --type-aware --deny-warnings -- $(git diff --name-only origin/main...HEAD)`.
    {
      args: ["--type-aware", "--tsconfig", "./config/typescript/tsconfig.lint.json", "--deny-warnings", "."],
      cmd: bin({ name: "oxlint" }),
      env: { GOMAXPROCS: "4" },
      exclusive: true,
      name: "oxlint",
    },
    // `--exclude`: every OTHER default issue type still runs here (dead files/deps, unlisted, unresolved,
    // enum/namespace members, …). `exports`/`types`/`nsExports`/`nsTypes` move to
    // `internal-exports.entry.ts`, which runs the same resolution but tolerates today's committed baseline —
    // something a bare `knip` (exit non-zero on any finding at all) cannot express.
    { args: ["--exclude", "exports,nsExports,types,nsTypes"], cmd: bin({ name: "knip" }), name: "knip" },
    { args: ["constraints"], cmd: "yarn", name: "constraints" },
    // `offRepoState`: the leak classes run everywhere, but the PRIVATE denylist
    // (`$SLOPWEAVER_HOME/hygiene-denylist.txt`, uncommitted) and the private terms
    // (`$SLOPWEAVER_HOME/hygiene/private-terms.tsv`) exist on this machine and on no runner, so the
    // half that catches a literal no pattern can express only ever runs here. This is the secrets scan that is
    // the local lane's whole purpose; `docs/security/hygiene-gate.md` § "Where the private denylist
    // actually applies" carries what that leaves unchecked. MEASURED: 4.0s
    // (`/usr/bin/time -p yarn slopweaver dev lint --only hygiene`).
    { args: ["scripts/check-hygiene.sh"], cmd: "bash", name: "hygiene", offRepoState: true },
    forbiddenIdentifiersCheck({ bin }),
    // The same leak classes and the same private denylist, pointed at the CORPUS instead of the repository.
    // The ONLY check here whose subject is not the tree — it reads `$SLOPWEAVER_HOME`, because that is where
    // both bronze and the private denylist live. On a machine with no corpus (CI, a fresh checkout, a fork)
    // it finds no bronze, says so in one line and exits 0, so it costs those lanes nothing.
    //
    // MEASURED on one install: 35.9 s, streaming, so its heap is a read buffer rather than a
    // corpus. Reproduce with `/usr/bin/time -p yarn slopweaver dev lint --only corpus-hygiene`. That is the
    // cost of the lane — roughly four fifths of what the whole local lane now takes — and it is deliberately
    // paid on every `pre-push` rather than nowhere: before this line the verb was opt-in prose in three
    // skills, it had exited 1 on this corpus for as long as anyone had looked, and nobody was looking. It is
    // the obvious-looking cut and it is the wrong one while `pre-push` is the only trigger it has; moving it
    // to a scheduled row is the named next step, not a deletion.
    {
      args: ["src/hygiene/corpusScan.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "corpus-hygiene",
      offRepoState: true,
    },
  ];
}

/**
 * The bespoke ratchets — each a `src/devLint` gate run through `tsx`, and each one a defect this repo actually
 * shipped before the gate existed.
 *
 * Split into {@link sourceShapeRatchets}, {@link qualityRatchets}, {@link docClaimRatchets} and
 * {@link claimRatchets} for the same
 * reason `externalChecks` is separate: so each stays inside the per-function line ceiling this repo enforces
 * on itself. The run order is the concatenation, and it is pinned by
 * `src/__tests__/unit/devLint/devLint/lintChecks.test.ts`.
 *
 * @param bin resolves a local JS bin
 * @returns the bespoke checks, in run order
 */
export function bespokeRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    ...sourceShapeRatchets({ bin }),
    ...qualityRatchets({ bin }),
    ...docClaimRatchets({ bin }),
    ...claimRatchets({ bin }),
    ...contractRatchets({ bin }),
  ];
}

/**
 * The ratchets about how this repository REACHES OUTSIDE the process — a child it launches, a provider it
 * calls, a channel it writes data down, a root it resolves. Split out of {@link sourceShapeRatchets} when
 * `console-verb-binary` joined them and the combined list stopped fitting in one reading; the seam is a
 * real one, because every gate here is about a call crossing the process boundary rather than about the
 * shape of a signature or a body.
 *
 * @param bin resolves a local JS bin
 * @returns the reach checks, in run order
 */
function reachRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails if a hand-rolled retry/backoff/rate-limiter is reintroduced after the PR3.5 librafication (D21).
    { args: ["src/devLint/resilienceResidue.entry.ts"], cmd: bin({ name: "tsx" }), name: "resilience-residue" },
    // Fails if an external boundary (SDK/LLM/embed) is called outside a safe* wrapper (PR3.6 typed errors).
    { args: ["src/devLint/boundaryResidue.entry.ts"], cmd: bin({ name: "tsx" }), name: "boundary-residue" },
    // Fails if an SDK client is constructed outside a sanctioned factory (PR5.2). The gap the two rules
    // above leave: a fresh client somewhere new is neither hand-rolled backoff nor an unwrapped boundary,
    // it is a second door whose calls never reach the shared 429 block.
    { args: ["src/devLint/schedulerBypass.entry.ts"], cmd: bin({ name: "tsx" }), name: "scheduler-bypass" },
    // Fails if an external-write verb or a sanctioned SDK factory has no classification against the outbound
    // privacy check, or a family classified guarded no longer reaches `checkPrivacy` through its runtime imports.
    {
      args: ["src/devLint/outboundPrivacyClosure.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "outbound-privacy-closure",
    },
    // Fails if anything in the repo starts a model: an async child_process capability (spawn/exec/execFile/
    // fork), a bare call to one, a model-runner basename in command position, a mutating launchctl
    // subcommand, or a real launchd job in a `.plist`. AGENTS.md rule 2 — no headless Claude, anywhere.
    { args: ["src/devLint/noHeadless.entry.ts"], cmd: bin({ name: "tsx" }), name: "no-headless" },
    // Fails if a safe*Call operation label is absent from OPERATION_ENDPOINT_CLASS, is a template literal,
    // or skips the shared block outside the preflight allowlist (PR5.2.1b). An unmapped Slack label falls
    // back to tier1 — a 75-second interval — so this is the gate that keeps that trap disarmed.
    { args: ["src/devLint/operationLabels.entry.ts"], cmd: bin({ name: "tsx" }), name: "operation-labels" },
    // Fails if a verb reaches `process.stdout.write` instead of `logger.out`. That write is async on a
    // pipe and `runCliProcess` ends with `process.exit`, so a `--json` document over the 64 KiB pipe buffer
    // arrived truncated mid-string with exit code 0 — measured at exactly 65,536 of 300,012 bytes. The exit
    // now drains first (`src/lib/drainStdio.ts`); this gate keeps the verb surface on the channel that
    // never queues.
    { args: ["src/devLint/stdoutDataChannel.entry.ts"], cmd: bin({ name: "tsx" }), name: "stdout-data-channel" },
    // Fails if code outside the gates resolves a repository from its OWN module (`repoRootOf`). A plugin
    // mirror carries no `.git`, so that lookup throws forever there — it destroyed a composed, reviewed bot
    // answer, days after the identical class was fixed, in prose, in one other file.
    { args: ["src/devLint/runningCheckoutRoot.entry.ts"], cmd: bin({ name: "tsx" }), name: "running-checkout-root" },
    // Fails if the work console under `site/` launches a child by a literal command name. `site/` is a
    // separate Yarn project whose lane-reached sliver is its PURE modules alone, so a gate is the only
    // mechanism that can hold this class down — and it decided, invisibly, which checkout CLI answered a tile.
    { args: ["src/devLint/consoleVerbBinary.entry.ts"], cmd: bin({ name: "tsx" }), name: "console-verb-binary" },
    // Fails on a synchronous child (`execSync`/`execFileSync`/`spawnSync`) with no visible `timeout`. A sync
    // child blocks the event loop, so nothing in the process can end one waiting on a keychain dialog or a
    // credential prompt. 74 such calls stood at the gate's introduction; 17 remain as per-file debt that only shrinks.
    { args: ["src/devLint/syncChildTimeout.entry.ts"], cmd: bin({ name: "tsx" }), name: "sync-child-timeout" },
  ];
}

/**
 * The ratchets about how CODE is written — the shape of a signature, the size of a body, the bytes in a file.
 *
 * @param bin resolves a local JS bin
 * @returns the source-shape checks, in run order
 */
function sourceShapeRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    ...reachRatchets({ bin }),
    // Fails if a function body exceeds the per-function line ceiling (PR3.6 pure-core discipline).
    { args: ["src/devLint/maxFunctionLines.entry.ts"], cmd: bin({ name: "tsx" }), name: "max-function-lines" },
    // Fails if a signature written HERE takes more than one parameter, or one that is not an options object.
    // No off-the-shelf rule is equivalent: `max-params` counts parameters and never asks what the sole one IS.
    // The only gate that builds a real `ts.Program`, because that question needs resolved types.
    // `--expose-gc`: it measures its own LIVE heap against a declared budget, and a live set can only be read
    // after a forced major GC. `--max-old-space-size=8192`: the process CEILING, not the budget — without it
    // the gate OOMed below its own check (measured: 4,079 MiB against V8's ~4,096 default). Both
    // see `HEAP_BUDGET_MIB`; this gate is the one that OOMed CI at random until the cost was measured. The
    // whole-repo Program is the reason a lane split exists at all, and lane membership is an opt-in, so
    // cost decides nothing. It is CI's because CI can run it. See {@link checksForLane}.
    // `exclusive`: one of the two gates (with `oxlint`) that run with NOTHING beside it, its live heap being
    // nearly the whole runner. Measurement, criterion and cost are on {@link LintCheck.exclusive} rather than repeated here.
    {
      args: ["--expose-gc", "--max-old-space-size=8192", "src/devLint/namedObjectParams.entry.ts"],
      cmd: bin({ name: "tsx" }),
      exclusive: true,
      name: "named-object-params",
    },
    // Fails if a module that reads from disk appends with `push(...spread)`. The argument count is the size
    // of the SPREAD SOURCE, so a whole-file or whole-subtree spread blows the engine's ~124k argument limit
    // — which is how one bronze window file of well over a hundred thousand records took every bronze-reading verb down at once.
    { args: ["src/devLint/unboundedSpread.entry.ts"], cmd: bin({ name: "tsx" }), name: "unbounded-spread" },
    // Fails if a text source carries a control character other than tab/LF/CR. A NUL trips git's
    // binary heuristic, so the file renders as `Binary files differ` — invisible in review, and the Codex
    // review arm refuses the whole diff. One shipped in issueLedger.ts and hid 239 lines from review.
    { args: ["src/devLint/controlBytes.entry.ts"], cmd: bin({ name: "tsx" }), name: "control-bytes" },
    // Fails if the tree carries proof output (a proof/screenshots folder, a proof-named picture or tape) or
    // the gitignore lost the block that stops one being staged. A proof folder has no place in any pull
    // request, and one had been committed repeatedly.
    { args: ["src/devLint/noProofPath.entry.ts"], cmd: bin({ name: "tsx" }), name: "no-proof-path" },
    { args: ["src/devLint/gitInTests.entry.ts"], cmd: bin({ name: "tsx" }), name: "git-in-tests" },
    { args: ["src/devLint/outboundFormStrict.entry.ts"], cmd: bin({ name: "tsx" }), name: "outbound-form-strict" },
    // Fails if a hand-written client fetches and reads JSON with no strict per-endpoint schema (defineBoundary).
    // The first strict read of /api/oauth/usage named 28 fields the old read dropped.
    { args: ["src/devLint/boundarySchema.entry.ts"], cmd: bin({ name: "tsx" }), name: "boundary-schema" },
    // Fails on a missing JSDoc block, or @param names that disagree with the parameters (doc rot: 5 found).
    { args: ["src/devLint/jsdocTags.entry.ts"], cmd: bin({ name: "tsx" }), name: "jsdoc-tags" },
    ...astRatchets({ bin }),
  ];
}

/**
 * The ratchets that walk the TypeScript AST directly, because no configured linter has a mechanism for them
 * — every one of these either replaces a deleted ESLint rule or enforces a rule file categorically.
 *
 * Split from {@link sourceShapeRatchets} on that shared reason rather than to satisfy the line cap: these are
 * the checks whose logic lives in this repo's own compiler-API walkers, so they are the ones to read when a
 * house rule needs changing.
 *
 * @param bin resolves a local JS bin
 * @returns the AST-walking checks, in run order
 */
function astRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails if a payload whose size is set by DATA passes through one JS string: a `.jsonl` read or written
    // whole, or a whole-payload JSON write in a module that reads the corpus. `silver/graph/graph.json` went
    // out through one `JSON.stringify` of 282 MiB of edges — a 295.7M-char string, copied three times, at
    // 3,982 MiB RSS, 55% of the way to the same V8 string wall that already broke `compact`.
    { args: ["src/devLint/wholeFileJson.entry.ts"], cmd: bin({ name: "tsx" }), name: "whole-file-json" },
    // Fails if a function scores over the cognitive-complexity ceiling (eslint-oom-crash-blocks-validate:
    // replaces `sonarjs/cognitive-complexity`, deleted along with ESLint; oxlint has no equivalent).
    { args: ["src/devLint/cognitiveComplexity.entry.ts"], cmd: bin({ name: "tsx" }), name: "cognitive-complexity" },
    // Fails on the fail-loud / entry-point / escape-hatch house rules ESLint's `no-restricted-syntax`
    // selectors used to enforce (eslint-oom-crash-blocks-validate: oxlint has no custom-selector mechanism).
    { args: ["src/devLint/houseRules.entry.ts"], cmd: bin({ name: "tsx" }), name: "house-rules" },
    ...testContentRatchets({ bin }),
    ...errorHandlingRatchets({ bin }),
    ...spellingRatchets({ bin }),
    ...atlasRatchets({ bin }),
    // Fails on a launched browser, an attached one, or a profile directory named for one — the
    // owner's real Chrome is the only browser anything here drives. Four lanes each grew their own
    // launcher independently, which is why this is a gate rather than a line in a doc.
    {
      args: ["src/devLint/noPrivateBrowserProfile.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "no-private-browser-profile",
    },
    ...providerValueRatchets({ bin }),
    ...storeRatchets({ bin }),
    // Fails if a new top-level function's body is structurally identical to a REGISTERED canonical
    // primitive's (code-quality round 2 item 7) — `optStr` drifted to 14 copies in one day; this is the
    // narrow AST ratchet `duplicateWindows.ts`'s own header names as its missing complement.
    { args: ["src/devLint/primitiveRatchet.entry.ts"], cmd: bin({ name: "tsx" }), name: "primitive-ratchet" },
    // Fails if a test file calls a home-defaulting export without providing `home` (code-quality survey item
    // 10) — the shape that silently reads and writes the developer's real `~/.slopweaver` instead of failing.
    { args: ["src/devLint/homeSafety.entry.ts"], cmd: bin({ name: "tsx" }), name: "home-safety" },
    // Fails on a catastrophic-backtracking regex — replaces `eslint-plugin-regexp`'s `no-super-linear-
    // backtracking`, via the exact `scslre` library + options that rule itself calls (read from its source).
    { args: ["src/devLint/redosCheck.entry.ts"], cmd: bin({ name: "tsx" }), name: "redos-check" },
    // Fails if a module names the `typescript` package outside its four seam files, or the compiler seam
    // outside named-object-params. Moving to TypeScript 7's library is then a change to four files, not ninety.
    { args: ["src/devLint/typescriptImportSeam.entry.ts"], cmd: bin({ name: "tsx" }), name: "typescript-import-seam" },
    // Fails if a package the plugin's CLI reaches at run time is not in `dependencies`: the plugin install is
    // runtime-only (`scripts/plugin-install-deps.sh`), so a devDependency the CLI imports throws on the
    // user's machine while every lane here, on a full tree, stays green. It bundles the whole CLI graph in memory
    // through esbuild's JavaScript API, whose `esbuild --service` child is a Go binary that inherits this row's
    // `env`: `GOMEMLIMIT` is its soft limit, the one number `src/lib/esbuildBounds.ts` owns. Its peak is unmeasured.
    {
      args: ["src/devLint/runtimeDependencies.entry.ts"],
      cmd: bin({ name: "tsx" }),
      env: { GOMEMLIMIT: goMemoryLimit({ mib: ESBUILD_GO_MEMORY_LIMIT_MIB }) },
      name: "runtime-dependencies",
    },
  ];
}

/**
 * The two gates whose subject is a TEST's own content — what it may reach for, and what it may claim to have
 * proved. Split from {@link astRatchets} on that shared reason: they are the pair to read when
 * `.claude/rules/testing.md` changes, and the second landed because a survey measured the first one's bans
 * holding while a whole class of assertion nothing checked went on growing.
 *
 * @param bin resolves a local JS bin
 * @returns the test-content checks, in run order
 */
function testContentRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails on the testing-discipline bans testing.md machine-enforces across the whole test TREE (same reason).
    { args: ["src/devLint/testingDiscipline.entry.ts"], cmd: bin({ name: "tsx" }), name: "testing-discipline" },
    // Fails on a test case whose every assertion says a result failed and names no failure, against a debt
    // list that only ratchets down — error-handling.md § Tests already says a which-failure check asserts the
    // error's code; two survey lenses agreed on the class.
    {
      args: ["src/devLint/unnamedFailureAssertion.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "unnamed-failure-assertion",
    },
  ];
}

/**
 * The two gates that hold the two sides of `error-handling.md`'s union rule — one refusing a `Result` written
 * by hand, the other refusing a domain that keeps authoring plain message strings past the point where a
 * typed union is owed. Split from {@link astRatchets} on that shared reason.
 *
 * @param bin resolves a local JS bin
 * @returns the error-shape checks, in run order
 */
function errorHandlingRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails on a hand-rolled `Result` — an `ok`-discriminated union, which error-handling.md bans outright.
    { args: ["src/devLint/handRolledResult.entry.ts"], cmd: bin({ name: "tsx" }), name: "hand-rolled-result" },
    // Fails on a directory authoring more distinct plain error message shapes into `err`/`errAsync` than the
    // threshold allows, against a debt list that only ratchets down — error-handling.md's other side: past a
    // few only-displayed messages, a domain declares its typed union.
    {
      args: ["src/devLint/errorShapeThreshold.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "error-shape-threshold",
    },
  ];
}

/**
 * The three gates whose subject is a SPELLING an author chose — a nested ternary, a silent fallback, a
 * Python interpreter — each enforcing one `typescript-patterns.md` § Other rules bullet the owner ruled on
 * by name. Split from {@link astRatchets} on that shared reason: they are the ones to read when a house rule
 * about how code is WRITTEN changes, rather than a rule about what a module may reach.
 *
 * @param bin resolves a local JS bin
 * @returns the spelling checks, in run order
 */
function spellingRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails on a ternary whose branch is itself a ternary — nested ternaries
    // should be if statements instead. typescript-patterns.md § Other rules bans it.
    { args: ["src/devLint/noNestedTernaries.entry.ts"], cmd: bin({ name: "tsx" }), name: "no-nested-ternaries" },
    // Fails on a separator character somebody typed into a card's TL;DR — the
    // mistake is made impossible to author rather than caught after the fact. Its pair is the headline
    // form in `src/outbound/artifact/headline.ts`, which takes the ideas as fields and joins them itself.
    { args: ["src/devLint/authoredSeparator.entry.ts"], cmd: bin({ name: "tsx" }), name: "authored-separator" },
    // Fails on an em or en dash in a literal the app itself writes, against a debt list that only ratchets down.
    // An em dash is a voice rule violation for anything shown in the app.
    { args: ["src/devLint/appCopyVoice.entry.ts"], cmd: bin({ name: "tsx" }), name: "app-copy-voice" },
    // Fails on a reference that only means something to one installation's history (a dated ruling, a commit,
    // pull request, turn, call or session id, a time of day, an attributed quote, a masculine pronoun for the
    // owner, a knowledge row, store pointer, voice turn or handover run id) past its file's per-class debt entry.
    // Slopweaver is generic to any checkout.
    { args: ["src/devLint/transientReferences.entry.ts"], cmd: bin({ name: "tsx" }), name: "transient-references" },
    // Fails on a value silently substituted for an absent one — `??`, `??=`, `||=`, or a `||` falling back to
    // a literal — against a debt list that only ratchets down. The motivating shape was `x.handle ?? x.nativeId`.
    { args: ["src/devLint/noSilentFallback.entry.ts"], cmd: bin({ name: "tsx" }), name: "no-silent-fallback" },
    // Fails on a Python invocation, or an instruction to run one.
    { args: ["src/devLint/noPython.entry.ts"], cmd: bin({ name: "tsx" }), name: "no-python" },
    // Fails on ANY name this repository declares that calls a construct legacy. Scoped to names and
    // type-position literals, never prose; Cloudflare's Legacy WAF and generated provider boundaries are
    // outside the criterion. A plain rule with no debt list.
    { args: ["src/devLint/legacyVocabulary.entry.ts"], cmd: bin({ name: "tsx" }), name: "legacy-vocabulary" },
    // Fails if a string the code EMITS carries a brace-form `CLAUDE_PLUGIN_ROOT`/`PLUGIN_ROOT`. The harness
    // substitutes those only when it reads a `SKILL.md`; a worker's shell leaves them empty, so `turn
    // resume`'s step 0a printed a command resolving to `/bin/slopweaver` and the trailing `&` reported exit
    // 0 over the failure — the card-clock remedy was inert in exactly the case it was built for.
    {
      args: ["src/devLint/unexpandedPluginRoot.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "unexpanded-plugin-root",
    },
    // Fails on a console page telling the reader it is still reading or loading in words ending in an ellipsis —
    // a progress indicator says it better than text does. `site/` is a separate
    // Yarn project, so a gate is the only mechanism that holds its React source to that.
    {
      args: ["src/devLint/consoleLoadingProse.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "console-loading-prose",
    },
  ];
}

/**
 * The three gates whose subject is a value or surface a PROVIDER owns, used here as something it is not —
 * an account address read as identity, a hand-written query where the SDK ships one, a numeric time field
 * scaled by hand. Split out of {@link astRatchets} for the same reason {@link atlasRatchets} was: these are
 * the ones to read when a provider's own data starts being trusted for more than it says.
 *
 * @param bin resolves a local JS bin
 * @returns the provider-value checks, in run order
 */
function providerValueRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails where a Claude module asks WHICH ACCOUNT from `accounts.json`'s `email` — an equality against a
    // real value, a collection lookup, a computed key. That string is hand-typed, a `/login` does not touch
    // it, and it drifts from the token in the store, and a launch was once held on exactly that.
    {
      args: ["src/devLint/claudeEmailIdentity.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "claude-email-not-identity",
    },
    // Fails on hand-written Linear GraphQL wherever `@linear/sdk` already ships a document for the root
    // field — the rule is SDK-first, made
    // structurally impossible to break. The criterion is derived from the pinned bundle at scan time, so the two operations the
    // SDK cannot express (the atlas introspection query, `oauthApplications`) fall outside it unnamed.
    {
      args: ["src/devLint/linearSdkDocuments.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "linear-sdk-documents",
    },
    // Fails on `new Date(x * 1000)` outside `lib/date.ts` and `lib/slackTs.ts` — a hand-scaled epoch. Four
    // copies of `tsToIso` plus four ad-hoc conversions stood here at once, so there was no single function a
    // rule could name; the human half of that was a `ts` read 80 minutes wrong into two deadman deadlines.
    { args: ["src/devLint/epochArithmetic.entry.ts"], cmd: bin({ name: "tsx" }), name: "epoch-arithmetic" },
    // Fails on a product module statically importing `src/cli/commands/` — 17 such imports in 14 files once made
    // verb modules a library (the bot's answer path loaded the Slack verb's chat wiring). `cli/` depends on
    // product code, never the reverse; a dynamic `import()` thunk is the named blind spot.
    { args: ["src/devLint/cliCommandBoundary.entry.ts"], cmd: bin({ name: "tsx" }), name: "cli-command-boundary" },
    // Fails on a filesystem append anywhere but `lib/appendSeparator.ts`'s `appendLines` — 78 append call sites had
    // no torn-tail guard, so a record written after a crash fused with the cut-short last line and one death
    // record was written twice. A shrinking debt list holds the
    // descriptor appends that guard themselves.
    { args: ["src/devLint/tornTailAppend.entry.ts"], cmd: bin({ name: "tsx" }), name: "torn-tail-append" },
    // Fails on a cmux launch (`spawnCmuxSession`) or a hand-appended `spawned` session row outside
    // `src/sessionHarness/` — the seam's recording launcher is the one writer of a session's ledger row, so a launch
    // reaching past it leaves no row. A shrinking debt list holds the openers `harness-stage-1c` moves.
    {
      args: ["src/devLint/sessionHarnessLifecycle.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "session-harness-lifecycle",
    },
  ];
}

/**
 * The gate that judges the STORE's generated migrations rather than a syntax tree — split out of
 * {@link astRatchets} for the same reason {@link atlasRatchets} was, and because the next rule about what
 * reaches Postgres belongs beside this one rather than in a list of AST walkers.
 *
 * @param bin resolves a local JS bin
 * @returns the store-wide checks, in run order
 */
function storeRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails on a table the schema declares and no migration creates, a journal whose order two branches
    // both wrote into, and a statement Postgres refuses inside the migrator's single transaction. Ported
    // as design from the archive's check-drizzle-schema --journal and check-drizzle-migration-safety;
    // a schema edit with no migration is refused by the drift half, so the schema and the DDL cannot disagree silently.
    {
      args: ["src/devLint/drizzleMigrations.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "drizzle-migrations",
    },
    // The committed migration journal is resolved from the tree this build lives in, never the operator cwd.
    // Two spawned seats an hour apart could not read or write the knowledge register from inside a worktree
    // because the store resolved `supabase/migrations` against their own directory — a class that is
    // invisible in the main checkout, which is why prose could never have held it.
    {
      args: ["src/devLint/storeJournalAnchor.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "store-journal-anchor",
    },
  ];
}

/**
 * The two gates that judge an ATLAS rather than a syntax tree — split out of {@link astRatchets} so neither
 * list has to grow past what one screen holds, and because the next atlas-wide rule belongs beside these.
 *
 * @param bin resolves a local JS bin
 * @returns the atlas-wide checks, in run order
 */
function atlasRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails on a per-atlas copy of the manifest-stamping the kit owns — the shape that left the 1Password
    // generation reading 5 days 11 hours stale. `atlasManifestClock.ts` carries the measurement and criterion.
    { args: ["src/devLint/atlasManifestClock.entry.ts"], cmd: bin({ name: "tsx" }), name: "atlas-manifest-clock" },
    // Fails on an atlas that declares a surface it cannot divide by anything independent, and ratchets the
    // debt of the ones that already do. It exists because the Vanta atlas reported both surfaces
    // filled while calling 24 of 107 documented GET operations — `atlasContentCoverage.ts` carries the
    // measurement and the three rules.
    {
      args: ["src/devLint/atlasContentCoverage.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "atlas-content-coverage",
    },
  ];
}

/**
 * The Phase-0 code-quality ratchets: instruments that hold today's measured state and refuse a regression,
 * without blocking on a refactor to land first — the `coverage-ratchet` shape, extended to a new metric.
 *
 * @param bin resolves a local JS bin
 * @returns the quality-ratchet checks, in run order
 */
function qualityRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails if the count of cross-file 15-line duplicate windows exceeds the committed floor (code-quality
    // survey item 17). A ratchet, not a hard ban: `yarn devlint:clone-rebaseline` tightens it as clones fall.
    { args: ["src/devLint/duplicateWindows.entry.ts"], cmd: bin({ name: "tsx" }), name: "duplicate-windows" },
    // Fails if a file's CODE-line count (comments/blanks excluded) crosses its cap — MAX_FILE_LINES, or
    // MAX_TEST_FILE_LINES (500) for a `*.test.ts(x)` — or an existing offender
    // grows past its baselined count (every file stays under 300 lines of code, excluding
    // comments and whitespace). Ratchet, not a hard ban: `yarn devlint:file-size-rebaseline`
    // tightens it as files split, and it refuses to raise an entry that already exists. Also fails on an
    // exemption marker with no signed row in `.baselines/file-size-tradeoffs.json`, on a tradeoff row whose
    // marker is gone, and on the retired register marker (oversized files are split).
    { args: ["src/devLint/fileSizeRatchet.entry.ts"], cmd: bin({ name: "tsx" }), name: "file-size-ratchet" },
    // Fails if a symbol knip flags as having no consumer outside its own file / a test file is neither
    // `@internal`-tagged nor in the committed baseline (code-quality survey item 5). Ratchet, not a mass
    // annotation: `yarn devlint:internal-rebaseline` shrinks the baseline as symbols get resolved.
    // In the seat lane although it runs knip's whole-project resolution: MEASURED on a 16 GB M1,
    // peak resident 1,451 MiB and 9.3 s wall, under the 3,072 MiB bespoke-gate slot (`gateCapacity.ts`).
    // Reproduce: `/usr/bin/time -l node --import tsx src/devLint/internalExports.entry.ts`.
    { args: ["src/devLint/internalExports.entry.ts"], cmd: bin({ name: "tsx" }), name: "internal-exports" },
    // Fails if a production module under src/ exports a VALUE that no file under src/__tests__/ imports
    // (enforced test coverage). Complements coverage-ratchet rather than replacing it:
    // that one measures execution percentages, this one measures whether a module is reached at all.
    // Debt list only shrinks: `yarn devlint:untested-rebaseline`.
    { args: ["src/devLint/untestedModules.entry.ts"], cmd: bin({ name: "tsx" }), name: "untested-modules" },
    // Fails if a *.test.ts under src/__tests__/ that this branch MODIFIED asserts less than the same file
    // asserted at SLOPWEAVER_COVERAGE_BASE_SHA (enforced prevention of test
    // enshitification). A DIFF gate, so no debt list: it compares a file against its own past, which no
    // baseline can express. CI and `github lap` export the base; with none it fails and names the fix.
    {
      args: ["src/devLint/testEnshittification.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "test-enshittification",
    },
    // Fails if a committed ratchet baseline is looser than its copy at SLOPWEAVER_COVERAGE_BASE_SHA and no
    // bump manifest new in this change declares exactly that (the implementer never
    // raises its own bar). The witness is the landing verbs'; with no base it fails and names the fix.
    {
      args: ["src/devLint/baselineAgainstMain.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "baseline-against-main",
    },
  ];
}

/**
 * The ratchets about what the DOCUMENTATION claims — the counts it states, every markdown file's size,
 * whether its links still land, and whether it still describes a shape the owner has since replaced.
 *
 * Split out of {@link claimRatchets} rather than living inside it: both judge claims, but these four read
 * markdown and none of them reads a manifest, a register or the lint plan. The split also keeps each function
 * under the `max-function-lines` cap this repo enforces on itself — the run order is the concatenation.
 *
 * @param bin resolves a local JS bin
 * @returns the doc-claim checks, in run order
 */
function docClaimRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails if a doc loaded as INSTRUCTIONS states a hard-coded count. `AGENTS.md` told every session the
    // repo had 201 unit files when it had 231, and the same claim had drifted independently across three
    // other docs — a false fact handed to every agent before it read any code.
    { args: ["src/devLint/docCounts.entry.ts"], cmd: bin({ name: "tsx" }), name: "doc-counts" },
    // Fails if a tracked markdown file crosses its raw-line cap — 200 for an agent-facing one (`AGENTS.md`,
    // `CLAUDE.md`, `.claude/rules/**`, `skills/**`), 300 for every other — or an existing offender grows past
    // its baselined count. Extra context is LINKED, never inlined —
    // progressive disclosure everywhere. Ratchet while a descent is in progress:
    // `yarn devlint:agent-doc-rebaseline` tightens it; with the baseline file deleted it is a plain cap.
    { args: ["src/devLint/agentDocSize.entry.ts"], cmd: bin({ name: "tsx" }), name: "agent-doc-size" },
    // Fails on a local markdown link, or a repo-rooted doc reference in source, naming no tracked file or no
    // heading/explicit anchor in it; and on a `docs/` or skill `reference/` page no index reaches. The size
    // cap above is met by MOVING detail into child pages, and a move breaks every inbound anchor while each
    // file still reads perfectly — this is what keeps the moved detail linked into one tree.
    { args: ["src/devLint/docLinks.entry.ts"], cmd: bin({ name: "tsx" }), name: "doc-links" },
    // Fails on an agent-facing doc still pointing a session at the owner's keystrokes in ITS OWN TAB while never
    // naming the journalled grant that replaced that shape. A one-off sweep rots
    // the first time somebody writes the old sentence again, and it rewrites easily because it reads as
    // caution. It fired on four lines of `.claude/rules/cross-session-messages.md` the day it was written.
    { args: ["src/devLint/ownHandResidue.entry.ts"], cmd: bin({ name: "tsx" }), name: "own-hand-residue" },
    // Fails on a line ADDED against SLOPWEAVER_COVERAGE_BASE_SHA, outside every `__tests__` tree, that names the
    // host by its make rather than "this machine". A DIFF gate, so lines already on the base need no debt list;
    // with no base it fails and names the fix. The publication scan refuses the same phrase in every
    // text a pull request publishes; this keeps new code and docs from carrying it back in.
    { args: ["src/devLint/hostWording.entry.ts"], cmd: bin({ name: "tsx" }), name: "host-wording" },
  ];
}

/**
 * The two registers that live under `$SLOPWEAVER_HOME` rather than in this repository, so both carry
 * {@link LintCheck.offRepoState} and both run in the local `pre-push` lane.
 *
 * Grouped for that shared reason rather than to satisfy the line cap: they are the pair a reader should find
 * together when asking why a gate is still on the developer machine at all. Run order inside
 * {@link claimRatchets} is unchanged, which the plan-order test asserts.
 *
 * @param bin resolves a local JS bin
 * @returns the two home-register checks, in run order
 */
function homeRegisterRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails if the orchestration register rots: a `status:` the parser rejects (so the doc is silently
    // unclassified rather than loudly wrong), a missing `artifact:`, a `blockedBy` naming no doc, or a doc
    // whose every probe passes while it still says `ready` — the LOOK SHIPPED state that is how work lands
    // without the board being told.
    // `offRepoState`: the register lives under `$SLOPWEAVER_HOME`, so CI examines nothing and says so rather
    // than reporting clean — which is exactly why this machine is the only one that can catch the rot.
    // MEASURED: 4.1s (`/usr/bin/time -p yarn slopweaver dev lint --only register-hygiene`).
    {
      args: ["src/devLint/registerHygiene.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "register-hygiene",
      offRepoState: true,
    },
    // Fails if the credential register drifts from what the code and the doc actually say: a `live` row
    // whose declared reader no longer names it, a `retired` row something still reads, or a tokens table in
    // `docs/security/credentials.md` that no longer matches the register cell for cell. Its FOURTH check is
    // `offRepoState` for the same reason `register-hygiene` is — the store lives under `$SLOPWEAVER_HOME`,
    // so "a file in the store nothing declares" is skipped in CI rather than reported clean, and an
    // off-allowlist file gets there by a hand-placement on THIS machine. MEASURED: 3.1s
    // (`/usr/bin/time -p yarn slopweaver dev lint --only secrets-registry`).
    {
      args: ["src/devLint/secretsRegistry.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "secrets-registry",
      offRepoState: true,
    },
  ];
}

/**
 * The ratchets about CLAIMS the repo makes about itself — what its docs assert, what its register says has
 * landed, whether a module the manifest advertises is actually reachable and tested.
 *
 * Grouped apart from {@link sourceShapeRatchets} because these read something OUTSIDE the source they judge: a
 * doc, a manifest, the lint plan itself, the coverage summary, the orchestration board.
 *
 * {@link contractRatchets} runs directly after this and is part of the same group — split off only to stay
 * inside the per-function line ceiling, the same reason {@link docClaimRatchets} was split from
 * {@link bespokeRatchets}. Run order across the two is unchanged, which the plan-order test asserts.
 *
 * @param bin resolves a local JS bin
 * @returns the claim checks, in run order
 */
function claimRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails if current config, script or source still describes a deleted headless model-runner
    // subprocess as live (code-quality round 2 item 1) — see retiredClaudeTransport.ts for the exact
    // banned shapes and the five sites this caught, one of them a live door-coverage allowlist entry.
    {
      args: ["src/devLint/retiredClaudeTransport.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "retired-claude-transport",
    },
    // Fails if a command's front matter cannot do the one job the skill listing needs of it. The listing
    // carries `description` + `when_to_use` and NOTHING else, so a "when to use this" paragraph in the BODY
    // loads only after the command has already been chosen. Measured: 16 of 17 said what the verb is and
    // never when to reach for it, and the 17th spelled its trigger phrases as invalid YAML and rendered
    // anyway. Presence only — it cannot judge whether a phrase is accurate or collides with another command.
    { args: ["src/devLint/commandTrigger.entry.ts"], cmd: bin({ name: "tsx" }), name: "command-trigger" },
    // Fails on one concept named two ways: a CLI noun and a skill (or two of either) differing only by
    // separators, a plural or an abbreviation, or a sidebar page whose address, key and label disagree.
    // The motivating case was `vulnfix` beside `vulnerability-fix`. Rule 11.
    { args: ["src/devLint/namingDoctrine.entry.ts"], cmd: bin({ name: "tsx" }), name: "naming-doctrine" },
    ...homeRegisterRatchets({ bin }),
    // Fails if a command module re-declares verb metadata the manifest already owns. TypeScript rejects
    // only the fresh-object-literal spelling, so a metadata object routed through a variable typechecks
    // clean — measured — and this is the residue proof that the duplicate copy is actually gone.
    { args: ["src/devLint/commandMetaResidue.entry.ts"], cmd: bin({ name: "tsx" }), name: "command-meta-residue" },
    // Fails if a command module the CLI can dispatch has no unit test importing it. Enumerated from the
    // MANIFESTS, not a path glob: the obvious glob missed five real loader targets, two of them the
    // door-routed external-write modules. An import is the floor, not proof of coverage.
    // CI's: 31.1s, second-slowest against a third-slowest of 10.1s — same measurement as `prettier`, and a
    // structural gate whose findings never depend on local state, so a runner sees exactly what this
    // machine would.
    {
      args: ["src/devLint/manifestLoaderTests.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "manifest-loader-tests",
    },
    // Fails if a gate exists in src/devLint but `lintChecks` never runs it. Measured: an unregistered
    // `.entry.ts` left the suite green, knip silent and every gate passing — nothing noticed at all.
    { args: ["src/devLint/gateRegistration.entry.ts"], cmd: bin({ name: "tsx" }), name: "gate-registration" },
    // Fails if the recurring-failure register and the test lanes drift apart: a live class with no
    // `## Bindings` row, a row naming a class no section carries, a named gate/test/fixture that does not
    // resolve, a bound test that never names its class, a fixture declaring a class the register does not
    // carry, or a Survivor row claiming its mechanism already landed. MEASURED by two
    // independent lenses: zero live class names appeared under src/__tests__/ and zero fixture slugs
    // appeared in the register — the two registers were wholly disjoint, both ways.
    { args: ["src/devLint/registerBindings.entry.ts"], cmd: bin({ name: "tsx" }), name: "register-bindings" },
  ];
}

/**
 * The claim ratchets whose subject is a contract held in something that is NOT this repository's TypeScript:
 * the CI workflow files, a verb's own help text, the committed coverage floor, the door seam inventory. Each
 * compares what one of those promises against what the code does, so none of them can be settled by reading
 * a source file alone.
 *
 * The continuation of {@link claimRatchets}, in the same run order — see its note for why the two are
 * separate functions at all.
 *
 * @param bin resolves a local JS bin
 * @returns the contract checks, in run order
 */
function contractRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails if CI's `build` job stops running a lap the local lane deliberately skips. The gate above proves
    // a check is in the PLAN; this one proves the machine that actually runs the plan still does. Without
    // it, one line of ci.yml (`yarn lint` → `yarn lint:local`) leaves the offloaded work running NOWHERE.
    { args: ["src/devLint/ciOffloadContract.entry.ts"], cmd: bin({ name: "tsx" }), name: "ci-offload-contract" },
    // Fails if an AMBIENT heap ceiling comes back anywhere — a workflow env, a package.json script, a
    // shell assignment. NODE_OPTIONS, the old heap workaround, stays off for good, and the
    // tree makes it impossible to bring back. Deleting the one that stood showed CI passing `lint` at the
    // runner default, so nothing needed it at job level. A ceiling on the needing process's own argv is outside the criterion, not excused by it.
    { args: ["src/devLint/ambientHeapCeiling.entry.ts"], cmd: bin({ name: "tsx" }), name: "ambient-heap-ceiling" },
    // Fails if a CI job can run on an event that could not change its verdict. The gate above proves the
    // work still runs; this one proves it does not run for nothing. MEASURED over 49 laps on 20
    // merged pull requests: 29 re-ran byte-identical code, 13m32s per landing, because `edited` and
    // `ready_for_review` fired three jobs when only one read the pull-request body.
    { args: ["src/devLint/ciTriggerContract.entry.ts"], cmd: bin({ name: "tsx" }), name: "ci-trigger-contract" },
    // Fails if a package script runs the TypeScript compiler at V8's own default ceiling. The two gates
    // above prove the CI machine still runs the laps; this one proves one of those laps can run at all.
    // MEASURED: `yarn build` was `tsc -p tsconfig.json` with no ceiling and died
    // at 4,085.3 MB after 61s, and NOTHING ran it — no workflow, no hook, not `yarn validate` — so the only
    // way to find out was to type the command. The check fails closed so that a miss like this cannot recur.
    { args: ["src/devLint/tscHeapContract.entry.ts"], cmd: bin({ name: "tsx" }), name: "tsc-heap-contract" },
    // Fails if a heap ceiling — a package script's, a lint gate's argv, or `HEAP_BUDGET_MIB` — disagrees with
    // `.baselines/heap-ceilings.json`, or rises against the base commit without an appended raise record
    // anchoring the owner's word. The gate above proves a compiler script NAMES a ceiling; this one proves the number
    // never goes up silently.
    { args: ["src/devLint/heapCeilingRatchet.entry.ts"], cmd: bin({ name: "tsx" }), name: "heap-ceiling-ratchet" },
    // Fails if a tracked manifest or lockfile names a TypeScript other than the one pin. The rule
    // for the 7.1 move is pinned exactly, no TS6 anywhere and no dual toolchain; a second compiler arrives
    // as an alias, a compatibility package or a dependant's older resolution, never as a second direct pin.
    { args: ["src/devLint/typescriptPin.entry.ts"], cmd: bin({ name: "tsx" }), name: "typescript-pin" },
    // Fails if a registered hook can run without the envelope. Bounding a hook used to be a convention —
    // `hooks/lib/bounded-run.sh` covered a step a shim chose to bound — and MEASURED: five of
    // the nine registered entries had no shell in front of them at all, so `plugin-mirror-sync.sh` ran to
    // the harness's own 60s timeout with no line saying anything had killed it.
    { args: ["src/devLint/hookBounded.entry.ts"], cmd: bin({ name: "tsx" }), name: "hook-bounded" },
    // Fails if a verb opts out of the help/flag ratchet while its parser reads a declarative spec. The
    // opt-out list carried a PROSE reason nobody read: `slack edit` claimed "no exported flag spec yet"
    // while accepting nine flags and advertising four, which hid `--as me` and `--body` for a month.
    { args: ["src/devLint/helpFlagOptOut.entry.ts"], cmd: bin({ name: "tsx" }), name: "help-flag-opt-out" },
    // Two properties. FLOOR INTEGRITY always runs here — the committed floor exists, parses, and is not
    // lower than at the base commit (CI and `github lap` supply that base; with none it fails, naming the fix).
    // `--summary-only` makes ONLY the measured half lenient, because lint runs before the tests. Measured:
    // this flag used to return 0 before the floor file was opened, so a deleted or corrupted floor passed CI.
    {
      args: ["src/devLint/coverageRatchet.entry.ts", "--summary-only"],
      cmd: bin({ name: "tsx" }),
      name: "coverage-ratchet",
    },
    { args: ["src/cli/index.ts", "dev", "door-coverage"], cmd: bin({ name: "tsx" }), name: "door-coverage" },
    ...refusalRatchets({ bin }),
  ];
}

/**
 * The ratchets about what a door EMITS — the voice of a composed card, and the shape of a refusal.
 *
 * The continuation of {@link contractRatchets}, in the same run order, split off for the reason
 * {@link contractRatchets} was itself split from {@link claimRatchets}: the per-function line ceiling.
 * These three share a subject of their own, which is why the seam falls here — every one of them judges
 * text this repository composes on the way OUT rather than a contract it holds internally.
 *
 * @param bin resolves a local JS bin
 * @returns the refusal-shape checks, in run order
 */
function refusalRatchets({ bin }: { bin: BinResolver }): readonly LintCheck[] {
  return [
    // Fails when prose this repo COMPOSES onto a bot card — never a field a caller filled — breaks the
    // operator's above-the-fold voice rules. The gate above proves a write crosses a door; this one proves
    // what the door was handed was not minted wrong after every schema had passed.
    // `offRepoState`: the VOICE half needs the private `profile.json`, so on a machine without one it says
    // so and exits 0, exactly as `corpus-hygiene` does — this machine is the only place that half can run.
    // Its structural half runs on the full lane too, which is the one CI sees. MEASURED: 2.7s
    // (`/usr/bin/time -p yarn slopweaver dev lint --only derived-card-voice`).
    {
      args: ["src/devLint/derivedCardVoice.entry.ts"],
      cmd: bin({ name: "tsx" }),
      name: "derived-card-voice",
      offRepoState: true,
    },
    // Fails when an escape hatch is undeclared, a door override token is undeclared, or a door refusal is
    // rendered by hand instead of through `admit/doorRefusal.ts` — the three ways to deviate from the one
    // refusal shape the owner ruled on. See `src/hatch/registry.ts`.
    { args: ["src/devLint/escapeHatch.entry.ts"], cmd: bin({ name: "tsx" }), name: "escape-hatch" },
    // Fails when an escape-hatch environment variable is read as a PARAMETER DEFAULT, which any caller
    // passing that argument silently switches off. MEASURED: `cmux spawn` refused a spawn while
    // naming the very variable the operator had already set, because the read sat in a default the verb's
    // own `--force` argument skipped. A hatch that does not open is worse than no hatch.
    { args: ["src/devLint/hatchRelease.entry.ts"], cmd: bin({ name: "tsx" }), name: "hatch-release" },
  ];
}
