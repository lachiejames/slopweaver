/**
 * Lazy manifest for the `dev` noun — repo-development verbs. `build` emits the CLI to JavaScript and proves
 * the emitted entrypoint runs; `gate` is the composed PR gate;
 * `door-coverage` proves no side-effect seam bypasses the door; `door` demonstrates the admit pathway;
 * `manifest` proves a rebuild lost nothing it did not touch; `heap-curve` measures what a whole-corpus pass holds against
 * the corpus on disk and checks the heap guard's coefficients; `dedup-index` measures what the bronze
 * WRITER's dedup index holds and checks its own constant; `capture-conflicts` counts the rows whose winner the
 * capture marker decides; `slice-shape` reads the corpus's own shape so a dev-loop slice is priced rather
 * than guessed; `answer-quality` grades an eval candidate against a frozen golden’s rubric offline, and its
 * `--selftest` half is what `dev gate` runs as its fourth check; `baseline-bump` declares a ratchet rise for its
 * witness; `targeted-tests` runs the unit tests a branch's diff reaches, once, before a local lap. Each loads only
 * when dispatched.
 */
import { DEV_TARGETED_TESTS_USAGE } from "../commands/dev/targetedTestsUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const buildMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare run rebuilds the CLI, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver dev build",
  parseRejectIsIoFree: true,
  summary: "Emit the CLI to JavaScript with esbuild, then prove the emitted entrypoint runs",
  usage: "usage: slopweaver dev build [--out <dir>] [--json]",
} as const;

const gateMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver dev gate --pr-body-file pr.md",
  parseRejectIsIoFree: false,
  summary: "Run the PR gate: hygiene + PR-format + evidence-handoff + answer-quality (single non-zero exit + a ledger)",
  usage: "usage: slopweaver dev gate [--home <dir>] [--pr-body-file <path>]",
} as const;

const doorCoverageMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver dev door-coverage --json",
  parseRejectIsIoFree: true,
  summary: "Prove every side-effect seam is routed through the door (or an acknowledged local-state seam)",
  usage: "usage: slopweaver dev door-coverage [--json]",
} as const;

const lintMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver dev lint --only jsdoc-tags",
  parseRejectIsIoFree: true,
  summary:
    "Run the static-analysis bar (prettier + oxlint + knip + constraints + hygiene + the bespoke ratchets + door-coverage); --lane local runs only what CI cannot see, --lane seat is what a seat runs before handback (its own merge-base, changed-file oxlint, every whole-project gate named as not covered), --only narrows the run to named gates",
  usage: "usage: slopweaver dev lint [--lane full|local|seat] [--only <gate>[,<gate>...]]",
} as const;

const doorMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver dev door --simulate warn",
  parseRejectIsIoFree: false,
  summary:
    'Exercise the admit door: --simulate warn|pass|hold, --raw "<cmd>" to test the raw-tool block, or ' +
    "--refusals to read what a gate stopped before the door",
  usage:
    'usage: slopweaver dev door (--simulate warn|pass|hold | --raw "<command>" | --refusals [--limit <n>]) ' +
    "[--home <dir>]",
} as const;

const manifestMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // A bare run reads the corpus and prints its cross-source shape, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver dev manifest --compare before.json",
  parseRejectIsIoFree: true,
  summary: "Snapshot the corpus's cross-source shape, or prove a rebuild lost nothing it did not touch",
  usage:
    "usage: slopweaver dev manifest [--out <path>] [--compare <path>] [--numbers-only] [--home <dir>] " +
    "[--corpus <dir>]",
} as const;

const heapCurveMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // A bare run reads the corpus on disk and measures the heap against it, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver dev heap-curve --corpus ~/.slopweaver/corpus/bronze/slack",
  parseRejectIsIoFree: true,
  summary:
    "Measure what a whole-corpus pass holds — post-GC live heap vs the corpus on disk — and check the heap guard's coefficient",
  usage:
    "usage: slopweaver dev heap-curve [--corpus <dir>] [--projection bronze|retrieval|derive] [--home <dir>] [--json]",
} as const;

const profileMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver dev profile --gate named-object-params --cpu",
  // An unknown gate or lane is refused only after a git read.
  parseRejectIsIoFree: false,
  summary:
    "Profile a gate, a test lane or any verb: post-GC heap by phase, self CPU and sampled allocation by module, against a recorded baseline",
  usage:
    "usage: slopweaver dev profile (--gate <name> | --lane unit|subprocess|integration | --verb -- <argv...>) [--cpu] [--heap-prof] [--record] [--check] [--top <n>] [--interval <us>] [--json]",
} as const;

const dedupIndexMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver dev dedup-index --source slack",
  parseRejectIsIoFree: true,
  summary:
    "Measure what the bronze writer's dedup index holds — post-GC live heap per stored row — and check the writer's own constant",
  usage: "usage: slopweaver dev dedup-index --source <source> [--home <dir>] [--json]",
} as const;

const captureConflictsMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver dev capture-conflicts --source notion",
  parseRejectIsIoFree: true,
  summary:
    "Count the entities holding both a capture that declares itself partial and a complete one at the same instant and text — the rows latestRecords' marker tie-break decides",
  usage: "usage: slopweaver dev capture-conflicts --source <source> [--home <dir>] [--json]",
} as const;

const baselineBumpMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare run is a usage error (--reason is required), so it never writes a record unasked.
  dryParseSafe: true,
  effect: "local-state",
  example: 'slopweaver dev baseline-bump --reason "the cap now reads tools/, which main already had"',
  parseRejectIsIoFree: true,
  requiresApproval: false,
  summary:
    "Declare what HEAD loosens in a ratchet baseline against main as a write-once bump record in the state home, and print the Codex review that must witness it before the landing verbs will",
  usage: 'usage: slopweaver dev baseline-bump --reason "<why>" [--base <sha>] [--cwd <dir>] [--home <dir>] [--dry-run]',
} as const;

const sliceShapeMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // A bare run streams the whole bronze corpus and prints its shape, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver dev slice-shape --top 30",
  parseRejectIsIoFree: true,
  requiresApproval: false,
  summary:
    "One streaming pass over bronze emitting the four numbers a dev-loop slice is priced on — a month histogram, the per-source counts a cap survives, the per-thread size distribution and the per-container tally",
  usage: "usage: slopweaver dev slice-shape [--home <dir>] [--corpus <dir>] [--top N] [--json]",
} as const;

const answerQualityMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver dev answer-quality --cases eval/answer-quality.fixture.json --selftest",
  parseRejectIsIoFree: true,
  requiresApproval: false,
  summary:
    "Grade an eval candidate answer against a frozen golden's rubric — the claims, caveats and source attributions it carries, never its wording — or --selftest the ordering properties that prove the scorer ignores token overlap, optionally publishing that run per case as a redacted --artifact. Offline and deterministic; grading gates nothing, while the selftest is `dev gate`'s answer-quality check",
  usage:
    "usage: slopweaver dev answer-quality --cases <path> (--candidates <path> | --selftest) [--artifact <path>] [--json]",
} as const;

const drizzleRebaseMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare run rewrites the migrations, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver dev drizzle-rebase --dry-run",
  parseRejectIsIoFree: true,
  requiresApproval: false,
  summary:
    "Discard the migrations a merge left out of order in drizzle's journal, so `slopweaver store push` can emit one that is in order",
  usage: "usage: slopweaver dev drizzle-rebase [--dry-run] [--migrations <dir>]",
} as const;

const targetedTestsMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // A bare run plans and runs the targeted tests, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver dev targeted-tests --dry-run",
  parseRejectIsIoFree: true,
  requiresApproval: false,
  summary:
    "Before a local lap, run once the unit tests this branch's diff reaches — changed tests, direct importers, the mirrored unit directory and a fixed registry sweep — plus each touched nested project's tsc --noEmit, naming everything left to the lap",
  usage: DEV_TARGETED_TESTS_USAGE,
} as const;

const loadAnswerQuality = () => import("../commands/dev/answerQuality.js").then((m) => m.devAnswerQualityCommand);
const loadBuild = () => import("../commands/dev/build.js").then((m) => m.devBuildCommand);
const loadGate = () => import("../commands/dev/run.js").then((m) => m.devGateCommand);
const loadDoorCoverage = () => import("../commands/dev/doorCoverage.js").then((m) => m.doorCoverageCommand);
const loadDoor = () => import("../commands/dev/door.js").then((m) => m.doorCommand);
const loadLint = () => import("../commands/dev/lint.js").then((m) => m.devLintCommand);
const loadManifest = () => import("../commands/dev/manifest.js").then((m) => m.devManifestCommand);
const loadHeapCurve = () => import("../commands/dev/heapCurve.js").then((m) => m.devHeapCurveCommand);
const loadProfile = () => import("../commands/dev/profile.js").then((m) => m.devProfileCommand);
const loadDrizzleRebase = () => import("../commands/dev/drizzleRebase.js").then((m) => m.devDrizzleRebaseCommand);
const loadDedupIndex = () => import("../commands/dev/dedupIndex.js").then((m) => m.devDedupIndexCommand);
const loadBaselineBump = () => import("../commands/dev/baselineBump.js").then((m) => m.devBaselineBumpCommand);
const loadSliceShape = () => import("../commands/dev/sliceShape.js").then((m) => m.devSliceShapeCommand);
const loadTargetedTests = () => import("../commands/dev/targetedTests.js").then((m) => m.devTargetedTestsCommand);
const loadCaptureConflicts = () =>
  import("../commands/dev/captureConflicts.js").then((m) => m.devCaptureConflictsCommand);

export const devManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "answer-quality": lazy({ load: loadAnswerQuality, meta: answerQualityMeta }),
  "baseline-bump": lazy({ load: loadBaselineBump, meta: baselineBumpMeta }),
  "capture-conflicts": lazy({ load: loadCaptureConflicts, meta: captureConflictsMeta }),
  "dedup-index": lazy({ load: loadDedupIndex, meta: dedupIndexMeta }),
  door: lazy({ load: loadDoor, meta: doorMeta }),
  "door-coverage": lazy({ load: loadDoorCoverage, meta: doorCoverageMeta }),
  "drizzle-rebase": lazy({ load: loadDrizzleRebase, meta: drizzleRebaseMeta }),
  build: lazy({ load: loadBuild, meta: buildMeta }),
  gate: lazy({ load: loadGate, meta: gateMeta }),
  "heap-curve": lazy({ load: loadHeapCurve, meta: heapCurveMeta }),
  lint: lazy({ load: loadLint, meta: lintMeta }),
  manifest: lazy({ load: loadManifest, meta: manifestMeta }),
  profile: lazy({ load: loadProfile, meta: profileMeta }),
  "slice-shape": lazy({ load: loadSliceShape, meta: sliceShapeMeta }),
  "targeted-tests": lazy({ load: loadTargetedTests, meta: targetedTestsMeta }),
};
