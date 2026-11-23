/**
 * The read an act card takes BY BRANCH when it opens: the pull request a finding act opened, merged or not.
 *
 * A finding card names the pull request, a link and what it did; the ledger row has the run slug, and the PR is
 * on the branch. The landing reading joins an OPEN pull request on every card (`./queueCardAct.ts`
 * `actPullRequests`), but a finding lands fast: MEASURED, both finding cards in one ask had merged before anyone
 * reacted, and a merged pull request is in no reading the console polls. So the card asks GitHub, once, when it opens.
 *
 * Two verbs, through the same door as `./threadVerb.ts`: a literal argv, the slot checked against a strict
 * shape first. `github search "is:pr head:<branch>"` finds candidates, but GitHub's `head:` qualifier is a
 * TOKEN match, not an exact one — MEASURED, `is:pr head:codex` matched 20 pull requests — and the
 * search answer carries no head branch. So each candidate is read with `github pr summary`, and only a pull
 * request whose `headRefName` IS the branch is kept. That read also carries the pull request's CURRENT title,
 * where it stands, and its own Problem, Risk and Blast radius cells parsed out of its description — what the card
 * draws instead of a register's absence sentences, which read as boilerplate. Pure: argv out, payloads in, an answer out; the route spawns.
 *
 * **The repository is this install's own, never a constant.** The finding gate calls a door internal only when
 * the pull request is on the installed tree's own `origin` (`src/cli/commands/github/findingRulingGate.ts`
 * `isThisInstallsOwnRepository`), so the search names no `--repo`. The route runs it FROM the checkout whose
 * `bin/slopweaver` runs (`./spawnVerb.ts` `atCheckoutRoot`), so `github search` resolves that tree's own
 * `origin` — the gate's `installedTreeRoot`, by construction rather than by where the server was started — and
 * refuses one that is not a declared checkout's. The answer prints which repository it
 * searched, and every address after that is checked against it — on a fork, an upstream pull request sharing
 * the branch name is refused rather than drawn.
 */

import { type Bag, bags, isBag, num, str, sub } from "./bag";
import type { PullForm, PullLifecycle, ReadPullRequest } from "./findingActCard";

/** How many search candidates are read for their head branch; the rest are counted, never guessed at. */
export const ACT_PULL_CANDIDATES = 5;

/**
 * One search plus up to {@link ACT_PULL_CANDIDATES} reads, run side by side. MEASURED:
 * `time slopweaver github search "is:pr head:the-hands-card-on-the-queue-page-shows-no-command-to-paste" --repo lachiejames/slopweaver --json`
 * took 2.8s, and each `github read` of one pull request is one GraphQL call of the same order.
 */
export const ACT_PULL_TIMEOUT_MS = 30_000;

/** A branch name as a finding row's slug spells one — the board's own slug alphabet, never a flag. */
const BRANCH_SHAPE = /^[A-Za-z0-9]+(?:[-._][A-Za-z0-9]+)*$/;

/**
 * An `owner/name` repository as GitHub spells one — nothing a path segment or a query could hide in. The owner
 * admits `_` for an Enterprise Managed User (`mona-cat_octo`), and any run of hyphens, which legacy accounts
 * still carry; it is a sanity bound on the route's own answer, never a stricter spelling than GitHub serves.
 */
const REPO_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9._-]+$/;

/** A pull request's address, the repository and the number captured. */
const PULL_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([0-9]+)$/;

/**
 * Is this an `owner/name` repository the lookup may be scoped to? GitHub caps an owner at 39 characters and a
 * name at 100, and `.` and `..` fit the alphabet but name a path, never a repository.
 *
 * @returns true for a well-shaped slug
 */
export function isActPullRepo({ repo }: { repo: string }): boolean {
  if (!REPO_SHAPE.test(repo)) {
    return false;
  }
  const [owner, name] = repo.split("/");
  return owner.length <= 39 && name.length <= 100 && name !== "." && name !== "..";
}

