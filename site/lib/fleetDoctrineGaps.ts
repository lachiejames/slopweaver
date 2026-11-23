/**
 * The reconcile and board readings as the doctrine panel's row and pull-request lines both read them: which rows a live
 * seat is placed on, the hold lists as ids, and every place a reading could not look, each named rather than counted.
 * Split from `./fleetDoctrineRows.ts`, which composes the board-rows line.
 */
import type {
  DoctrineBoard,
  DoctrineInput,
  DoctrineLine,
  DoctrineReason,
  DoctrineReconcile as Reconcile,
} from "./fleetDoctrineTypes";
import { counted } from "./sidebarCountsBasis";

/**
 * Every row id a live seat is placed on, by the same reconcile.
 *
 * @returns the ids
 */
export function placedIdsOf({ reconcile }: { reconcile: Reconcile }): ReadonlySet<string> {
  return new Set([...reconcile.aligned, ...reconcile.misaligned, ...reconcile.unprioritised].map((one) => one.row.id));
}

/**
 * Why a reconcile that did not observe the fleet proves no live seat: its placements are the board's own open runs.
 *
 * Every row it places is named, since each is a seat nobody saw.
 *
 * @returns the reason
 */
export function fleetUnobservedWhyOf({ reconcile }: { reconcile: Reconcile }): string {
  const named = namedOf({ ids: [...placedIdsOf({ reconcile })] });
  if (reconcile.fleet === undefined) {
    return `the board reconcile predates saying whether it saw the live fleet, so no seat it places was checked${named}`;
  }
  return `the board reconcile did not see the live fleet (${reconcile.fleet}), so no seat it places was checked${named}`;
}

/**
 * Why each input a line stands on is not in hand, every one of them rather than the first.
 *
 * @param inputs the line's inputs, in the order its sentence names them
 * @returns the reasons, in that order, empty when every input is in hand
 */
export function unreadWhysOf({ inputs }: { inputs: readonly DoctrineInput<unknown>[] }): readonly DoctrineReason[] {
  return inputs.flatMap((input) => (input.kind === "unread" ? [input.why] : []));
}

/**
 * A line that is not read: its subject, the console's own reasons inside its sentence, and every read's reason quoted
 * apart beneath it, each said plainly with its raw message folded — never joined into the sentence (steer 7).
 *
 * @param subject what the line counts, opening its sentence
 * @param reasons every reason it is not read, in the order they are named
 * @returns the sentence whole, the quoted reasons, and — when the console named reasons of its own — the short lead the
 *   panel draws with those reasons folded beneath it
 */
export function unreadSentenceOf({
  subject,
  reasons,
}: {
  subject: string;
  reasons: readonly DoctrineReason[];
}): Pick<DoctrineLine, "quoted" | "sentence" | "notRead"> {
  const said = reasons.filter((reason) => typeof reason === "string");
  const quoted = reasons.filter((reason) => typeof reason !== "string");
  const lead = `${subject}: not read.`;
  if (said.length === 0) {
    return { quoted, sentence: lead };
  }
  return { notRead: { lead, reasons: said }, quoted, sentence: `${subject}: not read (${said.join("; ")}).` };
}

/**
 * Where the board's own scan could not look: each doc it could not read, by name, and the docs the sweep's deadline
 * cut, by count. A row in either is unknown here, not absent.
 *
 * @returns the reasons, empty on a complete board
 */
export function boardGapsOf({ board }: { board: DoctrineBoard }): readonly string[] {
  const reasons = board.unreadable.map((file) => `the board could not read ${file}`);
  if (board.unresolved > 0) {
    reasons.push(
      `the board's sweep ran out of time on ${counted({ count: board.unresolved, many: "docs", one: "doc" })}`,
    );
  }
  return reasons;
}

/**
 * Where the hold lists could not look. Every gap is named, never only the first one found.
 *
 * @param holds the reconcile reading's hold lists, their absence, or why they did not read
 * @param candidates every row with no live seat on it, named when no hold list was read at all
 * @returns the reasons, empty when the lists looked everywhere: a trunk's own reason, which is a git command's, quoted
 * apart from the words naming it (steer 7)
 */
