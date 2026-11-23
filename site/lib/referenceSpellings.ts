/**
 * The spellings that SAY they are a reference — `PR N`, `#N`, a known team's key — and the finding one makes when it
 * resolves nowhere (a mention with no resolvable target is a lint finding), the unit that says a
 * number is a count, and whether a number fits a repository's scale. Apart from `inlineCitations.ts`, which resolves
 * a sentence, so that module stays one read; it imports only a TYPE from there.
 */
import type { CardReferences } from "./inlineCitations";

/**
 * A word spelled as two-case letter classes, so one word is case-blind without an `i` flag reaching every alternative.
 *
 * @returns the pattern source
 */
export function anyCase({ word }: { word: string }): string {
  return word
    .split("")
    .map((letter) => `[${letter}${letter.toUpperCase()}]`)
    .join("");
}

/**
 * What joins the PR word to its number: a space and an optional `#`, or `#` or `-` with no space — `PR#NNNNN` and
 * `PR-NNNNN` are the fleet's own spellings.
 */
export const PR_JOIN = String.raw`(?: #?|#|-)`;

/** `PR` or `pull request`, in any case — `pr N` and `Pull Request N` name a pull request as surely. */
export const PR_WORD = `(?:${anyCase({ word: "pr" })}|${anyCase({ word: "pull" })} ${anyCase({ word: "request" })})`;

/**
 * The units a number standing BEFORE one is that many of — `18 lines / 3,297 bytes` — in any case: the one spelling
 * that says a number is NOT a reference. The live `memory-s1-placement-names-the-canon-row` card drew its `18 lines`
 * as a pull request. PLURAL only, since a count as long as a repository's numbers is never one, and a singular is
 * the pull request's subject (`16406 token refresh`); a verb that is also a unit (`files`, `tests`,
 * `records`) is absent, since `16406 tests the seed` names the pull request. The trade, stated rather than
 * discovered: `16406 lines up with 16400` reads as a count, the one unit here that is rarely also a verb.
 */
const UNIT_NOUNS = ["lines", "bytes", "rows", "characters", "chars", "tokens", "entries", "words"]
  .map((word) => anyCase({ word }))
  .concat(["[kKMGT]i?Bs?"])
  .join("|");

/** A lookahead refusing a number directly before a {@link UNIT_NOUNS} unit — `18 lines`, `40 MiB`. */
export const BEFORE_UNIT_NOUN = String.raw`(?!\s+(?:${UNIT_NOUNS})(?![\p{L}\p{M}\p{N}_]))`;

/**
 * A reference a sentence spells as a pull request or a ticket that nothing resolved — the lint finding a card
 * draws, so a mention with no target is said out loud rather than left as words that merely look linked.
 */
export interface UnlinkedMention {
  /**
   * Which register the spelling claims: a pull request's `#N` / `PR N`, a known Linear team's key, or a Slack
   * `<@U…>` mention the roster the card read cannot name.
   */
  readonly kind: "github" | "linear" | "slack";
  /** The spelling as the sentence writes it. */
  readonly label: string;
}

/**
 * A `PR N`, `repo#N` or `owner/repo#N` written straight before a pull request's address: the spelling steps aside
 * for the address (`NO_ADDRESS_AFTER` in `inlineCitationsPatterns.ts`), so it is never a match of its own.
 */
const SPELLED_BEFORE_ADDRESS = new RegExp(
  String.raw`(?<![\p{L}\p{M}\p{N}_/.-])(?:${PR_WORD}(?:[sS](?= ))?${PR_JOIN}|(?:${PR_WORD}\s+)?(?:[\w.-]+\/)?[\w.-]*\w#|(?:[\w.-]+\/)?[\w.-]*\w ${PR_WORD}${PR_JOIN})(?<n>\d+)(?= ?\(?$)`,
  "u",
);

/** A range's far end written just before an address, `PRs N-M https://…`: its own pull request, by the PR word. */
const RANGE_END_BEFORE_ADDRESS = new RegExp(
  String.raw`(?<=(?<![\p{L}\p{M}\p{N}_/.-])${PR_WORD}(?:[sS](?= ))?${PR_JOIN}\d+\s*\p{Dash}\s*)#?(?<n>\d+)(?= ?\(?$)`,
  "u",
);

