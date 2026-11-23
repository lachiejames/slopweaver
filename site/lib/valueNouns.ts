/**
 * The nouns whose number is that noun's value rather than a pull request, as the two lookbehinds `./inlineCitations.ts`
 * reads a number through. A leaf of its own so the resolver stays under its line budget; nothing here resolves.
 */
import { anyCase } from "./referenceSpellings";

/**
 * The nouns a number standing after one is that noun's value rather than a pull request — `port 1000`, `pid: 4312`,
 * `PORT number 1000`, `exit code 1` — in any case, with an optional `number` or `no.` between. `port: 1000`, `PORT
 * 1000` and `port number 1000` would otherwise link as a pull request number on a repository attested
 * to 1324: in range and the right length, so only the noun before it says it is not one. A noun further back than
 * that is prose no pattern reads, and stays the accepted trade.
 */
const VALUE_NOUNS = [
  "port",
  "pid",
  "line",
  "version",
  "build",
  "exit",
  "status",
  "code",
  "error",
  "timeout",
  "step",
  "page",
  // Another register's own reference, never a pull request's: `issue #N`, `ticket N`.
  "issue",
  "ticket",
  "finding",
  "rfc",
  "turn",
  // A Datadog monitor's id, which its own alternative cites through the board's records and never as a pull request.
  "monitor",
  // An amount's currency code: `USD 16400`.
  "usd",
  "aud",
  "nzd",
  "eur",
  "gbp",
]
  .map((word) => anyCase({ word }))
  .join("|");

/** What may sit between a value noun and its number: `port number 1000`, `line no. 1204`. */
const NUMBER_WORD = `(?:\\s+(?:${anyCase({ word: "number" })}|${anyCase({ word: "no" })}\\.?))?`;

/** A lookbehind refusing a number directly after a {@link VALUE_NOUNS} noun — `port 1000`, `port #NNNN`, `line no. 12`. */
export const AFTER_VALUE_NOUN = String.raw`(?<!\b(?:${VALUE_NOUNS})s?${NUMBER_WORD}\s*[:=#]?\s*)`;

/**
 * A lookbehind REQUIRING a {@link VALUE_NOUNS} noun directly before a `#N` — a three-digit `timeout #NNN`, a four-digit `port #NNNN` — which
 * its own alternative reads, so the number links only through a carried address: the `#` still names a pull
 * request when the row carries one (as a three-digit `timeout #NNN` does in
 * `src/admit/preToolUseDispatch.ts`), and never through what the row merely knows. Its own alternative rather than
 * a flag on `#N`'s, because an optional group that matches nothing is never taken.
 */
export const HASH_AFTER_VALUE_NOUN = String.raw`(?<=\b(?:${VALUE_NOUNS})s?${NUMBER_WORD}\s*[:=]?\s*)`;

/**
 * `monitor`, `Monitors`, `monitor id`, `monitor_id`, `monitorId`, `Monitor-IDs`, `monitor number`, `monitor no.`, then a
 * run of `:`, `=`, `#`, `(`, a backtick or a space — never mid-word (the `IDs`, camel, hyphen, bracket and code-span
 * spellings; the {@link NUMBER_WORD} a value noun already allows).
 */
const MONITOR_HEAD = String.raw`(?<![\p{L}\p{M}\p{N}_/.-])${anyCase({ word: "monitor" })}[sS]?(?:[\s_-]*${anyCase({ word: "id" })}[sS]?)?${NUMBER_WORD}[\s:=#(\x60]+`;

/** One id of a list, as the lookbehind reads past it: `50001`, `#NNNNN`, a code span, an aside — `50001 (prod)`. */
const LISTED_ID = String.raw`[#\x60]?\d+\x60?(?:\s*\([^()]{0,40}\))?`;

/**
 * What joins one listed monitor id to the next: `50001, 50002`, `50001 and 50002`, `50001, or 50002`, `50001 & 50002`,
 * `50001; 50002`, `#NNNNN/#NNNNN`.
 */
const LIST_JOIN = String.raw`(?:\s*[,;/&]\s*(?:(?:${anyCase({ word: "and" })}|${anyCase({ word: "or" })})\s+)?|\s+(?:${anyCase({ word: "and" })}|${anyCase({ word: "or" })})\s+)`;

/** What may not follow a monitor id: a word, a hyphenated tail, or a range's far end. */
const ID_END = String.raw`(?![\p{L}\p{M}\p{N}_])(?!-[\p{L}\p{M}\p{N}_])(?!\s*\p{Dash}\s*\d)`;

/**
 * The first id a monitor spelling names, under `cN` — `monitor 50001`, `Monitor ID: 50001`, `monitor_id=50001` — which
 * resolves only through the board's records, so an unmapped one stays words and is never a pull request ("delete
 * muted monitor 50001" names a monitor; the `_id` and `=` spellings count too).
 */
export const MONITOR_FIRST = String.raw`${MONITOR_HEAD}(?<cN>\d+)${ID_END}`;

/**
 * Every LATER id of a listed monitor spelling, under `cL` — `monitors 50001, 50002` — resolved exactly like the
 * first; read alone it would be a bare number, and link as a pull request. It takes its own `#`, because a
 * `#N` the pull-request alternative reached first, one character earlier, would never come here.
 */
export const MONITOR_LISTED = String.raw`(?<=${MONITOR_HEAD}${LISTED_ID}(?:${LIST_JOIN}${LISTED_ID})*${LIST_JOIN})[#\x60]?(?<cL>\d+)${ID_END}`;
