/**
 * Flag specs, usage text and the shared parse for the `autonomy` noun. Pure: no I/O, no clock.
 *
 * Kept apart from the three verb modules so the help-truth ratchet can read a flag list without importing a
 * command, exactly as `../knowledge/core.ts` and `../grant/core.ts` do.
 */
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `autonomy`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

const RECORD_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["action-id", "kind", "subject", "done-iso", "by-session", "why", "said", "witness", "run", "steer", "home"],
};

const LIST_FLAGS: FlagSpec = {
  boolean: ["json", "unsteered"],
  string: ["kind", "by-session", "since", "home"],
};

const STEER_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["steer", "by-session", "home"],
};

const STEER_CLASS_FLAGS = {
  boolean: ["json"],
  string: ["kinds", "steer", "anchor", "subject-prefix", "by-session", "home"],
} satisfies FlagSpec;

const ADOPT_FLAGS: FlagSpec = {
  boolean: ["json", "apply"],
  string: ["home"],
};

const QUALIFY_FLAGS: FlagSpec = {
  boolean: ["apply"],
  string: ["repo", "home"],
};

/** `--`-prefixed qualify flags, for the help-truth ratchet. */
export const AUTONOMY_QUALIFY_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: QUALIFY_FLAGS }),
  ...booleanFlagsOf({ spec: QUALIFY_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `autonomy qualify`'s flags. The act's id is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseAutonomyQualifyArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: QUALIFY_FLAGS });
}

/** What `autonomy qualify --help` prints. */
export const QUALIFY_USAGE =
  "usage: slopweaver autonomy qualify <actionId> --repo <owner/repo> [--apply] [--home <dir>]\n" +
  "\n" +
  "Writes one stored act's bare GitHub references in its why and said as owner/repo#N, so the\n" +
  "briefing stops refusing the page they sit on. Reports and writes NOTHING unless you pass --apply.\n" +
  "\n" +
  "  --repo     the repository those references belong to — required, never guessed\n" +
  "  --apply    write the revision in place. Each changed field's original is quoted in the act's own\n" +
  "             witness; refused if the act changed since it was read, if nothing is bare, or if a\n" +
  "             reference would still render as text";

/** `--`-prefixed record flags, for the help-truth ratchet. */
export const AUTONOMY_RECORD_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: RECORD_FLAGS }),
  ...booleanFlagsOf({ spec: RECORD_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed list flags, for the help-truth ratchet. */
export const AUTONOMY_LIST_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LIST_FLAGS }),
  ...booleanFlagsOf({ spec: LIST_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed steer flags, for the help-truth ratchet. */
export const AUTONOMY_STEER_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: STEER_FLAGS }),
  ...booleanFlagsOf({ spec: STEER_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed steer-class flags, for the help-truth ratchet. */
export const AUTONOMY_STEER_CLASS_FLAG_NAMES: readonly string[] = [
  ...STEER_CLASS_FLAGS.string,
  ...STEER_CLASS_FLAGS.boolean,
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed adopt flags, for the help-truth ratchet. */
export const AUTONOMY_ADOPT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: ADOPT_FLAGS }),
  ...booleanFlagsOf({ spec: ADOPT_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `autonomy record`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseAutonomyRecordArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RECORD_FLAGS });
}

/**
 * Parse `autonomy list`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseAutonomyListArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}

/**
 * Parse `autonomy steer`'s flags. The act's id is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseAutonomySteerArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: STEER_FLAGS });
}

/** What `autonomy record --help` prints. */
export const RECORD_USAGE =
  "usage: slopweaver autonomy record --action-id <id> --kind <slug> --subject <id> \\\n" +
  "         --by-session <text> --why <text> --said <text> --witness <text> \\\n" +
  "         [--done-iso <iso>] [--run <slug>] [--steer <text>] [--home <dir>] [--json]\n" +
  "\n" +
  "Records ONE act taken under graduated autonomy, so they can steer it retroactively from the Fleet\n" +
  "Briefing. Call it after you act, whether the act SUCCEEDED or was refused — an attempt they might have\n" +
  "wanted done differently is exactly what this register is for.\n" +
  "\n" +
  "  --action-id   your own id for this occurrence, reused verbatim if you have to record it again.\n" +
  "                Two records under one id must agree about every field or the second is refused\n" +
  "  --kind        what you did, as a slug. An OPEN vocabulary: name the real act, not the nearest\n" +
  "                listed thing — `press-merge-when-ready-refused` is a legitimate kind\n" +
  "  --subject     the CHECKABLE id of what you acted on: a pull-request URL, a Slack permalink\n" +
  "  --why         what made it obvious they would want it — the FLEET's note, read by the next session.\n" +
  "                Write the reasoning, not a label\n" +
  "  --said        the same act in words THEY read: what you did, to what, and why it mattered. This is\n" +
  "                the line their own card shows, so it is REFUSED when it names a doctrine rule number, a\n" +
  "                slug or a session id — none of those mean anything to them\n" +
  "  --witness     the verb you ran and the line it printed, so the act is checkable rather than asserted\n" +
  "  --done-iso    when you acted; defaults to now\n" +
  "  --steer       their word about it, when you already have one. A later `autonomy steer` supersedes it";

