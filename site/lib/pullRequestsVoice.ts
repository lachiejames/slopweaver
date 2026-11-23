/**
 * What the pull-request page hands the console voice when it calls `read_page`.
 *
 * The page draws the cards under the state its selector is on (`./prViews.ts`) and registers
 * {@link pullRequestsForVoice} over exactly those cards, so the count the voice reads out is the count on the
 * owner's screen. A page that registers no reading leaves the model answering from `action_items`, a different list:
 * the voice said "looks like there's six open PRs" while the page drew 38.
 *
 * What is stale leads — a reading whose latest read failed, which the page draws as the last one that answered,
 * marked — then GitHub's own open count — `openOnGithub`, never the rows' total, which
 * is scoped to the owner's author and the reading's drafts flag — then the verb's tally, the state on
 * screen, the open PR, and the cards follow in draw order, then the residue. `pageRead` cuts at 16 KiB from the END, so a cut costs trailing cards and never the
 * tally; 38 rows and an open PR measure well inside it (`pullRequestsVoice.test.ts` asserts no cut).
 */
import type { Landing, LandingRow } from "../components/live/readLanding";
import { type Reviewers, reviewerRowFor } from "../components/live/readReviewers";
import { checkRequirementWord, landingCiWord } from "./landingCi";
import { type CensusPicture, inlineNumbersOf } from "./pullRequestCensus";
import { reasonTextOf } from "./quotedReason";
import { prPlacement } from "./registerPlacementDirect";
import { type AgoWords, askLineOf, drawnWaitOf, suggestionHeld } from "./reviewHook";
import { personLabel, type SlackPeople } from "./slackPeople";
import type { WorkspacePlacer } from "./workspacePlacement";
import { findingLabel } from "./workspacePlacementContext";

/** The voice reads an instant as the instant — it words its own ages, and a page's "3h ago" would be stale. */
const asIso: AgoWords = (iso) => iso;

/** A reading the page draws over a failed read of it: which, why the latest read failed, and when it was taken. */
export interface StaleReadingForVoice {
  readonly reading: string;
  readonly why: string;
  readonly readingFromIso: string;
}

/** One row as the voice reads it: enough to name it and say what is next, no more. */
interface RowForVoice {
  readonly pr: string;
  readonly title: string;
  readonly next: string;
  readonly ci: string;
  readonly author: string;
  /** The verb's one-line wait on a row held by a human — who, since when, last nudge, stale, next. */
  readonly wait: string | undefined;
  /** The workspace mark the row wears on the page — a repository outside the organisation — or `undefined`. */
  readonly mark: { readonly label: string; readonly title: string } | undefined;
  /** Who it is on the hook with — the ask line the row draws, names resolved. */
  readonly hook: string;
  /** The suggested reviewer and the sentence it rests on, or who the owner picked, when the reviewer reading says. */
  readonly suggested: string | undefined;
}

/** The pull request the owner has open, with every fact the panel prints about it. */
interface OpenForVoice {
  readonly pr: string;
  readonly title: string;
  readonly url: string;
  readonly author: string;
  readonly draft: boolean;
  readonly branch: string;
  readonly next: string;
  readonly nextDetail: string;
  readonly ci: string;
  readonly verdict: string | undefined;
  readonly dispatchWhy: string | undefined;
  readonly wait: string | undefined;
  readonly blockedOn: readonly string[];
  readonly boardRow: string;
  readonly tests: readonly string[];
  readonly checksNotGreen: readonly string[];
  readonly waitingOn: readonly string[];
  readonly humanThreadsOpen: number;
  readonly codeRabbitThreadsOpen: number;
  /** The workspace mark the row wears on the page — a repository outside the organisation — or `undefined`. */
  readonly mark: { readonly label: string; readonly title: string } | undefined;
}