/**
 * The repository a pull request's address names, when it is a pull request on `repo`. GitHub matches owner and
 * name case-insensitively, and the searched slug is the `origin` remote's spelling while an address is GitHub's,
 * so the comparison is too. A string comparison rather than a pattern built from `repo`, so nothing in a slug
 * can act as a pattern character.
 *
 * @param repo the repository the search was scoped to
 * @returns the address's own `owner/name`, or `undefined` when `repo` is not a slug or the address is not a
 *   pull request on it
 */
function pullRepoOf({ url, repo }: { url: string; repo: string }): string | undefined {
  const matched = PULL_URL.exec(url);
  if (matched === null || !sameActPullRepo({ left: matched[1], right: repo })) {
    return undefined;
  }
  return matched[1];
}

/**
 * Are these the same repository, as GitHub compares one? Both must be slugs FIRST: the alphabet is ASCII, and
 * JavaScript's lowercasing folds non-ASCII letters onto ASCII ones — the compatibility letter U+212A `K` becomes `k` — so a
 * case-insensitive comparison of an unchecked string would admit an alias GitHub never would.
 *
 * @returns true when both are slugs naming the same repository
 */
function sameActPullRepo({ left, right }: { left: string; right: string }): boolean {
  return isActPullRepo({ repo: left }) && isActPullRepo({ repo: right }) && left.toLowerCase() === right.toLowerCase();
}

/** What building one argv came to. */
export type ActPullArgv =
  | { readonly kind: "argv"; readonly argv: readonly string[]; readonly title: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * The `github search` argv for the pull requests opened from one branch, or the refusal. It names no `--repo`,
 * so the verb searches the serving checkout's own `origin` — the header says why.
 *
 * @param branch the act's board slug, which names the branch its seat opened the pull request from
 * @returns the literal argv, or why the branch was refused
 */
export function actPullSearchArgv({ branch }: { branch: string }): ActPullArgv {
  if (branch.length > 200 || !BRANCH_SHAPE.test(branch)) {
    return { kind: "refused", why: `${branch} is not a branch name the console looks a pull request up by` };
  }
  const argv = ["github", "search", `is:pr head:${branch}`, "--json"];
  return { argv, kind: "argv", title: `slopweaver github search "is:pr head:${branch}" --json` };
}

/**
 * The `github pr summary` argv for one candidate, or the refusal.
 *
 * @param url the candidate's address, as the search printed it
 * @param repo the repository the search answered that it searched
 * @returns the literal argv, or why the address was refused
 */
export function actPullReadArgv({ url, repo }: { url: string; repo: string }): ActPullArgv {
  if (pullRepoOf({ repo, url }) === undefined) {
    return { kind: "refused", why: `${url} is not a pull request on ${repo}` };
  }
  const argv = ["github", "pr", "summary", url, "--json"];
  return { argv, kind: "argv", title: `slopweaver ${argv.join(" ")}` };
}

/** One search match the route reads for its head branch. */
export interface ActPullCandidate {
  readonly url: string;
  readonly number: number;
  readonly title: string;
}

/**
 * The pull-request matches out of a `github search --json` answer, how many GitHub counted past the page, and
 * the repository the verb resolved and searched.
 *
 * @param payload the parsed answer
 * @returns the matches in the search's order, the count beyond them and the searched repository, or
 *   `undefined` when the answer is not the verb's shape
 */
export function actPullCandidates({
  payload,
}: {
  payload: unknown;
}): { readonly candidates: readonly ActPullCandidate[]; readonly beyond: number; readonly repo: string } | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const matches = bags({ bag: payload, key: "matches" });
  const totalCount = num({ bag: payload, key: "totalCount" });
  const repo = str({ bag: payload, key: "repo" });
  if (matches === undefined || totalCount === undefined || repo === undefined || !isActPullRepo({ repo })) {
    return undefined;
  }
  const out: ActPullCandidate[] = [];
  for (const match of matches) {
    const number = num({ bag: match, key: "number" });
    const title = str({ bag: match, key: "title" });
    const url = str({ bag: match, key: "url" });
    if (number === undefined || title === undefined || url === undefined) {
      return undefined;
    }
    if (match["kind"] === "pull-request") {
      out.push({ number, title, url });
    }
  }
  return { beyond: Math.max(0, totalCount - matches.length), candidates: out, repo };
}

