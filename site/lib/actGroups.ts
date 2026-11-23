/**
 * The two things every act card is built from beside the act itself: which acts one card stands for — one
 * pattern — and the board
 * and landing reads its links go through. Split from `./queueRows.ts`, which builds the cards, so that file stays
 * under the 300-line cap — and shared with `./standingRules.ts`, so a check-in card and a card a standing rule
 * settled cannot mean two different things by "one card".
 */
import type { Board, BoardRow } from "../components/live/read";
import type { AutonomyRow } from "../components/live/readAutonomy";
import type { LandingReading, LandingRow } from "../components/live/readLanding";
import type { LiveState } from "../components/live/useLive";
import { indexBoardRows, rowsCarrying } from "./boardRowIndex";
import type { ActLinkLanding } from "./queueCardAct";
import type { ActLinkBoard } from "./queueCardActLinks";
import { actPlacement, joinedPlacement, placementFoldKey } from "./registerPlacement";
import type { WorkspacePlacement, WorkspacePlacer } from "./workspacePlacement";

/** One card's worth of acts: the newest act of one PATTERN, and the earlier ones folded beneath it. */
export interface ActGroup {
  readonly act: AutonomyRow;
  /** Earlier acts of the same pattern, newest first. */
  readonly earlier: readonly AutonomyRow[];
  /** Every subject the pattern's acts name, the newest act's first, each once. */
  readonly subjects: readonly string[];
}

/**
 * The strings one act joins its pattern on: its kind on its subject, and its kind in its exact `said` when it
 * has one, under the standing rule covering it — a pattern never spans two rules. The console's own statement of
 * `src/autonomy/query.ts` `autonomyPatternKeys`, which it cannot import;
 * `../__tests__/unit/actPatternMirror.test.ts` and `src/__tests__/unit/autonomy/patternMirror.test.ts` hold the two
 * folds to one case table (`src/__tests__/fixtures/autonomyPatternCases.ts`) and fail on any group either draws
 * differently.
 */
function actPatternKeys({ act }: { act: Pick<AutonomyRow, "kind" | "rule" | "said" | "subject"> }): readonly string[] {
  const keys = [JSON.stringify(["on", act.kind, act.subject])];
  if (act.said !== undefined) {
    keys.push(JSON.stringify(["said", act.kind, act.rule?.classId, act.said]));
  }
  return keys;
}

/**
 * Group acts into cards, one per PATTERN: the acts of one kind joined by a shared subject or a shared, identical
 * plain-words `said` — joined through one another, so membership never depends on the ledger's order. The newest
 * act governs and the earlier ones fold beneath it. Two cases make it:
 *
 * - The same pull request on the list twice as two press-merge-when-ready rows. Two presses on one pull request are
 *   one question.
 * - Seven acme-admin security-bump rebases, each written up "I rebased your security PR onto staging …", each its own
 *   card, though a standing instruction should have cleared them off the queue. One thing done seven times is one
 *   question.
 *
 * Relies on the register's order, newest first, which `readAutonomy` keeps and `autonomy list` prints: the first
 * act met per group is its newest.
 *
 * Acts placed differently never group together: `apart` names each act's placement and the mark it wears, and it is
 * part of every key an act joins on, so two acts share no key — and so no pattern, even through a third act — unless
 * they are placed alike. An unplaced act — a finding, placed by the default rule and marked — is never absorbed into a newer act
 * placed in one. For the same reason the owner's word on a pattern's newest act settles
 * only the acts placed alike ({@link placedAlikeSteers}).
 *
 * @param acts every act the ledger read holds, newest first
 * @param apart what else keeps two acts apart — the queue passes each act's workspace placement
 * @returns one group per pattern and `apart`, in the register's order
 */
