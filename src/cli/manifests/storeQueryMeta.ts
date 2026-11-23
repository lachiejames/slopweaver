/**
 * The `store` noun's QUERY metadata — the read-shaped base every verb spreads, and the two verbs that
 * answer a question from the store.
 *
 * Split out of `./store.ts` for the same reason `./storeBackup.ts` and `./storeProjectionMeta.ts` were:
 * the manifest file is wiring, and a meta block is a description. Holding both put that file over the
 * 300-code-line cap the moment `store cite` arrived, which is the seam the cap exists to find.
 */

/** The read-shaped base: no work item, no door, a dry parse that touches nothing. */
export const readMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  parseRejectIsIoFree: true,
} as const;

/** `store read` — the fan-out: one file per reader, plus each reader's instruction. */
export const readMetaFanout = {
  ...readMeta,
  diagnostic: false,
  effect: "local-state",
  example: 'slopweaver store read "why did the staging pool exhaust" --since 2026-09-01T00:00:00Z',
  summary: "Shard the store rows a question selects into one file per reader, and print each reader's instruction",
  usage:
    "usage: slopweaver store read <question> [--search <terms>] [--contains <literal>] [--like <pattern>] [--source <s>] [--kind <k>] [--container <c>] [--author <a>] [--person <name>] [--since <iso>] [--until <iso>] [--visibility <v>] [--thread <native-id>] [--channel <c>] [--repo <o/r>] [--team <t>] [--assignee <a>] [--state <s>] [--limit <n>] [--shard-chars <n>] [--home <dir>] [--json]",
} as const;

/** `store cite` — the same selection, printed with the citation token each record is quoted by. */
export const citeMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: 'slopweaver store cite "auth flow"',
  parseRejectIsIoFree: false,
  summary: "Print the store records a question selects, newest first, each with the citation token it is quoted by",
  usage:
    "usage: slopweaver store cite <question> [--search <terms>] [--contains <literal>] [--like <pattern>] [--source <s>] [--kind <k>] [--container <c>] [--author <a>] [--person <name>] [--since <iso>] [--until <iso>] [--visibility <v>] [--thread <native-id>] [--channel <c>] [--repo <o/r>] [--team <t>] [--assignee <a>] [--state <s>] [--limit <n>] [--home <dir>] [--json]",
} as const;
