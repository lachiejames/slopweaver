/**
 * PULL-REQUEST REFERENCES IN A RECORDED QUESTION, and whether the canonical remote still knows them.
 *
 * ## The defect this exists for, stated so nobody re-derives it
 *
 * The owner stopped reading the list at row 3 once. Rows 1 and 2 cited pull-request numbers that
 * are pull requests in the DEAD personal remote this project used to live in. The canonical repository is
 * `lachiejames/slopweaver` and its numbering is nowhere near those, so such a number resolves to nothing there. The
 * rows were read out of run journals written in the old lineage, and nothing between the journal and the owner's
 * screen noticed that the numbers had stopped meaning anything.
 *
 * A row citing a pull request that does not exist is worse than a row with no citation, because the number
 * reads as evidence. So an unresolvable reference makes the row UNVERIFIED and says which reference could
 * not be resolved. It never silently drops the row and it never quietly rewrites the number.
 *
 * ## Extraction is deliberately conservative
 *
 * Only a bare `#<digits>` is treated as a reference to the canonical repository. A fully-qualified
 * `owner/repo#<digits>` or a URL names its own repository and is not this module's business, and a number that
 * is part of a word is not a reference at all. Over-matching here would mark good rows unverified, which
 * costs exactly the trust this is trying to protect.
 *
 * Pure — no I/O. The live resolution is {@link ../cli/commands/sessionStart/verifyRefs}.
 */

import { absentAs } from "#lib/absent.js";

import type { Organisation } from "../organisation/core.js";

/**
 * The most digits a bare `#` token may carry and still be read as a pull request.
 *
 * MEASURED on both repositories this list covers
 * (`slopweaver pane pr-status --json --pr-repos acme/acme-admin,lachiejames/slopweaver`): the highest
 * live acme-admin number is five digits, and slopweaver is in the hundreds. Six digits or more is a
 * hex colour or an identifier, never a pull request here — a six-digit hex colour was the case that proved it, and
 * without this bound it read as a reference and would have marked a good row unverified over a colour.
 *
 * Revisit if acme-admin ever passes five digits. Until then this is a bound, not a guess.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const MAX_REF_DIGITS = 5;

/**
 * A bare `#<digits>` that is not part of a larger token.
 *
 * The leading boundary rejects `owner/repo#<digits>` and `SUP-1#2`; the trailing one rejects `#<digits>abc` and, via
 * {@link MAX_REF_DIGITS}, a six-digit hex colour. All three were chosen to under-match rather than
 * over-match, for the reason in the module header: a row wrongly marked unverified costs the same trust the
 * check is protecting.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const BARE_REF = new RegExp(`(^|[\\s(\\[,;:])#(\\d{1,${String(MAX_REF_DIGITS)}})(?![\\w#/-])`, "g");

/**
 * Every bare pull-request reference in a piece of text, deduplicated, in first-seen order.
 *
 * @param text the item's recorded question
 * @returns the referenced numbers, as they were written
 */