export function groupActs({
  acts: listed,
  apart = () => "",
}: {
  acts: readonly AutonomyRow[];
  apart?: (act: AutonomyRow) => string;
}): readonly ActGroup[] {
  const acts = placedAlikeSteers({ acts: listed, apart });
  // Each act points at the act that now leads its group; a lead points at itself.
  const leadOf = new Map<AutonomyRow, AutonomyRow>();
  const leadFor = (act: AutonomyRow): AutonomyRow => {
    const lead = leadOf.get(act)!;
    if (lead === act) {
      return act;
    }
    const top = leadFor(lead);
    leadOf.set(act, top);
    return top;
  };
  const position = new Map(acts.map((act, index) => [act, index]));
  const byKey = new Map<string, AutonomyRow>();
  for (const act of acts) {
    leadOf.set(act, act);
    const placedAs = apart(act);
    for (const pattern of actPatternKeys({ act })) {
      const key = JSON.stringify([placedAs, pattern]);
      const met = byKey.get(key);
      if (met === undefined) {
        byKey.set(key, act);
        continue;
      }
      const mine = leadFor(act);
      const theirs = leadFor(met);
      // The earlier-listed lead — the newer act — keeps the group.
      if (position.get(mine)! < position.get(theirs)!) {
        leadOf.set(theirs, mine);
      } else {
        leadOf.set(mine, theirs);
      }
    }
  }
  const groups = new Map<AutonomyRow, { act: AutonomyRow; earlier: AutonomyRow[]; subjects: string[] }>();
  for (const act of acts) {
    const lead = leadFor(act);
    const group = groups.get(lead);
    if (group === undefined) {
      groups.set(lead, { act, earlier: [], subjects: [act.subject] });
      continue;
    }
    group.earlier.push(act);
    if (!group.subjects.includes(act.subject)) {
      group.subjects.push(act.subject);
    }
  }
  return [...groups.values()];
}

/**
 * The cards the owner's check-in list draws, one per PATTERN of acts ({@link groupActs}): the newest act of each, with
 * the earlier ones folded beneath it, and none at all where the newest already carries the owner's word.
 *
 * The NEWEST act governs: the owner's word on it — the card's Approve, Deny, or its row in Approve all, each of which
 * steers `act.actionId` — is projected by the register's own fold onto every earlier act of the pattern
 * (`src/autonomy/query.ts` `settlingPattern`, read by `../components/live/readAutonomy.ts`), so the whole group
 * leaves here and leaves `autonomy list --unsteered` together. A word only on an earlier act does not settle it,
 * because it was given before the later act existed.
 *
 * Relies on the register's order, newest first, which `readAutonomy` keeps and `autonomy list` prints: the first
 * act met per group is its newest.
 *
 * Acts placed differently never fold together: `apart` names each act's placement and the mark it wears, so an
 * unplaced act — a finding, placed by the default rule and marked — is never absorbed into a newer act placed in one.
 *
 * Here rather than in `./queueRows.ts`, which draws the cards, so a reader that groups acts without drawing them
 * uses this one function without importing the card builder.
 *
 * @param acts every act the ledger read holds, newest first
 * @param apart what else keeps two acts apart — the queue passes each act's workspace placement
 * @returns one entry per pattern whose newest act carries no steer, in the register's order
 */
export function foldActs({
  acts,
  apart,
}: {
  acts: readonly AutonomyRow[];
  apart?: (act: AutonomyRow) => string;
}): readonly ActGroup[] {
  return groupActs({ acts, ...(apart === undefined ? {} : { apart }) }).filter(
    (group) => group.act.steer === undefined,
  );
}

/**
 * Each act with the owner's word on its pattern kept only when the act it was given on is placed alike.
 *
 * The register projects the owner's word on a pattern's newest act onto every earlier one (`src/autonomy/query.ts`
 * `settlingPattern`), and it reads no board, so it cannot know where an act is placed. Here, where acts placed
 * differently are never one card, a word given on a card in one workspace would take an act off the other
 * workspace's list that the card the owner answered never showed. So that act keeps its own standing: the rule
 * covering it, if one does, or no word at all. The same holds when the act the word was given on is not in this
 * reading, because then nothing can place it. A word the owner gave on the act itself is never touched.
 *
 * @param acts every act the ledger read holds
 * @param apart each act's workspace placement and mark, as {@link groupActs} keeps them apart
 * @returns the acts in the same order, each pattern word it cannot honour dropped
 */
