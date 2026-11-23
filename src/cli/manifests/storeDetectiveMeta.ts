/**
 * The `store` noun's DETECTIVE metadata — the progressive-disclosure ladder a detective climbs, and the
 * `detect` verb that sizes a wave of them.
 *
 * Split out of `./store.ts` for the reason `./storeQueryMeta.ts` gives: the manifest file is wiring, and a
 * meta block is a description. The ladder's search rungs gaining their human-only scope put that
 * file over the 300-code-line cap, which is the seam the cap exists to find.
 */
import { OPEN_USAGE, PEEK_USAGE } from "../commands/store/probeUsage.js";

import { readMeta } from "./storeQueryMeta.js";

/** `store probe` — the first rung: every keyword across every shape, counted. */
export const probeMeta = {
  ...readMeta,
  example: 'slopweaver store probe "17000" barten --source github',
  summary:
    "Fan every keyword across the seven search shapes over the whole store and report the counts, the source split and the ids of anything narrow — human-authored rows only unless --include-bots",
  usage:
    "usage: slopweaver store probe <keyword> [<keyword> ...] [--regex <pattern>] [--source <s>] [--enumerate-at-or-below <n>] [--ids <n>] [--include-bots|--exclude-bots] [--json]",
} as const;

/** `store groups` — where one shape's wide count actually lives. */
export const groupsMeta = {
  ...readMeta,
  example: "slopweaver store groups --term datadog --shape wild-both --facet container",
  summary:
    "Split one search shape's hits by container, author, source or kind — where a wide count actually lives; human-authored rows only unless --include-bots",
  usage:
    "usage: slopweaver store groups --term <t> --shape <s> --facet source|kind|container|author [--limit <n>] [--include-bots|--exclude-bots] [--json]",
} as const;

/** `store hits` — one page of the records one shape selected. */
export const hitsMeta = {
  ...readMeta,
  example: "slopweaver store hits --term barten --shape exact --limit 10",
  summary:
    "List one page of the records one search shape selected, newest first; human-authored only unless --include-bots",
  usage:
    "usage: slopweaver store hits --term <t> --shape <s> [--source <s>] [--limit <n>] [--offset <n>] [--include-bots|--exclude-bots] [--json]",
} as const;

/** `store peek` — a window centred on the match, enough to discard a record unopened. */
export const peekMeta = {
  ...readMeta,
  example: "slopweaver store peek --id 16ab6aec-e951-4682-8b9f-d4425b3816c8 --match 17000",
  summary: "Show a window of each named record CENTRED ON THE MATCH — enough to discard one without opening it",
  usage: PEEK_USAGE,
} as const;

/** `store open` — each named record whole. */
export const openMeta = {
  ...readMeta,
  example: "slopweaver store open --id 16ab6aec-e951-4682-8b9f-d4425b3816c8",
  summary: "Print each named record whole, with the URLs its own text linked to",
  usage: OPEN_USAGE,
} as const;

/** `store around` — one message the way a person sees Slack. */
export const aroundMeta = {
  ...readMeta,
  example: "slopweaver store around --id https://acme.slack.com/archives/C0SYN4E1234567/p1789717308365179",
  summary:
    "See one message the way a person sees Slack — the whole thread it sits in AND the top-level channel messages before and after that thread, each with its reply count, never re-filtered by the term that found it",
  usage:
    "usage: slopweaver store around --id <uuid | <channel>:<ts> | slack link> [--mode conversation|thread|container] [--before <n>] [--after <n>] [--chars <n>] [--json]\n" +
    "  --id takes what you already have: a record uuid, a Slack <channel>:<ts> id, or a message link.\n" +
    "  conversation (default) is both bands — scroll out of a thread and see the nearby conversation.\n" +
    "  thread is that thread alone; container is every row in the place in time order, replies interleaved.",
} as const;

/** `store detect` — probe for a question, then size and brief the detective wave. */
export const detectMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example:
    'slopweaver store detect "what are Tobyn Barten\'s pain points" --term "care plan" --name barten --variant barton',
  parseRejectIsIoFree: true,
  summary:
    "Probe the store for a question, then say how many Haiku detectives to fan out and write the brief each one starts on",
  usage:
    "usage: slopweaver store detect <question> --term <t> [--term <t> ...] [--name <n> --variant <v> ...] [--slots <n>] [--recalled <line>] [--ask <channel>/<messageTs> | --out <dir>] [--json]",
} as const;
