/**
 * Which landing rows on the board are about a pull request that has ENDED, and what settles each one.
 *
 * ## The defect
 *
 * `github landing --register` files one ask row per dispatchable OPEN pull request (`../cli/commands/github/
 * landingRegister.ts`), and the read only ever sees open ones — so when a pull request merged or closed, nothing
 * settled its row. MEASURED: a landing row sat `ready` for
 * ten hours after its pull request merged, the fill step seated a session at it, and that session's whole run was
 * finding out; another `ready` row sat beside a GitHub read of MERGED.
 * Reproduce the class: `slopweaver handover list --json` and `jq` every non-terminal row whose slug
 * `isLandingRegistrationSlug` accepts, then `slopweaver github read <its pull request>` each.
 *
 * ## The shape: the census narrows, a per-pull-request read decides
 *
 * The open census (`../live/github/openCensus.ts`) is read on every landing pass anyway, and it is GitHub's own
 * open list, complete or `unread` by construction — so a row whose pull request is absent from a READ census is a
 * candidate at no extra cost. Absence is never the witness, though: the census can race a reopen, and the settle
 * needs what ended it. Each candidate is read on its own (`../live/github/prClosure.ts`) and only a MERGED or
 * CLOSED answer settles, naming the merge commit or the close instant.
 *
 * ## Only a `ready` row nobody is on
 *
 * A row's authored `ready` survives a seat starting on it, so the RUN decides (`LandingBoardRow.run`): only a row
 * whose run never started, or whose run finished its own cycle, is settled here. An active run ends with its own
 * seat, and the settle verb's lessons gate would refuse it anyway; a `paused` row waits on a person, which is a
 * state rather than a countdown; an orphaned or unreadable run is a session's to judge. Each is left, and the
 * outcome says why. A row at an OLDER head of a pull request that is still open is never a candidate: its pull
 * request is in the census.
 *
 * ## `answered`, never `declined`
 *
 * A decline is the owner's, with a reason. A landing row asked that a pull request land; a merge is that ask answered, and a
 * close is the ask answered by the pull request no longer existing to land — both settle `answered`, and the witness
 * says which happened.
 *
 * Pure. No I/O.
 */

import type { RepoCensus } from "../live/github/openCensus.js";
import type { PrClosure } from "../live/github/prClosure.js";
import { isLandingRegistrationSlug, registrationPrefix } from "./boardAtHead.js";
import { boardRowIsTerminal, type LandingBoardRow } from "./landingBoard.js";

/** One landing row whose pull request the open census no longer lists. */
export interface ClosureCandidate {
  readonly slug: string;
  readonly repoSlug: string;
  readonly number: number;
}

/** A row left alone although its pull request is gone from the open list, with the sentence saying why. */
interface ClosureHeld extends ClosureCandidate {
  readonly why: string;
}

/**
 * The repository and pull request number a registration slug names, out of the repositories this read selected.
 *
 * Matched against each selected repository's own {@link registrationPrefix}, never parsed apart on dashes: an
 * `owner/name` holds dashes of its own. Two selected repositories whose kebab runs collide (`a/b-c` and `a-b/c`)
 * leave the slug unattributed rather than guessed.
 *
 * @param slug the board row's slug
 * @param repos the `owner/name`s this read selected
 * @returns the repository and number, or undefined when the slug is not a registration slug of exactly one of them
 */
export function registrationOf({
  slug,
  repos,
}: {
  slug: string;
  repos: readonly string[];
}): { readonly repoSlug: string; readonly number: number } | undefined {
  if (!isLandingRegistrationSlug({ slug })) {
    return undefined;
  }
  const matches = repos.flatMap((repoSlug) => {
    const prefix = registrationPrefix({ repoSlug });
    const tail = slug.startsWith(prefix) ? /^(\d+)-[0-9a-f]+$/.exec(slug.slice(prefix.length)) : null;
    return tail === null ? [] : [{ number: Number(tail[1]), repoSlug }];
  });
  if (matches.length !== 1) {
    return undefined;
  }
  return matches[0];
}