/**
 * The reading `read_page` returns on the pull-request page.
 *
 * @param landing the verb's reading the page is drawing
 * @param view the state the selector is on, with the words and count it prints
 * @param rows the cards drawn under that state, in draw order
 * @param hiddenByContext rows the work-context switch is hiding
 * @param open the row whose panel is open, if any
 * @param reviewers the reviewer reading, when it has answered
 * @param census the owner's open count on GitHub in this context, exactly as the page's headline prints it
 * @param readyHere the rows ready to press in this context
 * @param stale every reading the page draws over a failed read of it — the ledger's, the reviewer suggestions' — with
 *   why and when it was taken, so the voice says what is not the latest, as the marks beside them do
 * @param placer the organisation's address readers, which mark a row placed in neither workspace
 * @returns the stale readings, GitHub's count and the tally first, then the state on screen, the open row, then every
 *   drawn card
 */
export function pullRequestsForVoice({
  landing,
  view,
  rows,
  hiddenByContext,
  open,
  reviewers,
  census,
  readyHere,
  stale,
  placer,
}: {
  placer: WorkspacePlacer;
  landing: Landing;
  view: { readonly key: string; readonly label: string; readonly count: number | undefined };
  rows: readonly LandingRow[];
  readyHere: number;
  hiddenByContext: number;
  open: LandingRow | undefined;
  reviewers: Reviewers | undefined;
  census: CensusPicture;
  stale: readonly StaleReadingForVoice[];
}): {
  readonly stale: readonly StaleReadingForVoice[];
  readonly openOnGithub: CensusForVoice;
  readonly rowsInReading: number;
  readonly readyToPress: number;
  readonly hiddenByContext: number;
  readonly view: { readonly key: string; readonly label: string; readonly count: number | undefined };
  readonly drawn: number;
  readonly open: OpenForVoice | undefined;
  readonly rows: readonly RowForVoice[];
  readonly residue: readonly string[];
} {
  let people: SlackPeople = landing.people;
  if (reviewers !== undefined) {
    people = new Map([...reviewers.people, ...landing.people]);
  }
  let opened: OpenForVoice | undefined;
  if (open !== undefined) {
    opened = openForVoice({ placer, row: open, wait: waitForVoice({ people, reviewers, row: open }) });
  }
  return {
    stale,
    openOnGithub: censusForVoice({ picture: census }),
    rowsInReading: landing.total,
    readyToPress: readyHere,
    hiddenByContext,
    view,
    drawn: rows.length,
    open: opened,
    rows: rows.map((row) => ({
      author: row.authorLogin,
      ci: landingCiWord({ row }),
      hook: hookForVoice({ people, row }),
      mark: markOf({ placer, row }),
      next: row.action,
      pr: prNameOf({ row }),
      suggested: suggestedForVoice({ people, reviewers, row }),
      title: row.title,
      wait: waitForVoice({ people, reviewers, row }),
    })),
    residue: landing.residue,
  };
}

/**
 * The owner's open count on GitHub as the badge says it, the other authors' count beside it, and every reason one of
 * the owner's is not placed — the count and the first few numbers per reason, never the whole list: `pageRead` cuts at 16 KiB.
 */
type CensusForVoice =
  | { readonly notMeasured: string }
  | {
      readonly open: number;
      readonly authorFilter: string | undefined;
      readonly otherAuthors: number;
      readonly repos: readonly string[];
      readonly placed: number;
      readonly notPlaced: number;
      readonly closedSince: number;
      readonly why: readonly { readonly count: number; readonly because: string; readonly numbers: string }[];
    };

/** The page's census picture, bounded for the voice. */
function censusForVoice({ picture }: { picture: CensusPicture }): CensusForVoice {
  if (picture.kind === "unavailable") {
    // The voice words its reading for the owner, so it takes the one string (`reasonTextOf`).
    return { notMeasured: reasonTextOf({ reason: picture.why }) };
  }
  const multiRepo = picture.repos.length > 1;
  return {
    authorFilter: picture.authorFilter,
    closedSince: picture.closedSince,
    notPlaced: picture.notPlaced.length,
    open: picture.open,
    otherAuthors: picture.otherAuthors,
    placed: picture.placed,
    repos: picture.repos,
    why: picture.byReason.map((group) => ({
      because: group.sentence,
      count: group.prs.length,
      numbers: inlineNumbersOf({ multiRepo, prs: group.prs }),
    })),
  };
}

