/**
 * `slopweaver queue` — the pure half: the usage strings, the flag specs, and the renderers that turn folded
 * queue items into the lines an operator reads.
 *
 * A queue nobody can drain is worse than no queue: it converts a silence somebody can see into one nobody
 * can. So the reading surface is as much of this feature as the withholding is, and it is pure so that what
 * it prints can be asserted to the character.
 */
import { type QueueItem, recordedAskIdentityForHeld } from "../../../admit/queue.js";
import type { Result } from "../../../lib/result.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";

export const QUEUE_LIST_USAGE =
  "usage: slopweaver queue list [--all] [--json] [--home <dir>]\n" +
  "  The replies the door held rather than sent. Held entries only, unless --all.";

export const QUEUE_SHOW_USAGE =
  "usage: slopweaver queue show <id> [--json] [--home <dir>]\n" +
  "  The whole held entry: who asked, what they asked, why it was held, and the draft itself.";

export const QUEUE_RELEASE_USAGE =
  "usage: slopweaver queue release <id> [--form <json|->] [--dry-run] [--note <text>] [--home <dir>]\n" +
  "  THE BREAK-GLASS. Posts the held draft to the thread it was bound for, through the door, with\n" +
  "  SLOPWEAVER_DOOR_OVERRIDE set so the release is recorded as a waived withhold rather than a silent send.\n" +
  "  --form     release a DIFFERENT form instead of the stored draft — this is how a held draft is edited.\n" +
  "             `-` reads it from stdin, which is the spelling to use for prose. The substitution is\n" +
  "             recorded on the release event, so the queue never claims the draft went out unchanged.\n" +
  "  --dry-run  validate and render the draft, print what would be posted, and send nothing.";

export const QUEUE_DROP_USAGE =
  "usage: slopweaver queue drop <id> [--note <text>] [--home <dir>]\n" +
  "  Resolve a held entry WITHOUT sending it. The draft stays in the log; only its state changes.";

/** The flags each verb accepts; the repo's `--help`-truth ratchet reads `QUEUE_FLAG_NAMES`, derived from them. */
const QUEUE_LIST_FLAG_SPEC = { boolean: ["all", "json"], string: ["home"] } as const;
const QUEUE_SHOW_FLAG_SPEC = { boolean: ["json"], string: ["home"] } as const;
const QUEUE_RELEASE_FLAG_SPEC = { boolean: ["dry-run"], string: ["form", "home", "note"] } as const;
const QUEUE_DROP_FLAG_SPEC = { boolean: [], string: ["home", "note"] } as const;

/** Every verb's spec, keyed by verb — the one table both the runner and the help-truth ratchet read. */
const QUEUE_FLAG_SPECS = {
  drop: QUEUE_DROP_FLAG_SPEC,
  list: QUEUE_LIST_FLAG_SPEC,
  release: QUEUE_RELEASE_FLAG_SPEC,
  show: QUEUE_SHOW_FLAG_SPEC,
} satisfies Readonly<Record<string, { readonly boolean: readonly string[]; readonly string: readonly string[] }>>;

/** A queue verb that parses its tail through {@link parseQueueArgs}. */
export type QueueVerb = keyof typeof QUEUE_FLAG_SPECS;

/**
 * Parse one verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * Positionals are allowed for every verb, including `list`, which takes none: `list` refusing a stray word
 * with "unexpected positional" instead of ignoring it is a nicety this parser does not owe, and the verb
 * itself reads only the flags.
 *
 * @param rest the argv tail after `queue <verb>`
 * @param verb which verb's spec to parse against
 * @returns the parsed flags, or the rejections
 */
export function parseQueueArgs({ rest, verb }: { rest: readonly string[]; verb: QueueVerb }): Result<ParsedFlags> {
  const spec = QUEUE_FLAG_SPECS[verb];
  return parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: [...spec.boolean], string: [...spec.string] },
  });
}

/** How much of a question fits on a list row before the row starts wrapping in a normal terminal. */
const QUESTION_COLUMN = 56;

/** Shorten to a column width, marking that it happened. Pure. */
function fit({ text, width }: { text: string; width: number }): string {
  const oneLine = text.replaceAll(/\s+/g, " ").trim();
  return oneLine.length <= width ? oneLine : `${oneLine.slice(0, width - 1)}…`;
}