/** The four lifecycle words `github pr summary` prints. */
const LIFECYCLES: readonly PullLifecycle[] = ["open", "draft", "merged", "closed"];

/**
 * A pull request's description cells out of its summary, or `undefined` when they are not the verb's shape.
 *
 * @returns the form
 */
function pullFormOf({ bag }: { bag: Bag }): PullForm | undefined {
  const form = sub({ bag, key: "form" });
  if (form === undefined) {
    return undefined;
  }
  if (form["kind"] === "declined") {
    const reason = str({ bag: form, key: "reason" });
    if (reason === undefined) {
      return undefined;
    }
    return { kind: "declined", reason };
  }
  const problem = str({ bag: form, key: "problem" });
  const risk = str({ bag: form, key: "risk" });
  const blastRadius = str({ bag: form, key: "blastRadius" });
  if (form["kind"] !== "parsed" || problem === undefined || risk === undefined || blastRadius === undefined) {
    return undefined;
  }
  return { blastRadius, kind: "parsed", problem, risk };
}

/**
 * One read pull request out of a bag shaped like `github pr summary --json` — the verb's own answer, and each
 * pull the route hands on.
 *
 * @returns the pull request, or `undefined` when a field is missing, not its shape, or not on `repo`
 */
function readPullOf({ bag, repo }: { bag: Bag; repo: string }): ReadPullRequest | undefined {
  const number = num({ bag, key: "number" });
  const title = str({ bag, key: "title" });
  const url = str({ bag, key: "url" });
  const headRefName = str({ bag, key: "headRefName" });
  const readAtIso = str({ bag, key: "readAtIso" });
  const state = LIFECYCLES.find((word) => word === bag["state"]);
  const form = pullFormOf({ bag });
  const merged = bag["mergedAt"];
  const mergedAtShaped = merged === undefined || merged === null || typeof merged === "string";
  const fields = [number, title, url, headRefName, readAtIso, state, form];
  if (fields.includes(undefined) || !mergedAtShaped) {
    return undefined;
  }
  const repoSlug = pullRepoOf({ repo, url: url! });
  if (repoSlug === undefined) {
    return undefined;
  }
  let mergedAt: string | undefined;
  if (typeof merged === "string") {
    mergedAt = merged;
  }
  return {
    boardRowSlug: undefined,
    form: form!,
    headRefName: headRefName!,
    mergedAt,
    number: number!,
    readAtIso: readAtIso!,
    repoSlug,
    state: state!,
    title: title!,
    url: url!,
  };
}

/** One candidate as the verb read it, and whether its head branch lives in a fork. */
export interface ActPullRead {
  readonly pull: ReadPullRequest;
  /** A fork's head can carry any branch name, so a fork is never the act's own pull request. */
  readonly crossRepository: boolean;
}

/**
 * One candidate out of a `github pr summary --json` answer.
 *
 * @param payload the parsed answer
 * @param repo the repository the search answered that it searched
 * @returns the read pull request and where its head lives, or `undefined` when the answer is not the verb's
 *   shape or not a pull request on `repo`
 */
export function actPullRead({ payload, repo }: { payload: unknown; repo: string }): ActPullRead | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const crossRepository = payload["crossRepository"];
  const pull = readPullOf({ bag: payload, repo });
  if (pull === undefined || typeof crossRepository !== "boolean") {
    return undefined;
  }
  return { crossRepository, pull };
}

/**
 * The route's answer: the pull requests opened from the branch, the repository searched, and how many
 * candidates went unchecked.
 */