/** The row's ask line as words: who was asked and where, or why nobody is named. */
function hookForVoice({ row, people }: { row: LandingRow; people: SlackPeople }): string {
  const line = askLineOf({ ago: asIso, people, row });
  if (line.kind === "shared" && line.again !== undefined && line.note !== undefined) {
    return `${line.text}; ${line.again.text}: ${line.note}`;
  }
  if (line.kind !== "asked") {
    return line.text;
  }
  return `asked ${line.who.map((who) => who.text).join(", ")} ${line.text}`;
}

/** The row's wait as the page draws it: the verb's own, or the ask a pick the owner approved since supersedes it. */
function waitForVoice({
  row,
  people,
  reviewers,
}: {
  row: LandingRow;
  people: SlackPeople;
  reviewers: Reviewers | undefined;
}): string | undefined {
  let picked: { readonly reviewer: string } | undefined;
  if (reviewers !== undefined) {
    picked = reviewerRowFor({ number: row.number, repoSlug: row.repoSlug, reviewers })?.picked;
  }
  return drawnWaitOf({ people, picked, row })?.sentence;
}

/** The reviewer reading's word on the row: a pick not yet asked, or a suggestion with its basis. */
function suggestedForVoice({
  row,
  people,
  reviewers,
}: {
  row: LandingRow;
  people: SlackPeople;
  reviewers: Reviewers | undefined;
}): string | undefined {
  // The page holds its suggestion while a channel post still has the row (`suggestionHeld`), so the voice does too.
  if (reviewers === undefined || suggestionHeld({ row })) {
    return undefined;
  }
  const joined = reviewerRowFor({ number: row.number, repoSlug: row.repoSlug, reviewers });
  if (joined?.picked !== undefined) {
    return `the owner picked ${personLabel({ id: joined.picked.reviewer, people }).text}, no ask seen since`;
  }
  if (joined?.suggestion === undefined) {
    return undefined;
  }
  const { primary } = joined.suggestion;
  return `${personLabel({ id: primary.reviewer, people }).text}: ${primary.basis}`;
}

/** The mark the page draws beside the row, off the repository it is in. */
function markOf({
  placer,
  row,
}: {
  placer: WorkspacePlacer;
  row: LandingRow;
}): { readonly label: string; readonly title: string } | undefined {
  return findingLabel({ placement: prPlacement({ placer, row }) });
}

/** `owner/repo#n`, the way every row on the page prints its repository before its number. */
function prNameOf({ row }: { row: LandingRow }): string {
  return `${row.repoSlug}#${String(row.number)}`;
}

/** The open row, flattened to the panel's facts. */
function openForVoice({
  placer,
  row,
  wait,
}: {
  placer: WorkspacePlacer;
  row: LandingRow;
  wait: string | undefined;
}): OpenForVoice {
  return {
    author: row.authorLogin,
    blockedOn: row.blockedOn,
    boardRow: row.boardRowKind,
    branch: `${row.headRefName} → ${row.baseRefName}`,
    checksNotGreen: row.failingChecks.map(
      (check) => `${check.name}: ${check.state}, ${checkRequirementWord({ required: check.required })}`,
    ),
    ci: landingCiWord({ row }),
    codeRabbitThreadsOpen: row.codeRabbit.open,
    dispatchWhy: row.dispatchWhy,
    draft: row.draft,
    humanThreadsOpen: row.humans.open,
    mark: markOf({ placer, row }),
    next: row.action,
    nextDetail: row.actionDetail,
    pr: prNameOf({ row }),
    tests: row.tests.map((test) => `${test.id}: ${test.verdict}, ${test.why}`),
    title: row.title,
    url: row.url,
    verdict: row.verdict,
    wait,
    waitingOn: row.waitingOn.map((waiting) => `${waiting.login} (${String(waiting.open)} open)`),
  };
}
