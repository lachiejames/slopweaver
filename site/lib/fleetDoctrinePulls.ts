/**
 * The doctrine panel's third line: the owner's own open pull requests that no live seat is on.
 *
 * Rule 10 says the fleet clears red CI and lands the owner's pull requests itself, so one of their open pull requests
 * with nobody on it is work the fleet left on the table: four red drafts of the owner's sat unseated while the chair
 * called the board quiet.
 *
 * "The owner's" is GitHub's own open list (`github landing`'s census, drafts included, which the landing rows leave
 * out) by the census's own `viewer` — the login the token read as, which is the owner. A pull request "has a seat" when a seat the
 * same reconcile placed is on a board row naming its URL, or on the board row the landing reading joined its branch
 * to. CI comes only from a landing row with the same URL; a draft the landing rows leave out reads CI not read,
 * never green. Any gap that could hide a seat — a repository's list unread, a placed row whose pull requests did not
 * all read — makes the whole line not read, because a smaller count would be the lie.
 */
import type { LandingCensusPr } from "../components/live/readLanding";
import { boardGapsOf, fleetUnobservedWhyOf, placedIdsOf, unreadSentenceOf, unreadWhysOf } from "./fleetDoctrineGaps";
import type {
  DoctrineBoard,
  DoctrineGroup,
  DoctrineInput,
  DoctrineItem,
  DoctrineLine,
  DoctrineReason,
  DoctrineLanding as Landing,
  DoctrineReconcile as Reconcile,
} from "./fleetDoctrineTypes";
import { countAgedFromOf, LANDING_CADENCE_MINUTES } from "./landingFreshness";

/** One of the owner's open pull requests, with the repository it is in. */
interface HisPr {
  readonly repo: string;
  readonly pr: LandingCensusPr;
}

/** The CI words `github landing` prints: `src/review/reviewState.ts`'s `CiVerdict`, restated since `site/` imports nothing from `src/`. */
const CI_VERDICTS: ReadonlySet<string> = new Set(["green", "red", "running", "none"]);

/** The board joins `github landing` prints: `src/review/landingBoard.ts`'s `LandingBoardRow` kinds, restated likewise. */
const BOARD_JOINS: ReadonlySet<string> = new Set(["row", "none-declared"]);

/** A value the line needs, or why it could not be had. */
type Got<T> =
  { readonly kind: "got"; readonly value: T } | { readonly kind: "unread"; readonly whys: readonly DoctrineReason[] };

/**
 * The line when a reading it stands on did not arrive.
 *
 * @returns the line
 */
function unreadLine({ whys }: { whys: readonly DoctrineReason[] }): DoctrineLine {
  return {
    groups: [],
    key: "pull-requests",
    ...unreadSentenceOf({ reasons: whys, subject: "Your open pull requests with no seat" }),
    tone: "unread",
  };
}

/**
 * The owner's open pull requests off the census, or why they could not be listed.
 *
 * @returns the pull requests, or the reason
 */
function ownerPrsOf({ landing }: { landing: Landing }): Got<readonly HisPr[]> {
  if (landing.census === undefined) {
    return { kind: "unread", whys: ["the landing reading predates GitHub's own open list"] };
  }
  // Every repository whose list did not read is named, never only the first, its reason quoted apart.
  const unread = landing.census.flatMap((repo) =>
    repo.kind === "unread" ? [{ lead: `GitHub's open list for ${repo.repo} did not read`, why: repo.why }] : [],
  );
  if (unread.length > 0) {
    return { kind: "unread", whys: unread };
  }
  const prs: HisPr[] = [];
  for (const repo of landing.census) {
    if (repo.kind === "unread") {
      continue;
    }
    const viewer = repo.viewer.toLowerCase();
    for (const pr of repo.pullRequests) {
      if (pr.author?.toLowerCase() === viewer) {
        prs.push({ pr, repo: repo.repo });
      }
    }
  }
  return { kind: "got", value: prs };
}

