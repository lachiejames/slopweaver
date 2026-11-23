/**
 * The pull requests and tickets a hand step names, as addresses — what its queue card resolves `#N` against,
 * so each number is a citation chip (`site/lib/cardAddresses.ts`).
 *
 * Its own module rather than more of `./step.ts`, which builds and judges every other field: citing is one
 * seam — which addresses a step may carry, and which numbers it names without one.
 */

import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/**
 * One address a step may cite — whatever its queue card draws as a citation chip (`site/lib/citationDisplay.ts`):
 * any `https://` address, the integration it names read off its host; one of this console's own
 * `http://localhost:<port>/…` routes; or a local page's `file://…/pages/<slug>/index.html`. Every reference on every localhost page is a chip, so a step citing a Vanta control or a Datadog monitor
 * cites as much as one citing a pull request. Never whitespace, so a sentence pasted into the field is refused
 * rather than stored as an address.
 */
const CITE =
  /^(?:https:\/\/[^\s/?#.]+(?:\.[^\s/?#.]+)+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?|file:\/\/\/\S*\/pages\/[^\s/]+\/index\.html)(?:[/?#]\S*)?$/u;

/** The longest address a step may cite — a real one is far shorter, so a longer string is a paste, not a link. */
const CITE_LENGTH_CAP = 2048;

/** How many addresses one step may cite — a step is ONE act, so more than a handful is a board, not a step. */
const CITES_CAP = 8;

/**
 * A pull request named `#N`: two digits at least, and no `#` after a word character, `/` or `&`, so a URL
 * fragment, a path, an HTML entity and `option #1` are not references — `../handover/cardAlignment.ts`'s shape.
 * Captured with the word before it, because the card reads `acme-admin #N` through acme-admin's N alone when a
 * carried address names acme-admin, and any other `#N` through the ONE carried pull request numbered N.
 */
const HASHED = /(?:(?<![\w/.-])((?:[\w.-]+\/)?[\w.-]*\w) )?(?<![\w/&])#(\d{2,})\b/gu;

/**
 * A pull request named `PR N` or `pull request N`, with the word before it: a hand step carries this spelling only
 * when that word is the repository of a carried address with that number (`acme-admin PR N`), never bare,
 * and only in exactly that case: `pr N` and `Pull Request N` are matched here to be refused. With a `#`
 * (`acme-admin PR #N`) the same holds when the word names a carried repository; otherwise the card reads
 * the `#N` on its own, which {@link HASHED} judges. Stricter than the drawer, which links more spellings: a step is
 * written once, by the fleet, in the one spelling every surface reads.
 */
const SPELLED = /(?:(?<![\w/.-])((?:[\w.-]+\/)?[\w.-]*\w) )?\b(PR|pull request) (#?)(\d{2,})\b/giu;

/**
 * A pull request named `N PR` — `the N PR` — or `PR#N`, which a hand step writes `#N` instead. The word
 * and `#` before `N` are captured because the card still links `#N PR` by its `#N` and `acme-admin N PR` by
 * its repository, so those two are judged as `#N` and `repo N` are.
 */
const TRAILING = /(?:(?<![\w/.-])((?:[\w.-]+\/)?[\w.-]*\w) )?(#?)\b(\d{2,}) PR\b|\bPR#(\d{2,})\b/giu;

/** A GitHub pull-request address anywhere in a string: its owner, repository and number. */
const ADDRESS = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/gu;

/**
 * The addresses the step cites, each one its card draws as a chip — or honestly absent.
 *
 * An empty list is dropped rather than written, so a row with nothing cited reads back byte for byte the same
 * as one written before the field. A repeat is dropped too: one address cited twice is still one citation.
 *
 * @param value whatever the caller or the register line carried
 * @returns the addresses, first seen first, `undefined` when there are none, or the refusal
 */
export function checkedCites({ value }: { value: unknown }): Result<readonly string[] | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return err(HandStepErrors.invalidField({ field: "cites", why: "is a list of addresses" }));
  }
  const out: string[] = [];
  for (const entry of value as readonly string[]) {
    const trimmed = entry.trim();
    if (trimmed.length > CITE_LENGTH_CAP || !CITE.test(trimmed)) {
      return err(
        HandStepErrors.invalidField({
          field: "cites",
          why: `names "${trimmed}", which is not an https:// address, a localhost console route nor a local page — the only addresses a card draws as a chip`,
        }),
      );
    }
    if (!out.includes(trimmed)) {
      out.push(trimmed);
    }
  }
  if (out.length > CITES_CAP) {
    return err(
      HandStepErrors.invalidField({
        field: "cites",
        why: `names ${String(out.length)} addresses and the cap is ${String(CITES_CAP)} — a step is one act`,
      }),
    );
  }
  if (out.length === 0) {
    return ok(undefined);
  }
  return ok(out);
}

/** One pull request an address carries, lowercased where GitHub is case-insensitive. */
interface Carried {
  readonly owner: string;
  readonly repo: string;
  readonly number: string;
}

/**
 * The carried pull requests the word before a reference names as their repository — `acme-admin`, or
 * `acme/acme-admin` with its owner — compared without case, as the card compares them.
 *
 * @param word the word before the reference, when there is one
 * @param carried every pull request the step carries
 * @returns the pull requests of that repository, empty when the word names none
 */
function ofRepository({
  word,
  carried,
}: {
  word: string | undefined;
  carried: readonly Carried[];
}): readonly Carried[] {
  if (word === undefined) {
    return [];
  }
  const written = word.toLowerCase().split("/");
  return carried.filter((pull) => pull.repo === written.at(-1) && (written.length === 1 || pull.owner === written[0]));
}

/**
 * Whether the card draws a `#N` as a chip: through that repository's N when the word before it names a carried
 * repository, otherwise through the ONE carried pull request numbered N — two repositories' N is a guess.
 *
 * @param word the word before the `#N`, when there is one
 * @param number the number as written
 * @param carried every pull request the step carries
 * @returns whether the card would draw it as a chip
 */
function hashedLinks({
  word,
  number,
  carried,
}: {
  word: string | undefined;
  number: string;
  carried: readonly Carried[];
}): boolean {
  const named = ofRepository({ carried, word });
  if (named.length > 0) {
    return named.some((pull) => pull.number === number);
  }
  return (
    new Set(carried.filter((pull) => pull.number === number).map((pull) => `${pull.owner}/${pull.repo}`)).size === 1
  );
}

/**
 * The `#N` references in one sentence the card would not draw as a chip.
 *
 * @param text one of the step's sentences
 * @param carried every pull request the step carries
 * @returns one problem per such reference
 */
function hashedProblems({ text, carried }: { text: string; carried: readonly Carried[] }): readonly string[] {
  return [...text.matchAll(HASHED)]
    .filter(([, word, number = ""]) => !hashedLinks({ carried, number, word }))
    .map(
      ([, , number = ""]) =>
        `"#${number}" names no one pull request it carries — pass its github.com URL with --cites <url,url>`,
    );
}

/**
 * The `PR N` and `pull request N` references in one sentence the card would not draw as a chip. With a `#`, one
 * the card reads as a bare `#N` is left to {@link hashedProblems}.
 *
 * @param text one of the step's sentences
 * @param carried every pull request the step carries
 * @returns one problem per such reference
 */
function spelledProblems({ text, carried }: { text: string; carried: readonly Carried[] }): readonly string[] {
  const problems: string[] = [];
  for (const [whole, word, spelling, hash, number = ""] of text.matchAll(SPELLED)) {
    const exact = spelling === "PR" || spelling === "pull request";
    const repository = ofRepository({ carried, word });
    const readAsHashed = hash === "#" && (!exact || repository.length === 0);
    const links = exact && repository.some((pull) => pull.number === number);
    if (!readAsHashed && !links) {
      problems.push(`"${whole}" is a spelling a hand step does not carry — write it #${number} and cite it`);
    }
  }
  return problems;
}

/**
 * The `N PR` and `PR#N` references in one sentence the card would not draw as a chip. `#N PR` is left to
 * {@link hashedProblems}; `repo N PR` links when that repository's N is carried.
 *
 * @param text one of the step's sentences
 * @param carried every pull request the step carries
 * @returns one problem per such reference
 */
function trailingProblems({ text, carried }: { text: string; carried: readonly Carried[] }): readonly string[] {
  const problems: string[] = [];
  for (const [whole, word, hash, trailing, joined] of text.matchAll(TRAILING)) {
    const number = [trailing, joined].find((group) => group !== undefined);
    const repository = ofRepository({ carried, word }).some((pull) => pull.number === number);
    if (hash !== "#" && !repository) {
      problems.push(`"${whole}" is a spelling a hand step does not carry — write it #${String(number)} and cite it`);
    }
  }
  return problems;
}

/**
 * Every pull request the step names in a way its card would NOT draw as a chip, each with what to do instead.
 *
 * @param texts the step's sentences
 * @param carried every pull request its `cites` and `url` carry
 * @returns one problem per distinct spelling, first seen first
 */
function unlinkedNames({
  texts,
  carried,
}: {
  texts: readonly string[];
  carried: readonly Carried[];
}): readonly string[] {
  const problems = texts.flatMap((text) => [
    ...hashedProblems({ carried, text }),
    ...spelledProblems({ carried, text }),
    ...trailingProblems({ carried, text }),
  ]);
  return [...new Set(problems)];
}

/**
 * The refusal for a step that names a pull request its card would not draw as a chip — a POSTING rule, outside
 * `buildHandStep` (`./step.ts`) for the reason its `linkAsLiteral` gives: the register already holds such rows.
 *
 * The queue card draws every pull request a step names as a citation chip, and a chip needs an address and a
 * spelling the card links (`site/lib/inlineCitations.ts`): every PR number and ticket number is an actual citation chip.
 * MEASURED: 31 of the 64 steps ever posted named a pull request by `#N`, `PR N` or `N PR` and 4
 * carried its address, as `url`. Reproduce over `"$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` with
 * {@link HASHED}, {@link SPELLED} and {@link TRAILING} over `what`, `unblocks` and `where`.
 *
 * A bare number (`merged as 1280`) is outside the criterion: nothing in the step separates it from a count or a
 * year. The card links one only through a repository its row names (`site/lib/cardReferences.ts`), an inference
 * this posting rule deliberately does not lean on — a step carries its addresses. So is a `repo #N` whose repository no carried address
 * names: the card reads it as a bare `#N` by design, so citing another repository's N links that one. And a
 * `#N` written beside a DIFFERENT pull request's raw address stays words on the card while this passes it: an
 * address belongs in `--cites`, never in a step's sentence. This mirrors `site/lib/inlineCitations.ts` by hand,
 * since `src/` may not import `site/`, so it covers the spellings posters write rather than every one the
 * resolver distinguishes: `#N/#N` and a `#N` naming a board row rather than a pull request are further cases it does not model — write `row N`.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when every pull request it names is one its card draws as a chip
 */
export function uncitedNumbers({ step }: { step: HandStep }): HandStepError | undefined {
  const { cites = [], url = "", where = "", ifIgnored = "" } = step;
  // Every address the card carries for this step (`site/lib/cardAddresses.ts`): its url, its cites, and each one
  // its place, its sentences or its settling command spell out.
  const carried: Carried[] = [];
  for (const text of [...cites, url, where, step.what, step.unblocks, ifIgnored, step.witness]) {
    for (const [, owner = "", repo = "", number = ""] of text.matchAll(ADDRESS)) {
      carried.push({ number, owner: owner.toLowerCase(), repo: repo.toLowerCase() });
    }
  }
  const problems = unlinkedNames({ carried, texts: [step.what, step.unblocks, ifIgnored, where] });
  if (problems.length === 0) {
    return undefined;
  }
  return HandStepErrors.invalidField({
    field: "cites",
    why: `names a pull request its queue card may not draw as a chip: ${problems.join("; ")}`,
  });
}
