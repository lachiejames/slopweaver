/**
 * A pull request's console card key, `pr:<owner>.<repo>.<number>`: the repository AND the number, so two open pull
 * requests sharing a number across repositories are two cards rather than one key the voice resolves to whichever
 * row came first. A restatement of `src/talk/prCardKey.ts`, which `site/` cannot import — the grammar, and why the
 * dot parses one way, are written there; `__tests__/unit/prCardKeyMirror.test.ts` drives one table through both.
 */
import { CARD_KEY } from "./cardKey";

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
 * The card key of the pull request `repoSlug#number` only when it reads back as that same pull request. A number
 * that is not a canonical positive whole, or a slug with no owner, mints a key another pull request owns — `42.5` in
 * `acme/widgets` is `acme/widgets.42`'s #5 — so every console minter asks this rather than {@link prCardKey}.
 *
 * @param repoSlug `owner/repo`, as the landing reading carries it
 * @returns `pr:<owner>.<repo>.<number>`, or `undefined` when that key would name another pull request
 */
export function prCardKeyOf({ repoSlug, number }: { repoSlug: string; number: number }): string | undefined {
  const key = prCardKey({ number, repoSlug });
  const parts = prCardKeyParts({ key });
  if (parts?.repoSlug !== repoSlug || parts.number !== number) {
    return undefined;
  }
  return key;
}

/**
 * The pull request a card key names, or `undefined` when it names none — another kind, a bare `pr:<number>` written
 * before keys carried a repository, or a number with a leading zero.
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