/**
 * Every pull request URL a placed seat is on, or why that could not be known.
 *
 * A placed row whose `prUrls` did not read whole, or was not published at all, could name one of the owner's pull requests,
 * so either makes the line not read. Absence is carried as `prUrlsAbsent` beside `prUrls`, which still reads empty
 * for every other board consumer.
 *
 * @returns the URLs, or the reason
 */
function seatedUrlsOf({
  reconcile,
  board,
  landingRows,
}: {
  reconcile: Reconcile;
  board: DoctrineBoard;
  landingRows: Landing["rows"];
}): Got<ReadonlySet<string>> {
  // A reconcile that fell back to the board's open runs never saw a live session, so its placements prove no seat.
  // Session watch is not this line's input: the reconcile reads cmux itself.
  if (reconcile.fleet !== "observed") {
    return { kind: "unread", whys: [fleetUnobservedWhyOf({ reconcile })] };
  }
  const placed = placedIdsOf({ reconcile });
  const placedRows = board.rows.filter((row) => placed.has(row.slug));
  // A seat on a row the board's scan could not reach names pull requests nobody read. A doc's slug is its
  // front-matter's, not its file name (`src/handover/store.ts` reads the two apart), so a doc the scan could not read
  // may be a second row under a slug the board does show, naming a pull request that row does not: with any seat
  // placed, every board gap could change who is seated. With none placed, no
  // doc can add a seat, since a seat comes from the reconcile, never the board. Every seat's row is named, and both
  // kinds together, never only the first found.
  const onTheBoard = new Set(board.rows.map((row) => row.slug));
  const placedIds = [...placed].toSorted();
  const gaps = boardGapsOf({ board });
  const why: string[] = [];
  if (placedIds.length > 0 && gaps.length > 0) {
    const hidden = placedIds.filter((id) => !onTheBoard.has(id));
    const seats = `${placedIds.length === 1 ? "a seat is on" : "seats are on"} ${placedIds.join(", ")}`;
    let shown = ` (the board did not show ${hidden.join(", ")})`;
    if (hidden.length === placedIds.length) {
      shown = ", which the board did not show";
    } else if (hidden.length === 0) {
      shown = "";
    }
    why.push(`${seats}${shown}, and ${gaps.join("; ")}`);
  }
  const partial = placedRows
    .filter((row) => row.prUrlsPartial || row.prUrlsAbsent)
    .map((row) => row.slug)
    .toSorted();
  if (partial.length === 1) {
    why.push(`a seat is on board row ${partial[0]}, and the pull requests it names did not all read`);
  } else if (partial.length > 1) {
    why.push(`seats are on board rows ${partial.join(", ")}, and the pull requests they name did not all read`);
  }
  if (why.length > 0) {
    return { kind: "unread", whys: why };
  }
  const fromRows = placedRows.flatMap((row) => row.prUrls);
  const fromBranches = landingRows
    .filter((row) => row.boardRowSlug !== undefined && placed.has(row.boardRowSlug))
    .map((row) => row.url);
  return { kind: "got", value: new Set([...fromRows, ...fromBranches]) };
}

/**
 * One unseated pull request as an item: where it is, its title, and what is known of it.
 *
 * @returns the item
 */
function itemOf({ owned, ci }: { owned: HisPr; ci: string | undefined }): DoctrineItem {
  const marks: string[] = [];
  if (owned.pr.isDraft) {
    marks.push("draft");
  }
  if (ci === undefined) {
    marks.push("CI not read");
  } else if (ci === "red") {
    marks.push("CI red");
  }
  let text = `${owned.repo}#${String(owned.pr.number)} ${owned.pr.title}`;
  if (marks.length > 0) {
    text = `${text} · ${marks.join(" · ")}`;
  }
  return { href: owned.pr.url, key: owned.pr.url, text };
}

/**
 * The sentence: how many of the owner's open pull requests have no seat, and the drafts and red ones among them.
 *
 * @returns the sentence
 */