/**
 * Every live landing row of a selected repository whose pull request a READ census no longer lists.
 *
 * A repository whose census is `unread` contributes nothing: an unread list cannot say what is absent from it.
 *
 * @param rows every board row the landing join read, each with its DERIVED status — duplicates across branches
 *   are collapsed by slug
 * @param repos the `owner/name`s this read selected
 * @param census GitHub's open list per selected repository, read on the same pass
 * @returns the `ready` rows to read and settle, and the live ones left to their seat or their person
 */
export function closureCandidates({
  rows,
  repos,
  census,
}: {
  rows: readonly LandingBoardRow[];
  repos: readonly string[];
  census: readonly RepoCensus[];
}): { readonly candidates: readonly ClosureCandidate[]; readonly held: readonly ClosureHeld[] } {
  const open = new Map(
    census.flatMap((one) =>
      one.kind === "read" ? [[one.repo.toLowerCase(), new Set(one.pullRequests.map((pr) => pr.number))] as const] : [],
    ),
  );
  const candidates: ClosureCandidate[] = [];
  const held: ClosureHeld[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.kind !== "row" || seen.has(row.slug) || boardRowIsTerminal({ status: row.status })) {
      continue;
    }
    seen.add(row.slug);
    const named = registrationOf({ repos, slug: row.slug });
    const openHere = named === undefined ? undefined : open.get(named.repoSlug.toLowerCase());
    if (named === undefined || openHere === undefined || openHere.has(named.number)) {
      continue;
    }
    const candidate = { number: named.number, repoSlug: named.repoSlug, slug: row.slug };
    const why = closureHeldWhy({ run: row.run, status: row.status });
    if (why === undefined) {
      candidates.push(candidate);
    } else {
      held.push({ ...candidate, why });
    }
  }
  return { candidates, held };
}

/** The runs a settle may close a row over: none ever started, or one that ended its own cycle. */
const UNATTENDED_RUNS: ReadonlySet<string> = new Set(["never-started", "finished"]);

/**
 * Why a live row whose pull request ended is not this read's to settle, or undefined when it is.
 *
 * The status alone cannot say: a row's authored `ready` survives a seat starting on it, so the RUN is read too, and
 * a row whose run the reader never read is held rather than assumed unattended. Asked twice per settle — over the
 * board snapshot, and over the row re-read once GitHub has answered, since a row can be paused in between.
 *
 * @param status the row's DERIVED status
 * @param run its run's disposition, undefined when nobody read the journal
 * @returns the sentence saying why it is held, or undefined when it may be settled
 */
export function closureHeldWhy({ status, run }: { status: string; run: string | undefined }): string | undefined {
  if (status === "paused") {
    return "it is paused on a person, and that is a state rather than a countdown";
  }
  if (status !== "ready") {
    return `it is ${status}, not ready, so nothing here is sure the row is unattended`;
  }
  if (run === undefined) {
    return "its run was not read, so nothing here is sure the row is unattended";
  }
  if (run === "active" || run === "waiting-on-owner") {
    return `its run is ${run}, and that run ends it`;
  }
  if (!UNATTENDED_RUNS.has(run)) {
    return `its run is ${run}, which a settle would have to judge — left for a session`;
  }
  return undefined;
}

/**
 * The settlement one ended pull request earns, or undefined while GitHub still reads it open.
 *
 * @param closure what GitHub says about the pull request now
 * @returns the `handover settle` witness, naming the merge commit or the close instant
 */
export function closureWitness({ closure }: { closure: PrClosure }): string | undefined {
  if (closure.state === "MERGED") {
    return `${closure.url} merged at ${closure.mergeCommitOid} (${closure.mergedAt})`;
  }
  if (closure.state === "CLOSED") {
    return `${closure.url} closed unmerged at ${closure.closedAt}`;
  }
  return undefined;
}

/**
 * The exact argv one ended row is settled by — the whole command, as array elements.
 *
 * @param slug the row being settled
 * @param witness what {@link closureWitness} named
 * @param home the state home the board lives under, absent to take the ambient one
 * @returns the full argv, `node` and `slopweaver` included
 */
export function closureSettleArgv({
  slug,
  witness,
  home,
}: {
  slug: string;
  witness: string;
  home: string | undefined;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "handover",
    "settle",
    slug,
    "--as",
    "answered",
    "--witness",
    witness,
    ...(home === undefined ? [] : ["--home", home]),
  ];
}