/** Whether two spelled numbers name one number, leading zeros aside: `PR 0N` before `…/pull/N` is that pull request. */
function sameNumber({ a, b }: { a: string | undefined; b: string | undefined }): boolean {
  return (
    a !== undefined && b !== undefined && withoutLeadingZeros({ spelled: a }) === withoutLeadingZeros({ spelled: b })
  );
}

/**
 * The spelling just before an address that is not that address's own pull request — `PR N (…/pull/M)`,
 * `PR N https://example.com`, or a range's far end, `PRs N-M https://example.com` — which no reference pattern
 * reads, since each refuses to end at an address. A pull request's address naming the same
 * number is that chip, and is no finding.
 *
 * @param before the words between the last chip and this match
 * @param preceding the whole text before `before`, which a range's far end reads its PR word from
 * @param groups the match's named capture groups; a pull-request address carries its number as `uN`
 * @returns the spelling as written and as it is read — a range's far end `M` reads `#M` — or `undefined` when
 *   none precedes the address or it names the address's own number
 */
export function spelledBeforeAddress({
  before,
  preceding,
  groups,
}: {
  before: string;
  preceding: string;
  groups: Readonly<Record<string, string | undefined>>;
}): { written: string; read: string } | undefined {
  const spelled = SPELLED_BEFORE_ADDRESS.exec(before);
  if (spelled !== null) {
    if (sameNumber({ a: spelled.groups?.["n"], b: groups["uN"] })) {
      return undefined;
    }
    return { read: spelled[0], written: spelled[0] };
  }
  const farEnd = RANGE_END_BEFORE_ADDRESS.exec(`${preceding}${before}`);
  const number = farEnd?.groups?.["n"];
  if (
    farEnd === null ||
    number === undefined ||
    farEnd.index < preceding.length ||
    sameNumber({ a: number, b: groups["uN"] })
  ) {
    return undefined;
  }
  return { read: `#${number}`, written: farEnd[0] };
}

/**
 * A pull request spelled as a number alone: `#N`, `PR N`, `PRs #N`, `PR-N`, `pull request N` — a plural only
 * before a space, so `PRs#N` is words.
 */
const SPELLED_NUMBER = new RegExp(String.raw`^(?:${PR_WORD}(?:[sS](?= ))?${PR_JOIN}|#)(?<n>\d+)$`, "u");

/** A pull request spelled with its repository: `acme/repo#N`, `repo #N`, `repo PR N`, `PR acme/repo N`. */
const SPELLED_IN_REPO = new RegExp(
  String.raw`^(?:${PR_WORD}\s+)?(?<repo>(?:[\w.-]+\/)?[\w.-]*\w)(?:\s+${PR_WORD}${PR_JOIN}|\s*#|\s+)(?<n>\d+)$`,
  "u",
);

/**
 * A spelled number or key with its leading zeros dropped, `012` as `12` and `IAC-09` as `IAC-9`: one target is
 * one number however it is written, in a spelling as in a carried address, when it is looked up as surely as when it is
 * counted. Only the trailing number's: `A01-09` is team A01's ticket 9, never A1's.
 *
 * @param spelled a number, or a key ending in one
 * @returns the same spelling with no leading zero before its digits
 */
export function withoutLeadingZeros({ spelled }: { spelled: string }): string {
  return spelled.replace(/(?<![\p{L}\p{M}\p{N}_])0+(?=\d+$)/u, "");
}

/**
 * A match's groups with every spelled number and key read without leading zeros, so `PR 0N` looks up the row's
 * pull request N exactly as its finding would be counted as #N, and a number an address carries, `…/pull/0N`, the
 * same way. Addresses and labels themselves are left as written.
 *
 * @returns the same groups, each number and key spelled without leading zeros
 */
export function spelledCanonically({
  groups,
}: {
  groups: Readonly<Record<string, string | undefined>>;
}): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(
    Object.entries(groups).map(([name, value]) => {
      const spelled = value !== undefined && (/^[a-z](?:Url)?N$/u.test(name) || name === "kKey" || name === "kLower");
      return [name, spelled ? withoutLeadingZeros({ spelled: value }) : value];
    }),
  );
}

