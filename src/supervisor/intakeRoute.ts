/**
 * Which board rows an `answered` intake mark's witness ROUTES the owner's turn to — so `supervisor intake-mark` carries their
 * words onto each one rather than recording the turn as handled somewhere its author never sees it.
 *
 * ## The defect, measured
 *
 * One `supervisor intake-mark --as answered --witness "<goes to row X>"`
 * call marked 20 of the owner's stretches handled by routing them to a row, and that row's author never saw one of them. The
 * ledger said "answered"; the row said nothing. The fixture holding it down runs with
 * `yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/cli/commands/supervisor/intakeMarkCarry.test.ts`.
 *
 * ## The criterion
 *
 * A witness routes to a row when, wrapping punctuation aside, the whole witness IS a slug the board holds — any
 * slug `isSafeSlug` accepts, hyphenless too (a hyphen rule for the whole witness misses real rows) — or
 * when one of its whitespace-separated tokens is. A token inside prose must carry a `-`: requiring one keeps a plain
 * English word ("done", "main") from resolving a row a session happened to name that way.
 * Prose that names a row counts — "goes to row X" is exactly the incident's shape — which is the opposite choice to
 * `./intakeWitness.ts`'s checkable test on purpose: that one decides whether a reader can FOLLOW a witness, this one
 * whether the witness CLAIMS a row took the turn, and a claim made in prose is still a claim.
 *
 * Pure: a witness and a slug lookup in, the routed slugs out.
 */

import { isSafeSlug } from "../handover/runStore.js";
import { referenceUnwrappings, type SlugLookup } from "./intakeWitness.js";

/** The row a text names, `-` required or not: the most-peeled candidate first, so prose punctuation is shed. */
function rowNamed({
  text,
  slugs,
  needsHyphen,
}: {
  text: string;
  slugs: SlugLookup;
  needsHyphen: boolean;
}): string | undefined {
  return referenceUnwrappings({ text })
    .toReversed()
    .find(
      (candidate) =>
        (!needsHyphen || candidate.includes("-")) && isSafeSlug({ slug: candidate }) && slugs.has(candidate),
    );
}

/**
 * The distinct board rows a witness routes the owner's turn to, in the order the witness first names them. A witness that
 * IS one slug routes to that row whatever its shape; a slug inside prose must carry a `-` to count.
 *
 * @param witness the mark's witness text
 * @param slugs which slugs name a row on the board or in its archive
 * @returns the routed slugs; empty when the witness names no row
 */
export function routedRows({ witness, slugs }: { witness: string; slugs: SlugLookup }): readonly string[] {
  const whole = witness.trim();
  // A witness that is EXACTLY a slug routes to that row before any peeling: `row-v2.` is a legal slug, and peeling
  // first would carry the owner's words onto `row-v2` instead.
  if (isSafeSlug({ slug: whole }) && slugs.has(whole)) {
    return [whole];
  }
  const exact = rowNamed({ needsHyphen: false, slugs, text: whole });
  if (exact !== undefined) {
    return [exact];
  }
  const routed: string[] = [];
  for (const token of whole.split(/\s+/u)) {
    const slug = rowNamed({ needsHyphen: true, slugs, text: token });
    if (slug !== undefined && !routed.includes(slug)) {
      routed.push(slug);
    }
  }
  return routed;
}

/**
 * The command that carries one of the owner's turns onto one row by hand — what `intake-mark` names when it could not.
 *
 * It always names the state home the mark resolved, so run verbatim from any shell it reaches the very row that
 * refused — whatever `$SLOPWEAVER_HOME` that shell holds, and whether or not the mark was given `--home`.
 *
 * @param slug the row the witness routes to
 * @param pointer the turn being marked
 * @param home the state home the mark resolved, shell-quoted when it needs to be
 * @returns the exact command line
 */
export function carryCommand({ slug, pointer, home }: { slug: string; pointer: string; home: string }): string {
  // Every argument is one shell word: a `talk-call:` segment id may legally hold `;`.
  const [row, turn, at] = [slug, pointer, home].map((text) => shellWord({ text }));
  return `slopweaver handover quote ${row} --add-steer ${turn} --apply --home ${at}`;
}

/**
 * One POSIX shell word: bare when every character is literal where it stands, else single-quoted. A `#` is literal
 * mid-word, so a `transcript:<session>#<turn>` pointer stays bare; at a word's start it opens a comment, and a leading
 * `=` expands in zsh, so neither may lead a bare word.
 */
function shellWord({ text }: { text: string }): string {
  if (/^[\w@%+:,./-][\w@%+=:,./#-]*$/u.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