function sentenceOf({
  open,
  unseated,
  drafts,
  red,
  ciUnread,
  unchecked,
}: {
  open: number;
  unseated: number;
  drafts: number;
  red: number;
  /** Unseated pull requests whose CI was not read, so the red count is a floor while any remain. */
  ciUnread: number;
  /** Pull requests whether a seat is on was not checked, so the unseated count is a floor while any remain. */
  unchecked: number;
}): string {
  if (open === 0) {
    return "You have no open pull request.";
  }
  const verb = unseated === 1 ? "has no seat on it" : "have no seat on them";
  const of = open === 1 ? "your 1 open pull request" : `your ${String(open)} open pull requests`;
  const tail = unchecked === 0 ? "" : `; whether a seat is on ${String(unchecked)} more was not checked`;
  if (unseated === 0 && unchecked === 0) {
    return `Every one of ${of} has a seat on it.`;
  }
  if (unseated === 0) {
    return `None of the open pull requests looked at is without a seat; whether a seat is on ${String(unchecked)} of ${of} was not checked.`;
  }
  // An unchecked pull request may be unseated, a draft and red, so every count beside one is a floor.
  const atLeast = unchecked === 0 ? "" : "At least ";
  const floor = unchecked === 0 ? "" : "at least ";
  const head = `${atLeast}${String(unseated)} of ${of} ${verb}: ${floor}${String(drafts)} draft`;
  if (ciUnread > 0) {
    return `${head}, at least ${String(red)} with CI red (CI was not read on ${String(ciUnread)})${tail}.`;
  }
  return `${head}, ${floor}${String(red)} with CI red${tail}.`;
}

/**
 * The instant a landing reading passes the landing cadence, so the panel re-reads the clock exactly then rather than
 * on its next tick, which would count a stale census for up to a tick past it.
 *
 * @param reading the landing channel's census and the instant the reading says it was true of GitHub
 * @returns the instant in epoch milliseconds, or undefined when there is no reading or its instant did not read
 */
export function landingStaleAtOf({
  reading,
}: {
  reading: DoctrineInput<{ landing: Landing; observedAtIso: string }>;
}): number | undefined {
  if (reading.kind === "unread") {
    return undefined;
  }
  const agedFromMs = Date.parse(
    countAgedFromOf({ census: reading.value.landing.census, observedAtIso: reading.value.observedAtIso }),
  );
  if (Number.isNaN(agedFromMs)) {
    return undefined;
  }
  return agedFromMs + LANDING_CADENCE_MINUTES * 60_000;
}

/**
 * The landing reading as the line may count it: one no older than the landing cadence, aged from its oldest datum
 * (`countAgedFromOf`). A recorded reading re-reads fine long after GitHub moved on, so a channel that is current
 * by its own staleness rule can still carry an old census, and an older one could have missed a pull request the owner
 * opened since.
 *
 * @param reading the landing channel's census and the instant the reading says it was true of GitHub
 * @param nowMs the instant the page is drawing at
 * @returns the census, or why it is not counted
 */
export function landingInCadenceOf({
  reading,
  nowMs,
}: {
  reading: DoctrineInput<{ landing: Landing; observedAtIso: string }>;
  nowMs: number;
}): DoctrineInput<Landing> {
  if (reading.kind === "unread") {
    return reading;
  }
  const { landing, observedAtIso } = reading.value;
  const staleAtMs = landingStaleAtOf({ reading });
  if (staleAtMs === undefined) {
    return { kind: "unread", why: `the landing reading's instant did not read (${observedAtIso})` };
  }
  // Compared in milliseconds: a whole-minute floor would admit 59 seconds past the cadence.
  const ageMs = nowMs - (staleAtMs - LANDING_CADENCE_MINUTES * 60_000);
  if (nowMs > staleAtMs) {
    return {
      kind: "unread",
      why: `the landing reading is ${String(Math.floor(ageMs / 60_000))}m ${String(Math.floor((ageMs % 60_000) / 1000))}s old, past the ${String(LANDING_CADENCE_MINUTES)}-minute landing cadence`,
    };
  }
  return { kind: "read", value: landing };
}