export function holdGapsOf({
  holds,
  candidates,
}: {
  holds: Reconcile["holds"];
  candidates: readonly string[];
}): readonly DoctrineReason[] {
  if (holds.kind === "absent") {
    return [`the reconcile reading predates its hold lists, so no hold was read${namedOf({ ids: candidates })}`];
  }
  // A hold only ever adds a row to the kept count, so unread holds make that count a floor, scoped to the rows looked
  // at and named here, exactly as absent holds do. That floor is never read as a measured zero: the sentence says
  // "looked at", the tone is unread and every unchecked row is named.
  if (holds.kind === "malformed") {
    return [
      {
        lead: `the reconcile reading's hold lists did not read, so no hold was read${namedOf({ ids: [...candidates, ...holds.named] })}${trunksOf({ repos: holds.repos })}`,
        why: holds.why,
      },
    ];
  }
  const reasons: DoctrineReason[] = [];
  const { lists } = holds;
  if (lists.supersessionUnresolved !== undefined) {
    reasons.push({ lead: "no supervisor chair was judged retired", why: lists.supersessionUnresolved });
  }
  for (const scope of lists.trunkUnread) {
    reasons.push({
      lead: `${scope.repo}'s trunk did not read, so ${counted({ count: scope.slugs.length, many: "findings", one: "finding" })} went unchecked${namedOf({ ids: scope.slugs })}`,
      why: scope.why,
    });
  }
  for (const scope of lists.trunkPullsUnchecked) {
    reasons.push({
      lead: `Cited pulls in ${scope.repo} were not checked for ${counted({ count: scope.slugs.length, many: "findings", one: "finding" })}${namedOf({ ids: scope.slugs })}`,
      why: scope.why,
    });
  }
  if (lists.released === undefined) {
    // Any row with no live seat could be a released one, so each is named as unchecked.
    reasons.push(`the reconcile reading predates released runs, so none was counted${namedOf({ ids: candidates })}`);
  } else if (lists.released.kind === "unread") {
    reasons.push({
      lead: `released runs were not counted${namedOf({ ids: lists.released.unreadableIds })}`,
      why: lists.released.why,
    });
  }
  return reasons;
}

/**
 * The ids a gap covers, as a trailing clause, so every place not checked is named rather than counted.
 *
 * @param ids the rows or runs the gap left unchecked
 * @returns the clause, empty when the gap names none
 */
export function namedOf({ ids }: { ids: readonly string[] }): string {
  if (ids.length === 0) {
    return "";
  }
  return ` (${[...new Set(ids)].toSorted().join(", ")})`;
}

/**
 * The repositories whose trunk a malformed holds set named, as a trailing clause.
 *
 * @param repos the repositories, `owner/name`
 * @returns the clause, empty when it names none
 */
function trunksOf({ repos }: { repos: readonly string[] }): string {
  if (repos.length === 0) {
    return "";
  }
  return `, nor any trunk check in ${repos.join(", ")}`;
}

/** The verb's hold lists, empty when the reading predates them (which `./fleetDoctrineRows.ts`'s `notCheckedOf` says). */
export interface HoldIds {
  readonly shared: readonly string[];
  readonly repoless: readonly string[];
  readonly superseded: readonly string[];
  readonly trunkMoved: readonly string[];
  readonly released: readonly string[];
}

/**
 * The hold lists as ids, each empty where the reading did not carry it — never counted as measured, because
 * `./fleetDoctrineRows.ts`'s `notCheckedOf` names every such gap.
 *
 * @returns the ids
 */
export function holdIdsOf({ reconcile }: { reconcile: Reconcile }): HoldIds {
  const holds = reconcile.holds;
  if (holds.kind !== "read") {
    return { released: [], repoless: [], shared: [], superseded: [], trunkMoved: [] };
  }
  const { lists } = holds;
  let released: readonly string[] = [];
  if (lists.released?.kind === "read") {
    released = lists.released.ids;
  }
  return {
    released,
    repoless: lists.repoless,
    shared: lists.shared,
    superseded: lists.superseded,
    trunkMoved: lists.trunkMoved,
  };
}
