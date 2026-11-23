/*
 * The `store` noun's TRANSFER family: an export of the installation's owned state, the import that reads one
 * back, stages it and applies it, and the two verbs that answer and list the questions a staged import raised.
 * Metadata only — no handlers, no imports — beside `storeBackup.ts`, which moves the whole store somewhere else
 * rather than the typed state an installation owns.
 *
 * `import` is `local-state`: it reads a directory outside `$SLOPWEAVER_HOME`, with `--approve` it writes the
 * staged batch into the local store, and with `--apply` it writes that batch into the live registers there.
 * `import-resolve` writes one answer there; `import-questions` reads.
 */

export const exportMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store export --out ~/slopweaver-export-2026-10-31",
  parseRejectIsIoFree: true,
  summary:
    "Write the installation's owned state — memories, owner profile, directives, standing asks, steers — to a manifested directory",
  usage: "usage: slopweaver store export --out <dir> [--home <dir>] [--json]",
} as const;

export const importMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store import --from ~/slopweaver-export-2026-10-31",
  parseRejectIsIoFree: true,
  summary:
    "Check a store export and plan it against the live store with every question it raises; --approve stages it, --apply writes a staged batch in one transaction",
  usage:
    "usage: slopweaver store import --from <dir> [--approve <sha256:digest>] [--unmanifested] [--home <dir>] [--json] | --apply <batch-id> [--stop-on-conflict] [--home <dir>] [--json]",
} as const;

export const importResolveMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store import-resolve --question import-q-0123456789abcdef --action leave-inactive",
  parseRejectIsIoFree: true,
  summary: "Record the owner's one answer to a staged import question; an answer is never changed",
  usage: "usage: slopweaver store import-resolve --question <import-q-id> --action <answer> [--home <dir>] [--json]",
} as const;

export const importQuestionsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver store import-questions --json",
  parseRejectIsIoFree: true,
  summary: "List every staged import question still waiting for an answer, with the answers each takes",
  usage: "usage: slopweaver store import-questions [--home <dir>] [--json]",
} as const;
