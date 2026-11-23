/**
 * A pull request's console card key: `pr:<owner>.<repo>.<number>`, the repository AND the number. Keyed by the
 * number alone, two open pull requests sharing a number in two repositories shared one key, so `read_card`,
 * `open_card`, a deferral, a landing and a not-the-owner's verdict all resolved whichever row came first — a
 * different pull request, in a different workspace, from the one the owner was looking at.
 *
 * The separator is a dot because {@link CARD_KEY} admits no `/` or `#`. It still parses one way: a GitHub owner
 * cannot contain a dot, so the owner ends at the FIRST dot, and the number is the digits after the LAST one, leaving
 * a repository name its own dots. GitHub's owner and repository grammars are subsets of the key's, and their caps
 * (39 and 100 characters) keep every minted key under its 160, so minting is total over a real `owner/repo`.
 *
 * A key written before this, `pr:<number>`, still passes {@link CARD_KEY} so old journal lines stay readable, and
 * {@link prCardKeyParts} reads it as no pull request at all: which repository it meant is not recoverable from today's
 * reading, and guessing is the defect this module exists to remove. `site/lib/prCardKey.ts` restates this file,
 * which `site/` cannot import; `site/__tests__/unit/prCardKeyMirror.test.ts` drives one table through both.
 */
import { CARD_KEY, isRegisterCardKey } from "./cardKey.js";

/** The suffix of a pull request key: an owner with no dot, a repository, and a canonical positive number. */
const PR_SUFFIX = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9._-]+)\.([1-9][0-9]*)$/u;

/** One pull request, as its card key names it. */
export interface PrCardKeyParts {
  /** `owner/repo`, as the landing reading's `repoSlug` spells it. */
  readonly repoSlug: string;
  readonly number: number;
}

/**
 * The card key of the pull request `repoSlug#number`.
 *
 * @param repoSlug `owner/repo`, as the landing reading carries it
 * @returns `pr:<owner>.<repo>.<number>`
 */
export function prCardKey({ repoSlug, number }: { repoSlug: string; number: number }): string {
  const slash = repoSlug.indexOf("/");
  return `pr:${repoSlug.slice(0, slash)}.${repoSlug.slice(slash + 1)}.${String(number)}`;
}

/**
 * The pull request a card key names, or `undefined` when it names none — another kind, a bare `pr:<number>` written
 * before keys carried a repository, or a number with a leading zero, so one pull request has exactly one key.
 *
 * @param key the candidate card key
 * @returns the repository and number, or `undefined`
 */
export function prCardKeyParts({ key }: { key: string }): PrCardKeyParts | undefined {
  if (!CARD_KEY.test(key) || !key.startsWith("pr:")) {
    return undefined;
  }
  const parts = PR_SUFFIX.exec(key.slice("pr:".length));
  const owner = parts?.[1];
  const repo = parts?.[2];
  const digits = parts?.[3];
  if (owner === undefined || repo === undefined || digits === undefined) {
    return undefined;
  }
  const number = Number(digits);
  if (!Number.isSafeInteger(number)) {
    return undefined;
  }
  return { number, repoSlug: `${owner}/${repo}` };
}

/**
 * Whether a key a record carried names exactly one card a register holds: a {@link CARD_KEY}, of a kind a register
 * holds ({@link isRegisterCardKey}), and — for a pull request — one {@link prCardKeyParts} reads. A bare `pr:<number>`
 * off an old record names whichever repository's pull request shared the number, so a reader counting or landing words
 * on a card treats it as naming none, exactly as `cardLanding.ts` refuses it.
 *
 * @param key the key the record carried, if any
 * @returns whether it names one register card
 */
export function namesOneRegisterCard({ key }: { key: string | undefined }): boolean {
  if (key === undefined || !CARD_KEY.test(key) || !isRegisterCardKey({ key })) {
    return false;
  }
  return !key.startsWith("pr:") || prCardKeyParts({ key }) !== undefined;
}