export function bareRefs({ text }: { text: string }): readonly number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const match of text.matchAll(BARE_REF)) {
    const value = Number(match[2]);
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * The GitHub slug a local checkout's directory name maps to: the organisation's own repositories and this build's
 * own, keyed by the repository name — exactly one match, or none.
 *
 * A doc's `repo:` field is a filesystem path, and a bare `#<digits>` in its recorded question means a pull
 * request in THAT repository. Resolving every reference against one repository instead is what produced two
 * false "does not exist" flags on team-repository rows the first time this check ran — a false stale flag costs
 * the same trust as the stale row it was written to catch.
 *
 * Keyed on basename rather than the whole path because the same repository sits at different paths in a
 * worktree, a clone and the main checkout. A basename matching no repository, or two of them (`a/web` and
 * `b/web`), resolves nothing and the row's references are left unchecked, which is the honest answer rather
 * than a guess at the owner.
 *
 * @param organisation the organisation, read once by the caller's edge (`../organisation/read.ts`)
 * @param name the checkout directory's own name
 * @returns the `owner/name` slug, or undefined when no single repository has that name
 */
function slugForDirectory({ organisation, name }: { organisation: Organisation; name: string }): string | undefined {
  const known = [...new Set([...organisation.repositories, organisation.selfRepository])];
  const matches = known.filter((slug) => slug.split("/").at(1) === name.toLowerCase());
  if (matches.length !== 1) {
    return undefined;
  }
  return matches[0];
}

/**
 * The GitHub repository a row's bare references belong to, from either spelling an item carries.
 *
 * **A slug is taken as itself; only a PATH goes through the directory lookup.** The lookup exists because a
 * filesystem path names no owner, so mapping one is the only way to get a repository out of it. A slug already
 * names its owner exactly, and putting it through the basename lookup anyway is a live defect rather than a
 * harmless extra hop: `someone-else/acme-admin` has the basename `acme-admin`, so it would resolve to the
 * organisation's `acme-admin` and the references would be read against a repository they were never written
 * for — the exact class this module exists to prevent. The GitHub leg has always passed a slug
 * (`../sessionStart/githubLeg.ts`'s `repo: state.repoSlug`), so that hop was already happening.
 *
 * The discriminator is a leading `/` or `~`. The bound that leaves, stated rather than discovered: a RELATIVE
 * two-segment path would be read as a slug. No producer in this tree emits one — a doc's `repo:` field is
 * absolute — but that is a bound, not a proof.
 *
 * @param organisation the organisation whose repositories a checkout path is named against
 * @param repoPath the item's own `repo` field — an absolute checkout path or an `owner/name` slug
 * @returns the `owner/name` slug, or undefined when nothing here can name it
 */
export function repoSlugFor({
  organisation,
  repoPath,
}: {
  organisation: Organisation;
  repoPath: string | undefined;
}): string | undefined {
  if (repoPath === undefined) {
    return undefined;
  }
  const trimmed = repoPath.replace(/\/+$/, "");
  const segments = trimmed.split("/");
  const isPath = trimmed.startsWith("/") || trimmed.startsWith("~");
  if (!isPath && segments.length === 2 && segments.every((segment) => segment.length > 0)) {
    return trimmed;
  }
  const name = segments.at(-1);
  if (name === undefined) {
    return undefined;
  }
  return slugForDirectory({ name, organisation });
}

/**
 * What a live resolution found about one referenced number.
 *
 * `resolved` and `settled` are both "the repository knows this number" — they are split because knowing it
 * is not the interesting fact. A row whose only reference has already merged is a row about finished work,
 * and collapsing the two is exactly how a merged pull request with 21 checks passed reached the owner's list the day after it merged.
 */
type RefVerdict = "not-checked" | "resolved" | "settled" | "unknown-to-canonical";

/** One reference and what became of it. */
export interface RefResolution {
  readonly number: number;
  readonly verdict: RefVerdict;
  /**
   * The provider's own word for the pull request's state — `OPEN`, `CLOSED` or `MERGED`.
   *
   * Carried verbatim rather than reduced to the verdict, so the clause a row shows names what GitHub said
   * instead of this module's paraphrase of it. Absent whenever nothing was read.
   */
  readonly state?: string;
}

/**
 * The clause a row shows when one of its references does not exist in the canonical repository.
 *
 * Names the repository as well as the number, because the whole failure was a number that was real
 * somewhere else. A reader who is told only "the number could not be resolved" will go and look for it.
 *
 * @param resolutions what the live check found for each reference
 * @param repo the canonical repository the references were checked against
 * @returns the clause, or undefined when every reference resolved or none was checked
 */
export function staleRefReason({
  resolutions,
  repo,
}: {
  resolutions: readonly RefResolution[];
  repo: string;
}): string | undefined {
  const missing = resolutions.filter((one) => one.verdict === "unknown-to-canonical");
  if (missing.length === 0) {
    return undefined;
  }
  const numbers = missing.map((one) => `#${String(one.number)}`).join(", ");
  return `${numbers} ${missing.length === 1 ? "does" : "do"} not exist in ${repo}, so this row was written against an older repository and its numbers do not mean what they say`;
}

/**
 * The clause a row shows when every pull request it names has already merged or closed.
 *
 * ## Why this needs EVERY reference settled rather than any of them
 *
 * A recorded question that names three pull requests, one of them still open, is still a live question — it
 * is only the ones whose whole subject has landed that stop being the owner's move. Firing on any single settled
 * reference would drop a row for the one part of it that finished, which is the same class of wrongness as
 * showing a finished row: the owner cannot tell from the list which happened.
 *
 * A reference nobody could check counts as unsettled for the same reason `refVerdict` refuses to read an
 * expired token as a missing pull request — an unread reference establishes nothing, and nothing is not
 * "done".
 *
 * @param resolutions what the live check found for each reference
 * @param repo the canonical repository the references were checked against
 * @returns the clause, or undefined when any reference is still open or was never read
 */
export function settledRefsReason({
  resolutions,
  repo,
}: {
  resolutions: readonly RefResolution[];
  repo: string;
}): string | undefined {
  if (resolutions.length === 0 || !resolutions.every((one) => one.verdict === "settled")) {
    return undefined;
  }
  const named = resolutions
    .map((one) => `#${String(one.number)} is ${absentAs({ value: one.state, whenAbsent: "settled" })}`)
    .join(", ");
  const subject = resolutions.length === 1 ? "the pull request" : "every pull request";
  return `${named} in ${repo}, so ${subject} this row asks about is already finished`;
}
