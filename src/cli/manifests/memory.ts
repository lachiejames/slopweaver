/**
 * Lazy manifest for the `memory` noun. Metadata only — the command module loads when a verb is dispatched, so
 * neither the YAML parser nor the corpus reader is imported by an unrelated invocation.
 *
 * No default verb: `slopweaver memory` on its own has no obvious meaning, and guessing one would make a bare
 * noun do filesystem work.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const checkMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // `--dir` is required: `requiredDir` refuses a bare run, `--help` and an unknown flag with usage before `readMemoryCorpus` reads anything.
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver memory check --dir ~/.claude/projects/<project>/memory",
  parseRejectIsIoFree: true,
  summary: "Check a Claude Code auto-memory corpus for routing, schema, link and placement defects",
  usage: "usage: slopweaver memory check --dir <path> [--json]",
} as const;

const sweepMeta = {
  createsWorkItem: false,
  // Its non-zero exit REPORTS something ("nothing here to lay out"), it never signals a broken tool.
  diagnostic: true,
  doorRouted: false,
  // `--dir` is required: `requiredDir` (and a malformed `--stale-after`) refuse before `readMemoryCorpus` reads anything.
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver memory sweep --dir ~/.claude/projects/<project>/memory --stale-after 90",
  parseRejectIsIoFree: true,
  summary: "Lay every memory out for triage — description, routing, inbound links and a source-labelled age",
  usage: "usage: slopweaver memory sweep --dir <path> [--json] [--stale-after <days>]",
} as const;

const hookMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // `hookDirectory` wants `--dir` or `--from-payload`: a bare run, `--help` and an unknown flag print usage before `memoryHookOutput` reads stdin.
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver memory hook --from-payload",
  parseRejectIsIoFree: true,
  summary: "Check memory writes and sync explicit current-owner rulings as hook context (always exits 0)",
  usage: "usage: slopweaver memory hook (--dir <path> | --from-payload)",
} as const;

const hygieneMeta = {
  createsWorkItem: false,
  // Its non-zero exits REPORT something — nothing to propose (3), a corpus mid-save (4) — never a broken tool.
  diagnostic: true,
  doorRouted: false,
  // `--dir` and `--repo` are required: `hygieneSettings` (and a malformed `--now`) refuse before `corpusSettled` or any read runs.
  dryParseSafe: true,
  effect: "local-state",
  example: 'slopweaver memory hygiene --dir ~/.claude/projects/<project>/memory --repo "$PWD"',
  parseRejectIsIoFree: true,
  summary:
    "Propose keep/adjust/drop over the memory corpus and the knowledge rows — never edits one; writes a dated report and ledger rows",
  usage:
    "usage: slopweaver memory hygiene --dir <path> --repo <path> [--also-repo <path>] [--json] [--now <iso>] [--home <path>]",
} as const;

const gradeMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // `<id> <accepted|refused> --why` are required: `gradeAnswer` refuses a bare run and an unknown flag before `readHygieneLedgerRows` reads the ledger.
  dryParseSafe: true,
  effect: "local-state",
  example: 'slopweaver memory grade 3f2a91c04b7d refused --why "the ruling date is the point"',
  parseRejectIsIoFree: true,
  summary: "Record the owner's answer to one hygiene proposal — a refusal is terminal",
  usage: "usage: slopweaver memory grade <id> <accepted|refused> --why <text> [--home <path>]",
} as const;

const gateMeta = {
  createsWorkItem: false,
  // Its non-zero exit REPORTS a standing corpus defect; it never signals a broken tool.
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver memory gate --install",
  parseRejectIsIoFree: true,
  summary: "Refuse a NEW defect in any auto-memory corpus on this machine, and install the pre-push hook that runs it",
  usage: "usage: slopweaver memory gate [--install] [--accept] [--json]",
} as const;

const passesMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver memory passes --json",
  parseRejectIsIoFree: true,
  summary: "When the memory hygiene pass last ran, and how stale that is — reads the ledger, proposes nothing",
  usage: "usage: slopweaver memory passes [--home <dir>] [--json]",
} as const;

const overlapsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // `--dir` and `--repo` are required: `resolvePaths` refuses a bare run and an unknown flag before `readMemoryCorpus` reads anything.
  dryParseSafe: true,
  effect: "none",
  example: 'slopweaver memory overlaps --dir ~/.claude/projects/<project>/memory --repo "$PWD"',
  parseRejectIsIoFree: true,
  summary: "What the write gate would ask every memory to answer — the memories and canon sections it overlaps",
  usage: "usage: slopweaver memory overlaps --dir <path> --repo <path> [--json]",
} as const;

export const memoryManifest: Readonly<Record<string, VerbManifestEntry>> = {
  check: lazy({ load: () => import("../commands/memory/run.js").then((m) => m.memoryCheckCommand), meta: checkMeta }),
  gate: lazy({ load: () => import("../commands/memory/gateRun.js").then((m) => m.memoryGateCommand), meta: gateMeta }),
  grade: lazy({
    load: () => import("../commands/memory/hygiene.js").then((m) => m.memoryGradeCommand),
    meta: gradeMeta,
  }),
  hook: lazy({ load: () => import("../commands/memory/run.js").then((m) => m.memoryHookCommand), meta: hookMeta }),
  hygiene: lazy({
    load: () => import("../commands/memory/hygiene.js").then((m) => m.memoryHygieneCommand),
    meta: hygieneMeta,
  }),
  overlaps: lazy({
    load: () => import("../commands/memory/overlapsRun.js").then((m) => m.memoryOverlapsCommand),
    meta: overlapsMeta,
  }),
  passes: lazy({
    load: () => import("../commands/memory/passesRun.js").then((m) => m.memoryPassesCommand),
    meta: passesMeta,
  }),
  sweep: lazy({ load: () => import("../commands/memory/run.js").then((m) => m.memorySweepCommand), meta: sweepMeta }),
};