/**
 * The third line: how many of the owner's open pull requests no seat is on, the drafts and the red ones among them.
 *
 * @returns the line
 */
export function pullRequestsLineOf({
  landing,
  reconcile,
  board,
}: {
  landing: DoctrineInput<Landing>;
  reconcile: DoctrineInput<Reconcile>;
  board: DoctrineInput<DoctrineBoard>;
}): DoctrineLine {
  if (landing.kind === "unread" || reconcile.kind === "unread" || board.kind === "unread") {
    // Every input that did not arrive is named, since each could change the count.
    return unreadLine({ whys: unreadWhysOf({ inputs: [landing, reconcile, board] }) });
  }
  const owned = ownerPrsOf({ landing: landing.value });
  const seated = seatedUrlsOf({ landingRows: landing.value.rows, reconcile: reconcile.value, board: board.value });
  // Both halves are named when both did not read, never only the first found.
  if (owned.kind === "unread" || seated.kind === "unread") {
    const line = unreadLine({ whys: [owned, seated].flatMap((got) => (got.kind === "unread" ? got.whys : [])) });
    if (owned.kind === "unread" || owned.value.length === 0) {
      return line;
    }
    // The owner's open pull requests read, so each one whose seat was not checked is named, never only the gap.
    const ciByUrl = new Map(
      landing.value.rows.filter((row) => CI_VERDICTS.has(row.ci)).map((row) => [row.url, row.ci]),
    );
    const items = owned.value.map((one) => itemOf({ ci: ciByUrl.get(one.pr.url), owned: one }));
    return { ...line, groups: [{ items, label: "yours, open, and whether a seat is on each was not checked" }] };
  }
  // A CI word outside the verb's vocabulary could be red, so it reads as CI not read, never as not red.
  const ciByUrl = new Map(landing.value.rows.filter((row) => CI_VERDICTS.has(row.ci)).map((row) => [row.url, row.ci]));
  // A pull request with no landing row (the rows leave drafts out) has no branch-to-row join, so with any seat placed
  // one could sit on its branch's row while that row names no pull request: whether a seat is on it was not checked.
  // A join of a kind outside the verb's two (`src/review/landingBoard.ts`'s `LandingBoardRow`) reads as
  // no join either, never as the verb saying none. With none placed, nothing can seat it.
  const joined = new Set(landing.value.rows.filter((row) => BOARD_JOINS.has(row.boardRowKind)).map((row) => row.url));
  const anyPlaced = placedIdsOf({ reconcile: reconcile.value }).size > 0;
  const notSeated = owned.value.filter((one) => !seated.value.has(one.pr.url));
  const isUnchecked = (one: HisPr): boolean => anyPlaced && !joined.has(one.pr.url);
  const unseated = notSeated.filter((one) => !isUnchecked(one));
  const unchecked = notSeated.filter((one) => isUnchecked(one));
  const items = unseated.map((one) => itemOf({ ci: ciByUrl.get(one.pr.url), owned: one }));
  const sentence = sentenceOf({
    ciUnread: unseated.filter((one) => ciByUrl.get(one.pr.url) === undefined).length,
    drafts: unseated.filter((one) => one.pr.isDraft).length,
    open: owned.value.length,
    red: unseated.filter((one) => ciByUrl.get(one.pr.url) === "red").length,
    unchecked: unchecked.length,
    unseated: unseated.length,
  });
  const groups: DoctrineGroup[] = [];
  if (items.length > 0) {
    groups.push({ items, label: "yours, open, and no live seat on them" });
  }
  if (unchecked.length > 0) {
    groups.push({
      items: unchecked.map((one) => itemOf({ ci: ciByUrl.get(one.pr.url), owned: one })),
      label: "not checked: no landing row joins its branch to a board row, so a seat on that row was not seen",
    });
  }
  let tone: DoctrineLine["tone"] = "ok";
  if (items.length > 0) {
    tone = "attention";
  } else if (unchecked.length > 0) {
    tone = "unread";
  }
  return { groups, key: "pull-requests", quoted: [], sentence, tone };
}