/** What `autonomy list --help` prints. */
export const LIST_USAGE =
  "usage: slopweaver autonomy list [--kind <slug>] [--by-session <text>] [--since <iso>] \\\n" +
  "         [--unsteered] [--home <dir>] [--json]\n" +
  "\n" +
  "Reads the autonomy ledger from local state, newest act first, each carrying their latest word on it.\n" +
  "No network, no model.\n" +
  "\n" +
  "  --unsteered  only the acts they have not given a word on yet — on the act, on the newest act of its\n" +
  "               pattern (one kind, on one subject or in one identical said), or on its whole kind\n" +
  "  --json       one JSON object per line, in the same order";

/** What `autonomy steer --help` prints. */
export const STEER_USAGE =
  "usage: slopweaver autonomy steer <actionId> --steer <their words> --by-session <text> \\\n" +
  "         [--home <dir>] [--json]\n" +
  "\n" +
  "Records THEIR retroactive word about one act, appended against the act's id. The supervisor runs this\n" +
  "after they read the ledger on their Fleet Briefing and says something about a row.\n" +
  "\n" +
  "  --steer       their words, as close to verbatim as you can make them — never your summary of them\n" +
  "  --by-session  which session is writing it down. Provenance, never proof that they said it\n" +
  "\n" +
  "A second steer on one act does not replace the first: both stay in the file and the newer one governs.";

/**
 * Parse `autonomy steer-class`'s flags. The class's own name is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseAutonomySteerClassArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: STEER_CLASS_FLAGS });
}

/** What `autonomy steer-class --help` prints. */
export const STEER_CLASS_USAGE =
  "usage: slopweaver autonomy steer-class <classId> --kinds <a,b,c> --steer <their words> \\\n" +
  "         --anchor <where they said it> [--subject-prefix <literal>] --by-session <text> \\\n" +
  "         [--home <dir>] [--json]\n" +
  "\n" +
  "Records THEIR standing word on a whole CLASS of act: every act whose kind is listed, recorded before or\n" +
  "after this, reads as settled by it and leaves --unsteered and their check-in list. A word on one act,\n" +
  "or on the newest act of its pattern, still outranks it.\n" +
  "\n" +
  "  --kinds       the exact kind slugs it settles, comma-separated. No patterns: a kind not listed stays\n" +
  "                theirs to judge. Re-recording a class REPLACES its list, so a dropped kind comes back\n" +
  "  --steer       their words, verbatim — never your summary of them\n" +
  "  --anchor      where they said them: a transcript id, a talk row, a permalink\n" +
  "  --subject-prefix  settle only the acts whose subject STARTS WITH this literal (an https URL through\n" +
  "                its host's slash, or state:<path>) — for a word about one place, such as their own DM.\n" +
  "                Written under class-scoped.<classId>, which an older build reads as settling nothing\n" +
  "  --by-session  which session is writing it down. Provenance, never proof that they said it";

/**
 * Parse `autonomy adopt`'s flags. Each positional is one `<actionId>=<replacement>` field substitution.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseAutonomyAdoptArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: ADOPT_FLAGS });
}

/** What `autonomy adopt --help` prints. */
export const ADOPT_USAGE =
  "usage: slopweaver autonomy adopt [<actionId>=<replacement> ...] [--apply] [--home <dir>] [--json]\n" +
  "\n" +
  "Adopts rows that were hand-appended to the register before this verb existed, so the whole file reads\n" +
  "again. Reports and writes NOTHING unless you pass --apply.\n" +
  "\n" +
  "Four transformations, and no others: a pretty-printed object is folded onto one line; a row with no\n" +
  "`witness` is given a statement of RECORDING PROVENANCE naming the preserved original and its digest,\n" +
  "never manufactured evidence; a FIELD whose value this register cannot read is replaced when you\n" +
  "name it; and a row with no `said` is given one derived from its own kind and subject, saying in the\n" +
  "line itself that it was written after the fact. Every other field is carried through, including\n" +
  "fields no type here declares.\n" +
  "\n" +
  "  <actionId>=<value>  one per field to repair. The VALUE says which field: a checkable id (an http(s)\n" +
  "             URL, a board row slug, or a state: reference) repairs `subject`, and an ISO-8601 instant\n" +
  "             such as 2026-09-14T01:15:00Z repairs `doneIso`. Refused when that act's value already\n" +
  "             reads, which would rewrite history rather than repair it; the original is quoted in the\n" +
  "             patched row's own witness\n" +
  "  --apply    take the ledger lock, preserve the original beside it, and install the adopted register.\n" +
  "             Refused when the register changed after the plan was read — plan again and look";
