/**
 * Flag specs, usage text and the shared parses for the `gold` noun. Pure: no I/O, no clock.
 *
 * Kept apart from the three verb modules so the help-truth ratchet can read a flag list without importing a
 * command, exactly as `../autonomy/core.ts`, `../knowledge/core.ts` and `../grant/core.ts` do.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `gold`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

const OWE_STRINGS = [
  "pull-request",
  "grade",
  "merged-iso",
  "would-be",
  "blocked-on",
  "recorded-iso",
  "by-session",
  "title",
  "run",
  "home",
] as const;
const OWE_BOOLEANS = ["json"] as const;
const OWE_FLAGS: FlagSpec = { boolean: OWE_BOOLEANS, string: OWE_STRINGS };

const DEBTS_STRINGS = ["repo", "home"] as const;
const DEBTS_BOOLEANS = ["json", "settled", "all"] as const;
const DEBTS_FLAGS: FlagSpec = { boolean: DEBTS_BOOLEANS, string: DEBTS_STRINGS };

const SETTLE_STRINGS = ["as", "evidence", "regrade", "proof-commit", "settled-iso", "by-session", "home"] as const;
const SETTLE_BOOLEANS = ["json"] as const;
const SETTLE_FLAGS: FlagSpec = { boolean: SETTLE_BOOLEANS, string: SETTLE_STRINGS };

/** `--`-prefixed owe flags, for the help-truth ratchet. */
export const GOLD_OWE_FLAG_NAMES: readonly string[] = [...OWE_STRINGS, ...OWE_BOOLEANS]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed debts flags, for the help-truth ratchet. */
export const GOLD_DEBTS_FLAG_NAMES: readonly string[] = [...DEBTS_STRINGS, ...DEBTS_BOOLEANS]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed settle flags, for the help-truth ratchet. */
export const GOLD_SETTLE_FLAG_NAMES: readonly string[] = [...SETTLE_STRINGS, ...SETTLE_BOOLEANS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `gold owe`'s flags. The pull request may be the one positional instead of `--pull-request`.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseGoldOweArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: OWE_FLAGS });
}

/**
 * Parse `gold debts`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseGoldDebtsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: DEBTS_FLAGS });
}

/**
 * Parse `gold settle`'s flags. The debt's URL or `<owner>/<repo>#<n>` key is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseGoldSettleArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SETTLE_FLAGS });
}

/** What `gold owe --help` prints. */
export const OWE_USAGE =
  "usage: slopweaver gold owe <pull-request-url> --grade silver|bronze --merged-iso <iso> \\\n" +
  "         --would-be <text> --blocked-on <text> --by-session <text> \\\n" +
  "         [--pull-request <url>] [--title <text>] [--run <slug>] [--recorded-iso <iso>] \\\n" +
  "         [--home <dir>] [--json]\n" +
  "\n" +
  "Records that ONE merged pull request still owes its gold proof. A merge at\n" +
  "silver or bronze because gold was not feasible AT THAT TIME leaves gold OWED, never waived — a later proof\n" +
  "still finds bugs before they bite in a live setting.\n" +
  "\n" +
  "Run it after you land, not before. Nothing here gates a merge, and nothing ever will.\n" +
  "\n" +
  "  --pull-request  the merged pull request, when a flag reads better than the positional; the two are\n" +
  "                  the same argument and naming both is refused\n" +
  "  --grade       what it merged at. `gold` is refused — a gold merge owes nothing\n" +
  "  --would-be    what gold proof WOULD be. Quote the pull request's own why-not-gold sentence; that\n" +
  "                sentence is the artifact, and this field is where a later session reads it\n" +
  "  --blocked-on  the condition that has to pass before that proof is gatherable — the cron ran, the\n" +
  "                backfill stopped, the fixture regenerated, the owner approved the outward act. Prose, on\n" +
  "                purpose: no enum holds the real ones and nothing here evaluates it\n" +
  "  --title       the pull request's title, so the list reads with no network call\n" +
  "  --run         the board row it landed under, when there was one\n" +
  "  --recorded-iso  when this row is being written; defaults to now. A debt is routinely recorded late";

/** What `gold debts --help` prints. */
export const DEBTS_USAGE =
  "usage: slopweaver gold debts [--settled | --all] [--repo <owner/name>] [--home <dir>] [--json]\n" +
  "\n" +
  "Reads the gold-debt ledger from local state, OLDEST debt first — the one owed longest is the one most\n" +
  "likely to have had its blocking condition pass. No network, no model.\n" +
  "\n" +
  "Open debts only, unless you ask otherwise. Each row prints what gold would be and what is blocking it,\n" +
  "so the reader judges whether the condition has passed. Nothing here decides that.\n" +
  "\n" +
  "  --settled    the debts that have been paid or written off, instead of the open ones\n" +
  "  --all        every debt the register holds, open and settled\n" +
  "  --repo       only debts on this `<owner>/<name>`\n" +
  "  --json       one JSON object per line, in the same order";

/** What `gold settle --help` prints. */
export const SETTLE_USAGE =
  "usage: slopweaver gold settle <pull-request-url | owner/repo#number> --evidence <text> \\\n" +
  "         --by-session <text> [--as gathered|moot] [--regrade <text>] [--proof-commit <sha>] \\\n" +
  "         [--settled-iso <iso>] [--home <dir>] [--json]\n" +
  "\n" +
  "Closes ONE gold debt: the evidence exists now (`--as gathered`, the default), or it never can\n" +
  "(`--as moot` — the surface was removed, the change reverted, the provider went away).\n" +
  "\n" +
  "It does NOT edit the pull request. Composing a re-graded description is judgement — the Proof cell has\n" +
  "to carry the new evidence and the above-the-fold gate still applies — so this verb records the\n" +
  "settlement and prints the `slopweaver github pr` invocation to run.\n" +
  "\n" +
  "  --evidence    what was gathered and where, with its link. On `--as moot`, why it never can be\n" +
  "  --regrade     what the merged pull request now reads, and what you ran to make it read that way.\n" +
  "                REQUIRED on a gathered settlement: the owner's word is that the re-grade is OPEN,\n" +
  "                so a settlement leaving the merged description saying silver has hidden it\n" +
  "  --proof-commit  the commit the late evidence was gathered against, when one is meaningful\n" +
  "  --settled-iso   when it was settled; defaults to now";
