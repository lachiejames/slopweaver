/*
 * The doctrine panel's readings, built the way the tick publishes them, for the panel's pure tests: the rows, pull
 * request and whole-panel tests draw the same reconcile, board, landing and seats, so they build them the same way.
 */
import type { ReconcileHoldLists } from "../../components/live/readReconcileHolds";
import type { RankedRow } from "../../components/live/readWorkstreamsTypes";
import type { DoctrineSeats } from "../../lib/fleetDoctrineSeats";
import type {
  DoctrineBoard,
  DoctrineBoardRow,
  DoctrineInput,
  DoctrineLanding,
  DoctrineLine,
  DoctrineLineKey,
  DoctrineReconcile,
} from "../../lib/fleetDoctrineTypes";

/**
 * A ranked row with the fields the panel reads.
 *
 * @returns the row, groomed, ready and p2
 */
export const ranked = ({ id, standing }: { id: string; standing?: string }): RankedRow => ({
  groomed: true,
  id,
  kind: "planned",
  label: id,
  openedIso: undefined,
  priority: "p2",
  ready: true,
  standing,
  waitingHours: 0,
});

/**
 * Hold lists, empty unless overridden.
 *
 * @returns the lists, released read as none
 */
export const lists = (over: Partial<ReconcileHoldLists> = {}): ReconcileHoldLists => ({
  released: { ids: [], kind: "read" },
  repoless: [],
  shared: [],
  superseded: [],
  supersessionUnresolved: undefined,
  trunkMoved: [],
  trunkPullsUnchecked: [],
  trunkUnread: [],
  ...over,
});

/**
 * A reconcile, nothing placed and nothing held unless overridden.
 *
 * @returns the reconcile, its fleet observed
 */
export const reconcileOf = (over: Partial<DoctrineReconcile> = {}): DoctrineReconcile => ({
  aligned: [],
  fleet: "observed",
  held: [],
  holds: { kind: "read", lists: lists() },
  misaligned: [],
  ready: [],
  staleAsks: [],
  starving: [],
  top: [],
  unprioritised: [],
  ...over,
});

/**
 * A board row, unparked and naming no pull request unless overridden.
 *
 * @returns the row, not waiting on the owner
 */
export const boardRow = (over: Partial<DoctrineBoardRow> & { slug: string }): DoctrineBoardRow => ({
  ownerWait: "not-waiting",
  prUrls: [],
  prUrlsAbsent: false,
  prUrlsPartial: false,
  ...over,
});

/**
 * A read board holding these rows, its scan complete unless overridden.
 *
 * @returns the board as a read input
 */
export const boardOf = ({
  rows,
  unreadable = [],
  unresolved = 0,
}: {
  rows: readonly DoctrineBoardRow[];
  unreadable?: readonly string[];
  unresolved?: number;
}): DoctrineInput<DoctrineBoard> => ({ kind: "read", value: { rows, unreadable, unresolved } });

/**
 * A seat placed on a row.
 *
 * @returns the placement, ranked first
 */
export const placedOn = ({ id }: { id: string }): DoctrineReconcile["aligned"][number] => ({
  rank: 1,
  row: ranked({ id }),
  session: `seat-${id}`,
});

/**
 * A pull request's URL in acme/app.
 *
 * @returns the URL
 */
export const url = ({ n }: { n: number }): string => `https://github.com/acme/app/pull/${String(n)}`;

/**
 * A landing reading whose census lists these pull requests in acme/app, read as `owner`.
 *
 * @returns the reading, its census started at the fixture's census instant
 */
export const landingOf = ({
  prs,
  rows = [],
}: {
  prs: readonly { n: number; author: string; isDraft: boolean }[];
  rows?: DoctrineLanding["rows"];
}): DoctrineLanding => ({
  census: [
    {
      kind: "read",
      pullRequests: prs.map((pr) => ({
        author: pr.author,
        isDraft: pr.isDraft,
        number: pr.n,
        title: `change ${String(pr.n)}`,
        url: url({ n: pr.n }),
      })),
      repo: "acme/app",
      startedAtIso: "2026-11-03T06:00:00.000Z",
      totalCount: prs.length,
      viewer: "Owner",
    },
  ],
  rows,
});

/**
 * A seat, idle and untitled unless overridden.
 *
 * @returns the seat, not pinned
 */
export const seat = (
  over: Partial<DoctrineSeats["rows"][number]> & { workspaceId: string },
): DoctrineSeats["rows"][number] => ({
  manager: false,
  sessionTitle: undefined,
  signal: "idle",
  title: undefined,
  workspaceRef: undefined,
  ...over,
});

/**
 * The panel's line under `key`, which the panel always draws.
 *
 * @returns the line
 */
export const lineOf = ({ lines, key }: { lines: readonly DoctrineLine[]; key: DoctrineLineKey }): DoctrineLine =>
  lines.find((line) => line.key === key)!;

/**
 * Each group's item texts, in order.
 *
 * @returns one list of texts per group
 */
export const textsOf = ({ line }: { line: DoctrineLine }): readonly (readonly string[])[] =>
  line.groups.map((group) => group.items.map((item) => item.text));