/**
 * What an unlinked mention names, so two spellings of one target are one finding: `PR N`,
 * `pr N`, `pull request N` and `#N` all name the row's pull request N, and `PR acme/repo N`, `acme/repo PR N` and `acme/repo#N` all name acme/repo's.
 *
 * @param mention the finding as written
 * @returns its kind and its target, case, spacing and leading zeros folded
 */
export function mentionKey({ mention }: { mention: UnlinkedMention }): string {
  // `PR 0N` and `IAC-09` name N and IAC-9: a number's leading zeros are no part
  // of its target — the trailing number's only, so `repo-012#N` and `repo-12#N` stay two repositories.
  const folded = withoutLeadingZeros({ spelled: mention.label.toLowerCase().replaceAll(/\s+/gu, " ") });
  if (mention.kind !== "github") {
    return `${mention.kind}:${folded}`;
  }
  const number = SPELLED_NUMBER.exec(folded)?.groups?.["n"];
  if (number !== undefined) {
    return `github:#${number}`;
  }
  const inRepo = SPELLED_IN_REPO.exec(folded)?.groups;
  if (inRepo === undefined) {
    return `github:${folded}`;
  }
  return `github:${inRepo["repo"]}#${inRepo["n"]}`;
}

/**
 * Whether a match that resolved nothing was a spelling that SAYS what it is — a five-digit `#NNNNN` or `PR NNNNN`, or a key of a
 * Linear team the install has — so its missing target is a finding. A match kept whole as words is never scanned
 * again, so every group spelling a `#N` or a `PR N` is read here: `repo #N` and `repo PR N` naming another repository,
 * a range's far end, and `#N (URL)` beside a different pull request's address. A bare
 * number, a one-digit `#1` or `option #1`, a value noun's four-digit `port #NNNN` and a key of no known team say nothing, and stay
 * words — while `PR 9` and a range's far end name a pull request at any length.
 *
 * @param groups the match's named capture groups
 * @param written the whole match
 * @param whole whether the match was kept whole as words; a miss gives back all but its first character, so a
 *   repository-qualified number that missed still has its `#N` read on its own — a range's far end has no second read
 * @param references whose Linear team keys decide whether a key is a ticket
 * @returns the finding, or `undefined` when the match names no register
 */