export function placedAlikeSteers({
  acts,
  apart,
}: {
  acts: readonly AutonomyRow[];
  apart: (act: AutonomyRow) => string;
}): readonly AutonomyRow[] {
  const byId = new Map(acts.map((act) => [act.actionId, act]));
  return acts.map((act) => {
    if (act.patternFrom === undefined) {
      return act;
    }
    const from = byId.get(act.patternFrom);
    if (from !== undefined && apart(from) === apart(act)) {
      return act;
    }
    return { ...act, patternFrom: undefined, standing: act.rule, steer: act.rule?.words };
  });
}

/**
 * The `apart` the queue groups by: each act's workspace placement, and the mark it wears.
 *
 * @param reads the reads whose `placed` places each act
 * @returns the key {@link groupActs} keeps acts placed differently apart by
 */
export function placementApart({ reads }: { reads: ActReads }): (act: AutonomyRow) => string {
  return (act) => placementFoldKey({ placement: reads.placed({ act }) });
}

/**
 * What an act card reads beside the ledger: the board and the owner's open pull requests, each as far as it has arrived,
 * and the workspace each act belongs to, read off its fields and the board row it names.
 */
export interface ActReads {
  readonly board: ActLinkBoard;
  /** The board's rows whole, for whose words an act came from, or `undefined` until the board is read. */
  readonly boardRows: readonly BoardRow[] | undefined;
  readonly landing: ActLinkLanding;
  readonly openPulls: readonly LandingRow[];
  readonly placed: (args: { act: AutonomyRow }) => WorkspacePlacement;
}

/**
 * The board and landing reads an act card links through. They are read beside the ledger because a finding act
 * names its board slug, never its pull request — the gate records the row before the pull request exists
 * (`./queueCardAct.ts` `actPullRequests`, `./queueCardActLinks.ts` `actLinks`).
 *
 * @param board the board read
 * @param landing the owner's open pull requests
 * @param placer the organisation's address readers, which place each act
 * @returns each read as far as it has arrived, and the open pull requests when landing has
 */
export function actReadsOf({
  board,
  landing,
  placer,
}: {
  board: LiveState<Board>;
  landing: LiveState<LandingReading>;
  placer: WorkspacePlacer;
}): ActReads {
  // The Queue places each act three or four times (the steer fold, the group key, the card) and links each card, all
  // from this reading, so the board is indexed once and each act placed once (`./boardRowIndex.ts` measures why).
  let boardRead: ActLinkBoard = { phase: "loading" };
  let indexed = indexBoardRows<BoardRow>({ rows: [] });
  let readRows: readonly BoardRow[] | undefined;
  if (board.phase === "ready") {
    const readIndex = indexBoardRows({ rows: board.value.rows });
    indexed = readIndex;
    boardRead = { phase: "ready", rowsNamed: ({ slugs }) => rowsCarrying({ index: readIndex, slugs }) };
    readRows = board.value.rows;
  } else if (board.phase === "not-measured") {
    boardRead = { phase: "not-measured", why: board.why };
  }
  const placements = new WeakMap<AutonomyRow, WorkspacePlacement>();
  const placed = ({ act }: { act: AutonomyRow }): WorkspacePlacement => {
    const known = placements.get(act);
    if (known !== undefined) {
      return known;
    }
    const placement = joinedPlacement({ board, placement: actPlacement({ act, board: indexed, placer }) });
    placements.set(act, placement);
    return placement;
  };
  let landingRead: ActLinkLanding = { phase: "loading" };
  let openPulls: readonly LandingRow[] = [];
  if (landing.phase === "ready") {
    landingRead = { phase: "ready" };
    openPulls = landing.value.landing.rows;
  } else if (landing.phase === "not-measured") {
    landingRead = { phase: "not-measured", why: landing.why };
  }
  return { board: boardRead, boardRows: readRows, landing: landingRead, openPulls, placed };
}
