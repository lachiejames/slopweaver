/**
 * Flag specs, usage text and the shared parse for the `reading` noun. Pure: no I/O, no clock.
 *
 * Kept apart from the three verb modules so the help-truth ratchet can read a flag list without importing a
 * command, exactly as `../autonomy/core.ts` does.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `reading`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

/** The producer every page reads for the pull-request page — the verb's name, not its flags. */
export const LANDING_PRODUCER = "github landing";

const RECORD_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["producer", "from", "by", "observed-at", "home"],
};

const LAST_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["producer", "home"],
};

const LIST_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["producer", "home"],
};

/** `--`-prefixed flags, for the help-truth ratchet. */
function names({ spec: { string: strings = [], boolean: booleans = [] } }: { spec: FlagSpec }): readonly string[] {
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

export const READING_RECORD_FLAG_NAMES: readonly string[] = names({ spec: RECORD_FLAGS });
export const READING_LAST_FLAG_NAMES: readonly string[] = names({ spec: LAST_FLAGS });
export const READING_LIST_FLAG_NAMES: readonly string[] = names({ spec: LIST_FLAGS });

export const RECORD_USAGE =
  "usage: slopweaver reading record --producer <verb line> --from <file> --by <who> [--observed-at <iso>]\n" +
  "                                 [--home <dir>] [--json]\n" +
  "  Append one verb's printed --json document to the readings ledger: the bytes of <file> are kept as the\n" +
  "  producer printed them, under readings/<producer slug>/, and one index row says who took the reading\n" +
  "  and when it was true. --observed-at defaults to the document's own top-level observedAtIso when it\n" +
  "  carries one, else to now — and the receipt says which.\n" +
  "  --producer <verb line>  the verb, as a caller types it: `github landing`, never a slug\n" +
  "  --from <file>           the file the verb's --json was redirected to; `-` reads stdin\n" +
  "  --by <who>              who took it: a tick label, a session id, `sync-now`\n" +
  "\n" +
  'example: slopweaver github landing --author @me --json --include-drafts > /tmp/landing.json && slopweaver reading record --producer "github landing" --from /tmp/landing.json --by tick-12';

export const LAST_USAGE =
  "usage: slopweaver reading last --producer <verb line> [--home <dir>] [--json]\n" +
  "  The latest reading one producer recorded, with its document. --json prints ONE object — readingId,\n" +
  "  producer, by, observedAtIso, recordedAtIso, bytes, document — with observedAtIso at the top so a\n" +
  "  console tile can stamp the reading with the instant it was true. Exits 3 when the ledger holds no\n" +
  "  reading by that producer, which is a fact a page shows, never an empty document.\n" +
  "\n" +
  'example: slopweaver reading last --producer "github landing" --json';

export const LIST_USAGE =
  "usage: slopweaver reading list [--producer <verb line>] [--home <dir>] [--json]\n" +
  "  Every reading the ledger holds, oldest first, one line each: when it was recorded, by whom, the\n" +
  "  producer, the bytes. --json prints one index row per line.\n" +
  "\n" +
  "example: slopweaver reading list";

/**
 * Parse `reading record`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseReadingRecordArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RECORD_FLAGS });
}

/**
 * Parse `reading last`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseReadingLastArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LAST_FLAGS });
}

/**
 * Parse `reading list`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseReadingListArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}

/**
 * A flag's value, or undefined when it was not supplied.
 *
 * @param values the parsed flag values
 * @param name the flag, without its `--`
 * @returns the string, or `undefined`
 */
export function flag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The instant a document says it was true, when it carries one at the top level.
 *
 * @param document the parsed document
 * @returns its `observedAtIso`, or `undefined` when it publishes none
 */
export function documentObservedAt({ document }: { document: unknown }): string | undefined {
  if (typeof document !== "object" || document === null || !("observedAtIso" in document)) {
    return undefined;
  }
  const declared: unknown = document.observedAtIso;
  return typeof declared === "string" ? declared : undefined;
}
