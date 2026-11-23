/*
 * The fixtures the parked-wait tests share: a board read through the real board reader, a park as `handover list
 * --json` publishes it, and a `handover wake --json` row as the tick records it, read through the real wake reader.
 * Not a test file, so the unit lane never collects it on its own.
 */
import { type BoardRow, readBoard } from "../../components/live/read";
import { readWakeCi, type WakeCiReading } from "../../components/live/readWakeReading";

/** The page's clock in every case, fixed so no row's age depends on the wall clock. */
export const NOW_MS = Date.parse("2026-10-17T03:00:00.000Z");

/**
 * Every published row, each an active run unless `over` says otherwise, read through the real board reader.
 *
 * @returns the board's rows as the page holds them
 */
export function boardOf({ rows }: { rows: readonly Record<string, unknown>[] }): readonly BoardRow[] {
  const board = readBoard({
    rows: rows.map((over) => ({
      kind: "build",
      ownerWait: "not-waiting",
      reason: "in flight",
      section: "in flight",
      status: "active",
      ...over,
    })),
    unresolved: 0,
  });
  if (board === undefined) {
    throw new Error("the fixture board did not read");
  }
  return board.rows;
}

/**
 * A park's checkpoint as `handover list --json` publishes it, at journal index 3 unless told, carrying `wake` when given.
 *
 * @returns the published checkpoint
 */
export function parked({ parkIndex = 3, wake }: { parkIndex?: unknown; wake?: unknown }): Record<string, unknown> {
  return {
    atIso: "2026-10-17T02:00:00.000Z",
    branch: "some-branch",
    parkIndex,
    screenTail: "",
    workspaceRef: "workspace:12",
    worktree: "/tmp/tree",
    ...(wake === undefined ? {} : { wake }),
  };
}

/**
 * One row's `parkedWake`, read off a single-row board.
 *
 * @returns whether the row carries the field, and its value
 */
export function wakeOf({ over }: { over: Record<string, unknown> }): unknown {
  const row = boardOf({ rows: [{ slug: "a-row", ...over }] }).at(0);
  if (row === undefined) {
    throw new Error("the fixture board drew no row");
  }
  return [Object.hasOwn(row, "parkedWake"), row.parkedWake];
}

/** The instant every fixture park is journalled at, as `parked` writes it. */
export const PARKED_AT = "2026-10-17T02:00:00.000Z";

/** When the fixture wake judged its rows — its report's own `observedAtIso`, after every fixture park and before the page's clock. */
export const JUDGED_AT = "2026-10-17T02:45:00.000Z";

/** The actions after which a fixture park is gone by default, as the wake's own reseat, finish and clear leave it. */
const GONE_AFTER: ReadonlySet<unknown> = new Set(["spawned", "finished", "park-cleared"]);

/**
 * What a fixture row reports of its park once the wake was done: `gone` after a reseat, finish or clear, else
 * `standing`.
 *
 * @returns the row's default `parkStanding`
 */
function standingAfter({ action }: { action: unknown }): string {
  return GONE_AFTER.has(action) ? "gone" : "standing";
}

/**
 * A `handover wake --json` row for one park, as the tick records it, stamped with the park it judged.
 *
 * @returns the wire row
 */
export function wakeRow({
  action = "none",
  judgement,
  number,
  parkIndex = 3,
  parkStanding = standingAfter({ action }),
  parkedAtIso = PARKED_AT,
  slug,
}: {
  slug: string;
  number: number;
  judgement: unknown;
  action?: unknown;
  parkIndex?: number;
  parkStanding?: unknown;
  parkedAtIso?: string;
}): unknown {
  return {
    action,
    detail: "",
    judgement,
    parkIndex,
    parkStanding,
    parkedAtIso,
    slug,
    wake: { kind: "checks", number, repo: "o/r" },
  };
}

/** The instant a fixture clock row's park was to wake at. */
export const CLOCK_AT = "2026-10-17T05:00:00Z";

/**
 * A `handover wake --json` row for one clock park, stamped like every row the wake reports.
 *
 * @returns the wire row
 */
export function clockRow({
  action = "none",
  atIso = CLOCK_AT,
  parkedAtIso = PARKED_AT,
  slug,
}: {
  slug: string;
  action?: string;
  atIso?: string;
  parkedAtIso?: string;
}): unknown {
  // A reseat follows only a due judgement, as the wake writes one.
  const judgement = action === "spawned" ? { kind: "due", reason: "" } : { kind: "not-due", reason: "" };
  return {
    action,
    detail: "",
    judgement,
    parkIndex: 3,
    parkStanding: standingAfter({ action }),
    parkedAtIso,
    slug,
    wake: { atIso, kind: "at" },
  };
}

/**
 * A due judgement on a checks park whose pull request is in `prState`, observed in the wire's exact shape.
 *
 * @returns the wire judgement
 */
export function due({ number, prState }: { number: number; prState: string }): unknown {
  const head = prState === "OPEN" ? { fingerprint: "f", headSha: "abc" } : {};
  const mergeCommit = prState === "MERGED" ? { mergeCommitOid: "2fa140b4" } : {};
  return {
    kind: "due",
    observed: { kind: "checks", number, prState, repo: "o/r", ...head },
    reason: "",
    ...mergeCommit,
  };
}

/**
 * The tick's wake document, read through the real reader.
 *
 * @returns the reading the page holds
 */
export function wakeCiOf({ rows }: { rows: readonly unknown[] }): WakeCiReading {
  const read = readWakeCi({ observedAtIso: JUDGED_AT, rows });
  if (read === undefined) {
    throw new Error("the fixture wake document did not read");
  }
  return read;
}
