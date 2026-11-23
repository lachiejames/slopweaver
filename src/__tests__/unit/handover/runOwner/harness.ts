/*
 * What the run-ownership test files share: two session ids, one instant, a `started` entry, a `launched` entry in
 * the fleet driver's shape, and the foreign writer the `foreignRunLine` files hold a run elsewhere with. They moved
 * here when `runOwner.test.ts` was split by behaviour.
 */
import type { RunEvent } from "../../../../handover/ledger.js";

export const MINE = "89e81284-ee20-4e94-8896-6c17a2d10a50";
export const THEIRS = "c28007f7-aa86-4925-ab52-14566f5daea2";
export const AT = "2026-08-05T16:02:46.494Z";

export const STARTED: RunEvent = { atIso: AT, branch: "feat/a", docHash: "h", kind: "started" };

// Host-labelled, because the LIVE verdict below must be a reachable pairing: a hostless writer can only ever
// classify dead or unknown, and asserting an impossible combination would prove nothing about production.
export const writer = {
  atIso: AT,
  host: "claude-code" as const,
  pid: 65036,
  sessionId: THEIRS,
  worktree: "/wt/theirs",
};
export const elsewhere = { kind: "elsewhere" as const, thisSession: MINE, writer };

/**
 * A `launched` entry in the shape the owner's fleet driver actually writes.
 *
 * @returns the `launched` run event
 */
export function launched({
  sessionId,
  atIso = "2026-08-05T16:02:46.496Z",
  worktree = "/tmp/fleet/a-doc",
  pid = 65036,
}: {
  sessionId: string;
  atIso?: string;
  worktree?: string | undefined;
  pid?: number | undefined;
}): RunEvent {
  return { atIso, kind: "launched", pid, sessionId, worktree };
}