export function unlinkedOf({
  groups,
  written,
  whole,
  references,
}: {
  groups: Readonly<Record<string, string | undefined>>;
  written: string;
  whole: boolean;
  references: CardReferences;
}): UnlinkedMention | undefined {
  // Counted without leading zeros, so `#0N` is the one-digit `#N` it names.
  const { hN, bN, sN, qN, gN, pN, pPr, pWord, pRepo, kKey, kLower } = spelledCanonically({ groups });
  const hashed = [hN, bN, sN].find((number) => number !== undefined);
  if (hashed !== undefined && hashed.length > 1) {
    return { kind: "github", label: `#${hashed}` };
  }
  // The PR word names a pull request at any length; `#` alone does so from two digits, as `option #1` is prose.
  // `PR#N` reads its `PR` as the repository, and is the PR word all the same, as is a spaced plural's `PRs #1` —
  // never the compact `PRs#1`, which is repository `PRs`.
  const prRepo = pRepo !== undefined && (/^pr$/iu.test(pRepo) || /^prs\s/iu.test(written));
  const prWorded = pPr !== undefined || pWord !== undefined || prRepo;
  const repoSpelled = pN !== undefined && (prWorded || (written.includes("#") && pN.length > 1));
  // A miss is scanned again from its next character, which re-reads `repo #N` as `#N` and `repo PR N` as `PR N` —
  // never a compact `repo#N` or `PR#N`, whose `#` follows a letter, nor `PR repo N`, whose `repo N` is prose, nor
  // `PRs #N`, whose word is the PR word, so a range's first end `PRs #N–M` is never lost.
  const readAgain = pWord !== undefined || (!prRepo && /\s#\d+$/u.test(written) && pN !== undefined && pN.length > 1);
  // `PR N PR M` reads `N` as a repository; it is `PR N`, and the scan resuming inside it never reads it again.
  if (pPr !== undefined && pRepo !== undefined && /^\d+$/u.test(pRepo)) {
    return { kind: "github", label: written.slice(0, written.indexOf(pRepo, pPr.length) + pRepo.length) };
  }
  if (repoSpelled && (whole || !readAgain)) {
    return { kind: "github", label: written };
  }
  if (gN !== undefined) {
    return { kind: "github", label: `#${gN}` };
  }
  if (qN !== undefined) {
    // `PR-12` is a ticket when the install has a PR team, exactly as the resolver reads it.
    const asKey = `PR-${qN}`;
    // Compared without its leading zeros, so `PR-012` is the same ticket PR-12.
    if (withoutLeadingZeros({ spelled: written }).toUpperCase() === asKey && references.linearTeamKeys.includes("PR")) {
      return { kind: "linear", label: asKey };
    }
    return { kind: "github", label: written };
  }
  // A known team's key in any case: `iac-9` names IAC-9 as surely.
  for (const key of [kKey, kLower]) {
    const known =
      key !== undefined && references.linearTeamKeys.some((team) => key.toUpperCase().startsWith(`${team}-`));
    if (key !== undefined && known) {
      return { kind: "linear", label: key };
    }
  }
  return undefined;
}

/** A Linear issue's key as Linear prints it: a team key, a dash, a number. */
export const LINEAR_KEY = String.raw`[A-Z][A-Z0-9]{0,9}-\d+`;

/**
 * A number a link's label names: `#N`, `PR-N`, or one standing alone — `PR N`, `acme-admin N`, `N`.
 * Any other number in a label is read as naming a pull request too: a mismatch then stays words.
 */
const LABEL_NUMBER = /#(?<hashed>\d+)|(?<![\w.-])(?<alone>\d+)(?![\w.])|(?<![\w-])[Pp][Rr]-(?<joined>\d+)\b/gu;

/** A Linear key a link's label names. */
const LABEL_KEY = new RegExp(String.raw`(?<![\w-])(?!PR-)(${LINEAR_KEY})\b`, "gu");

/**
 * A key a label writes in any case, `exa-2` or `Exa-2` — a Linear key only when its team is one the install knows or the
 * link's own key's, so a label's `utf-8` names nothing.
 */
const LABEL_LOWER_KEY = /(?<![\w-])([a-zA-Z][a-zA-Z0-9]{0,9})-(\d+)\b/gu;

/**
 * Whether every pull-request number and Linear key a link's label names is the one its address names — so
 * `[PR #N](…/pull/M)` or `<…/QQQQ-N|QQQQ-M>` is never one chip whose words say another object.
 *
 * @param label the link's own words
 * @param own `#N` for a pull-request address, the key for a Linear one
 * @param teamKeys the install's Linear teams — a label's `PR-41` is a ticket when one of them is `PR`
 * @param carriedKeys the Linear keys the row's addresses name, upper-cased — a label's `utf-8` names one of them
 *   whatever the install's teams, as it would written anywhere else
 * @returns true when nothing in the label names another pull request or ticket
 */
export function labelAgrees({
  label,
  own,
  teamKeys,
  carriedKeys,
}: {
  label: string;
  own: string;
  teamKeys: readonly string[];
  carriedKeys: ReadonlySet<string>;
}): boolean {
  const prIsTeam = teamKeys.includes("PR");
  const ownTeam = /^([A-Z][A-Z0-9]*)-\d+$/u.exec(own)?.[1];
  const numbers = [...label.matchAll(LABEL_NUMBER)].map((match) => {
    const hashed = match.groups?.["hashed"];
    const alone = match.groups?.["alone"];
    const joined = match.groups?.["joined"];
    if (joined !== undefined && prIsTeam) {
      return `PR-${joined}`;
    }
    return `#${[hashed, alone, joined].find((n) => n !== undefined)!}`;
  });
  // The whole match IS the key: LABEL_KEY's lookarounds and `\b` take no characters.
  const keys = [...label.matchAll(LABEL_KEY)].map((match) => match[0]);
  const lowerKeys = [...label.matchAll(LABEL_LOWER_KEY)]
    .map(([, team = "", number = ""]) => ({ number, team: team.toUpperCase() }))
    .filter(
      ({ number, team }) =>
        team === ownTeam ||
        teamKeys.includes(team) ||
        carriedKeys.has(`${team}-${withoutLeadingZeros({ spelled: number })}`),
    )
    .map(({ number, team }) => `${team}-${number}`);
  const canonical = withoutLeadingZeros({ spelled: own });
  return [...numbers, ...keys, ...lowerKeys].every((named) => withoutLeadingZeros({ spelled: named }) === canonical);
}

/** A `#N` the row's repository resolves needs two digits at least, so `option #1` stays words. */
const HASHED_MIN_DIGITS = 2;

/**
 * Whether `number`, written after a `#`, could be one of `repo`'s pull requests: two digits at least — unless a PR word
 * spells it, `PR 1`, which names a pull request at any length — and no more than the largest number any row
 * attests for it. `repo` with nothing attested fits only when `unattested` says so —
 * the row's own home, whose `#N` names a pull request by its spelling; never a repository the row merely names.
 *
 * @param repo `owner/repo`
 * @param unattested whether a repository with nothing attested fits
 * @param spelledPull whether a PR word, not a bare `#`, named the number
 * @returns whether it fits
 */
export function hashedFits({
  number,
  repo,
  attested,
  unattested,
  spelledPull = false,
}: {
  number: string;
  repo: string;
  attested: ReadonlyMap<string, number>;
  unattested: boolean;
  spelledPull?: boolean;
}): boolean {
  if (!spelledPull && number.length < HASHED_MIN_DIGITS) {
    return false;
  }
  const largest = attested.get(repo.toLowerCase());
  if (largest === undefined) {
    return unattested;
  }
  return number.length <= String(largest).length;
}

/**
 * A four-digit number that reads as a year — `YYYY` in `D Mon YYYY` — which a bare number never links as, even on
 * a repository whose numbers run to four digits.
 */
const YEAR = /^(?:19|20)\d\d$/u;

/**
 * How far past the largest attested number a number standing alone may run and still read as a pull request: far
 * enough for the ones opened since the board last carried an address, not so far that `port 3000` becomes
 * slopweaver's pull request of that number. MEASURED: the board attested slopweaver to 1309 while main had reached 1324
 * (1.1% past), and `port 3000` sat on a live slopweaver card at 2.3 times it. Reproduce the attested end with
 * `slopweaver handover list --json | jq '[.rows[].prUrls[]? | select(test("slopweaver/pull")) | ltrimstr("https://github.com/lachiejames/slopweaver/pull/") | tonumber] | max'`.
 */
const BARE_CEILING = 1.1;

/**
 * Whether a number standing alone reads as one of `repo`'s pull requests — {@link hashedFits}'s twin for a number no
 * `#` precedes: its digits exactly as many as the largest number any row attests for the repository, no more than
 * {@link BARE_CEILING} past that number, and not a year. `16406` on an acme-admin card attested to 17,648 fits; `30`,
 * `2026`, `14` and slopweaver's `port 3000` do not. A repository with no attestation fits nothing — nothing says what
 * scale its numbers run to.
 *
 * The trade, stated rather than discovered: a count the same length as the repository's numbers (`1000 of them` on
 * a four-digit repository) fits too. Only a unit after it (`1000 rows`, {@link BEFORE_UNIT_NOUN}) tells the two
 * apart, and the rule is every number, cited or not.
 *
 * @param number the digits as written
 * @param repo `owner/repo`
 * @returns whether it fits
 */
export function bareFits({
  number,
  repo,
  attested,
}: {
  number: string;
  repo: string;
  attested: ReadonlyMap<string, number>;
}): boolean {
  const largest = attested.get(repo.toLowerCase());
  if (largest === undefined || number.startsWith("0")) {
    return false;
  }
  if (number.length !== String(largest).length || Number(number) > largest * BARE_CEILING) {
    return false;
  }
  return number.length !== 4 || !YEAR.test(number);
}