export type ActPullResult =
  | {
      readonly ok: true;
      readonly observedAtIso: string;
      /** The `owner/name` the search resolved — this install's own `origin` — which every pull must be on. */
      readonly repo: string;
      readonly pulls: readonly ReadPullRequest[];
      /** Search matches that were not read — past {@link ACT_PULL_CANDIDATES}, or past the search's page — so none was ruled out. */
      readonly unchecked: number;
    }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * Keep the read candidates whose head branch IS the branch on this repository — each as the READ says it, so
 * its title is the pull request's current one rather than the search's. A fork's head sharing the name is read,
 * so it is not unchecked, and ruled out.
 *
 * @param branch the branch looked up
 * @param candidates every pull-request match, in the search's order
 * @param reads each READ candidate, in the same order — shorter than `candidates` past the cap
 * @param beyond matches GitHub counted past the search's page, which were never candidates at all
 * @returns the exact pull requests, and how many matches went unread
 */
export function exactActPulls({
  beyond,
  branch,
  candidates,
  reads,
}: {
  beyond: number;
  branch: string;
  candidates: readonly ActPullCandidate[];
  reads: readonly ActPullRead[];
}): { readonly pulls: readonly ReadPullRequest[]; readonly unchecked: number } {
  const pulls = reads
    .filter((read) => !read.crossRepository && read.pull.headRefName === branch)
    .map((read) => read.pull);
  return { pulls, unchecked: Math.max(0, candidates.length - reads.length) + beyond };
}

/** The card's view of one lookup. `idle` is an act with nothing to look up. */
export type ActPullState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly branch: string }
  | { readonly phase: "not-measured"; readonly branch: string; readonly why: string }
  | {
      readonly phase: "ready";
      readonly branch: string;
      readonly pulls: readonly ReadPullRequest[];
      readonly unchecked: number;
      /** Why the latest re-read failed, when this is the earlier answer kept over it (`../components/console/useActPull.ts`). */
      readonly stale?: { readonly why: string };
    };

/**
 * Read the route's answer into the card's state, refusing any shape that is not the route's own.
 *
 * @param body the parsed response
 * @param branch the branch the card asked about
 * @returns the state
 */
export function actPullStateOf({ body, branch }: { body: unknown; branch: string }): ActPullState {
  if (!isBag(body)) {
    return { branch, phase: "not-measured", why: "/api/act-pull answered something that is not its own shape" };
  }
  if (body["ok"] !== true) {
    let why = "/api/act-pull refused and gave no reason";
    const stated = str({ bag: body, key: "notMeasured" });
    if (stated !== undefined) {
      why = stated;
    }
    return { branch, phase: "not-measured", why };
  }
  const answered = bags({ bag: body, key: "pulls" });
  const unchecked = num({ bag: body, key: "unchecked" });
  if (answered === undefined || unchecked === undefined || !Number.isInteger(unchecked) || unchecked < 0) {
    return { branch, phase: "not-measured", why: "/api/act-pull answered without its pull requests" };
  }
  const repo = str({ bag: body, key: "repo" });
  if (repo === undefined || !isActPullRepo({ repo })) {
    return { branch, phase: "not-measured", why: "/api/act-pull answered without the repository it searched" };
  }
  const pulls: ReadPullRequest[] = [];
  for (const answer of answered) {
    const pull = readPullOf({ bag: answer, repo });
    // The route stamps each pull's repository off its address; one that names another disagrees with itself.
    const stamped = str({ bag: answer, key: "repoSlug" });
    if (pull === undefined || stamped === undefined || !sameActPullRepo({ left: stamped, right: pull.repoSlug })) {
      return {
        branch,
        phase: "not-measured",
        why: `/api/act-pull answered a pull request missing its fields, or not on ${repo}`,
      };
    }
    // The route keeps only exact heads; this re-checks it, so a pull from another branch can never pass as one.
    if (pull.headRefName !== branch) {
      return {
        branch,
        phase: "not-measured",
        why: `/api/act-pull answered ${pull.url}, which is not from branch ${branch}`,
      };
    }
    pulls.push(pull);
  }
  return { branch, phase: "ready", pulls, unchecked };
}