/**
 * One list row: id, state, when, who asked, and the question.
 *
 * The REASON is deliberately not on this row and is not an oversight. A reason is a sentence, it is the thing
 * the owner has to actually read, and squeezing it into a column would train them to skim past the one field
 * the whole mechanism exists to produce. `queue show` prints it whole.
 *
 * @param item the folded queue entry
 * @returns the row, as one line
 */
export function queueListRow({ item }: { item: QueueItem }): string {
  return [
    item.id.padEnd(10),
    item.state.padEnd(8),
    item.tsIso,
    item.held.askedBy.padEnd(12),
    fit({ text: item.held.question, width: QUESTION_COLUMN }),
  ].join("  ");
}

/**
 * The whole list, with a header and a footer that names what was filtered out.
 *
 * The footer is not decoration: a list showing three held entries out of forty resolved ones looks identical
 * to a list of a three-entry queue, and an operator who does not know the difference cannot tell a drained
 * queue from a filtered view of a full one.
 *
 * @param items the folded entries, newest first
 * @param showResolved whether released and dropped entries were included
 * @returns the lines to print, in order
 */
export function queueListLines({
  items,
  showResolved,
}: {
  items: readonly QueueItem[];
  showResolved: boolean;
}): readonly string[] {
  const shown = showResolved ? items : items.filter((item) => item.state === "held");
  const hidden = items.length - shown.length;
  if (shown.length === 0) {
    return [
      hidden === 0
        ? "nothing has been withheld — the queue is empty"
        : `nothing is held (${String(hidden)} resolved entr${hidden === 1 ? "y" : "ies"} — see --all)`,
    ];
  }
  return [
    ...shown.map((item) => queueListRow({ item })),
    "",
    `${String(shown.length)} shown` + (hidden === 0 ? "" : `, ${String(hidden)} resolved and hidden (--all)`),
  ];
}

/** A resolution's note, spelled out when there was none rather than rendered as an empty gap. */
function noteOf({ item }: { item: QueueItem }): string {
  return item.note === undefined || item.note.length === 0 ? "(no note recorded)" : item.note;
}

/**
 * One entry in full — everything needed to decide whether to send it.
 *
 * The draft is printed as JSON rather than prettified prose. It is a typed form, the release path validates
 * it against the renderer's schema, and a prose rendering here would be a SECOND renderer whose output could
 * drift from what would actually be posted — which is precisely the question the reader is trying to answer.
 *
 * @param item the folded queue entry
 * @returns the lines to print, in order
 */
export function queueShowLines({ item }: { item: QueueItem }): readonly string[] {
  const recorded = recordedAskIdentityForHeld({ held: item.held });
  return [
    `${item.id}  [${item.state}]  held ${item.tsIso}`,
    `  asked by:  ${item.held.askedBy}`,
    `  bound for: ${item.held.channel} thread ${item.held.threadTs} (${item.held.surface})`,
    recorded.quality === "exact"
      ? `  addressed: ${recorded.messageTs}`
      : "  addressed: thread only — addressing message timestamp was not recorded",
    `  question:  ${item.held.question}`,
    `  held by:   ${item.held.code}`,
    `  because:   ${item.held.reason}`,
    ...(item.resolvedIso === undefined ? [] : [`  resolved:  ${item.state} ${item.resolvedIso} — ${noteOf({ item })}`]),
    "  draft:",
    ...JSON.stringify(item.held.draft, null, 2)
      .split("\n")
      .map((line) => `    ${line}`),
  ];
}

/** The `--`-prefixed tokens one spec accepts, in the order the specs list them. */
function flagNames({ spec }: { spec: { readonly boolean: readonly string[]; readonly string: readonly string[] } }) {
  return [...spec.string.map((name) => `--${name}`), ...spec.boolean.map((name) => `--${name}`)];
}

/**
 * Every flag each verb accepts, keyed by verb.
 *
 * Exported for the repo-wide `--help`-truth ratchet, which compares this against the usage strings above in
 * BOTH directions. `refresh --help` once hid ten shipped flags; a spec the ratchet can read is what stops
 * that recurring, and a new noun that skips it is a new place for it to recur.
 */
export const QUEUE_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = {
  drop: flagNames({ spec: QUEUE_DROP_FLAG_SPEC }),
  list: flagNames({ spec: QUEUE_LIST_FLAG_SPEC }),
  release: flagNames({ spec: QUEUE_RELEASE_FLAG_SPEC }),
  show: flagNames({ spec: QUEUE_SHOW_FLAG_SPEC }),
};
