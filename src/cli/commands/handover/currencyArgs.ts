/**
 * What `slopweaver handover currency` accepts — its flag spec, the names the help-truth ratchet reads, the pure
 * parser and the usage text.
 */
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** The flags `handover currency` accepts. */
const CURRENCY_FLAGS: FlagSpec = { boolean: ["full", "json"], string: ["dir", "home", "now", "record-reading"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_CURRENCY_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: CURRENCY_FLAGS }),
  ...booleanFlagsOf({ spec: CURRENCY_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover currency`'s own flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverCurrencyArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: CURRENCY_FLAGS });
}

/**
 * Why a `--now` must be refused, if it must. A reading's `checkedIso` claims every source was read through that
 * instant, and the console passes a card's steers half on it, so a `--now` later than the wall clock would claim
 * an interval the read never saw — a memory changed between the read and that future instant would never be
 * listed. An earlier `--now` (a replay fixture's stopped clock) only shortens the claim, so it stands.
 *
 * @param now the `--now` value as typed
 * @param wallMs the wall clock the read actually runs at, in epoch milliseconds
 * @returns the refusal line, or `undefined` when `--now` stands
 */
export function currencyNowRefusal({ now, wallMs }: { now: string; wallMs: number }): string | undefined {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    return `--now ${now} is not an ISO-8601 instant`;
  }
  if (nowMs > wallMs) {
    return `--now ${now} is later than the wall clock: a reading may not claim sources were read at an instant that has not happened yet`;
  }
  return undefined;
}

/** `handover currency`'s usage. */
export const CURRENCY_USAGE =
  "usage: slopweaver handover currency [--json] [--full] [--record-reading <by>] [--now <iso>] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "By default the human read prints a count line, each standing change that can bear on any card ONCE with\n" +
  "how many cards it bears on, then every card with a cause of its own — the owner's unfiled words, a ruling on its\n" +
  "own row, a gap in what could be read, a fact that would not read, a reply found, a done-check that could\n" +
  "not run — and a count of the cards whose only change is a shared standing one. --full prints one line for\n" +
  "every card. --json and --record-reading always carry every card.\n" +
  "\n" +
  "For every Queue card waiting on the owner (hand, ask, draft, post, review, pr), a schema-3 row by its exact\n" +
  "key and floor (when the card reached the owner), answering what a card needs before the owner opens it:\n" +
  "  fact   — whether its facts were re-confirmed, and by what: a register still holding it, a monitor's own\n" +
  "           last pass naming it (never the register alone), a landing poll, an ask's still-real check or\n" +
  "           thread read. Otherwise not-confirmed, saying why.\n" +
  "  done   — an ask's done-check. A Slack-anchored ask is checked LIVE with `slack replied`; any other declared\n" +
  "           check is named and not run; an ask with none is done when the owner rules on it or it is settled.\n" +
  "  since  — whatever the owner has said strictly after the floor that is filed to THIS card, or not filed anywhere\n" +
  "           yet: chair turns, call words the chair has not read, relays that never reached it. A word filed\n" +
  "           to another card does not count. A source that could not be read is a named gap, never\n" +
  "           'nothing since'.\n" +
  "  since.standing — every change to the owner's standing guidance strictly after the floor: a memory leaf (the latest of\n" +
  "           its declared modified date, its mtime and its ctime, a link on its path dated too), the owner profile's\n" +
  "           revision, a ruling journalled on any\n" +
  "           row. A ruling filed to another row does not count unless it places a gate still in force, read\n" +
  "           from every run journal under the home. The steers half passes only when since and standing are\n" +
  "           both empty and nothing went unread.\n" +
  "  said   — the owner's own words for every turn a row names, once per turn, marked where the record cut them; the\n" +
  "           card quotes them folded shut rather than printing a pointer.\n" +
  "  pullRequests — every pull request a row names that the owner asked proof on, its live body read in one\n" +
  "           batched GitHub call: requested-and-met, requested-and-unmet (with the gap a card leads with),\n" +
  "           or body-unread when GitHub could not be read — never called missing.\n" +
  "--record-reading <by> appends the document to the readings ledger as <by>, observed at its checkedIso —\n" +
  "the console's Queue runs it with `sync-now` on opening; the supervisor tick records the child's stdout\n" +
  'itself. The Queue reads the latest either recorded (`reading last --producer "handover currency"`).\n' +
  "Exits 0 whenever it wrote the reading (and, with --record-reading, the ledger took it); 1 when the board or a\n" +
  "card register could not be read whole — then nothing is written, never a reading missing a card — or when\n" +
  "the ledger refused the append, after the document is printed.\n" +
  "--now <iso> is the reading's checkedIso; one later than the wall clock is refused (exit 2), since the reading\n" +
  "would claim sources read through an instant that has not happened.\n" +
  "\n" +
  "example: slopweaver handover currency --json";
