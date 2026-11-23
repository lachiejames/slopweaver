/**
 * The one screen scan `session watch` and `session re-seat` both run: read every live seat's screen but a pinned
 * one's and the caller's, once each, and say which stand behind a wall (`../../../sessions/seatRecovery.ts`'s
 * `detectSeatWall`). One scan rather than two, so the watch that REPORTS a wall and the verb that ACTS on it can
 * never disagree about which seats they looked at — a `working` seat included, because a limit-walled seat
 * reads `working` for as long as it retries. `session watch`'s inventory join, which runs the scan over the
 * connection it lists the workspaces on, sits here beside it.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { SessionActivity } from "../../../cmux/sessionActivity.js";
import { logger } from "../../../lib/logger.js";
import { type CmuxHostSurface, withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { detectSeatWall, type SeatWall, seatRecoveryScreenTargets } from "../../../sessions/seatRecovery.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { type SessionWatchRow, sessionWatchRows, withWalledSeats } from "../../../sessions/watchReport.js";

/** A target screen the scan could not read — so whether it stands behind a wall is unknown, not "no". */
export interface SeatScanProblem {
  readonly kind: "screen-unreadable";
  readonly workspace: CmuxWorkspaceSummary;
  readonly message: string;
}

/**
 * The caller's own workspace id from the environment, so the scan never reads (or re-seats) the session running it.
 *
 * @param env the process environment to read `CMUX_WORKSPACE_ID` from
 * @returns the trimmed id, or `undefined` outside cmux
 */
export function callerWorkspaceId({ env }: { env: Readonly<Record<string, string | undefined>> }): string | undefined {
  const own = env["CMUX_WORKSPACE_ID"]?.trim();
  if (own === undefined || own.length === 0) {
    return undefined;
  }
  return own;
}

/**
 * Read each target screen once, in inventory order: the wall each walled seat showed, and each screen unread.
 *
 * @param client the cmux host's screen read — terminal observation, which stage 2's vendor events replace
 * @param workspaces the live cmux inventory
 * @param ownWorkspaceId the caller's own workspace id, never read
 * @param chairWorkspaceId the recorded supervisor pin's workspace, never read
 * @returns the walls by workspace id, and one problem per screen that could not be read
 */
export async function scanSeatWalls({
  client,
  workspaces,
  ownWorkspaceId,
  chairWorkspaceId,
}: {
  client: Pick<CmuxHostSurface, "readScreen">;
  workspaces: readonly CmuxWorkspaceSummary[];
  ownWorkspaceId: string | undefined;
  chairWorkspaceId: string | undefined;
}): Promise<{ readonly walls: ReadonlyMap<string, SeatWall>; readonly scanProblems: readonly SeatScanProblem[] }> {
  const walls = new Map<string, SeatWall>();
  const scanProblems: SeatScanProblem[] = [];
  for (const workspace of seatRecoveryScreenTargets({ chairWorkspaceId, ownWorkspaceId, workspaces })) {
    const screen = await client.readScreen({ target: { workspaceId: workspace.workspaceId } });
    if (screen.isErr()) {
      scanProblems.push({ kind: "screen-unreadable", message: screen.error.message, workspace });
      continue;
    }
    const wall = detectSeatWall({ screen: screen.value });
    if (wall !== undefined) {
      walls.set(workspace.workspaceId, wall);
    }
  }
  return { scanProblems, walls };
}

/**
 * `session watch`'s rows joined to the live cmux inventory, with every walled seat marked — or the rows joined to
 * an empty inventory with the failure reported, because a watch must not die over a name.
 *
 * `read` is the half a caller cannot infer from the rows, and it is load-bearing rather than informational:
 * a FAILED read and a genuinely empty fleet both produce `[]`, which marks every row `mapped: false`, and
 * suppressing stale unmapped rows off the back of that would blank the whole gauge on one socket hiccup.
 *
 * The screens are read over the same connection as the inventory, because a reopened seat sitting on
 * `Not logged in` fires no hook and a limit-walled one reads `working` for as long as it
 * retries, so its screen is the only witness. Every live non-pinned seat but the caller is read, `working`
 * included — skipping `working` is exactly how a spent-plan seat went unseen for hours.
 *
 * @param activities the folded hook activity, by workspace id
 * @param idleAfterMs how long a session must have been silent to count as idle
 * @param nowIso the instant the rows are judged at
 * @param home where the supervisor pin is read from, so the chair's screen is never read
 * @returns the rows, whether the inventory was read, and each problem already logged
 */
export async function watchInventory({
  activities,
  idleAfterMs,
  nowIso,
  home,
}: {
  activities: Readonly<Record<string, SessionActivity>>;
  idleAfterMs: number;
  nowIso: string;
  home: string;
}): Promise<{ rows: readonly SessionWatchRow[]; read: boolean; problems: readonly string[] }> {
  return withCmuxSessionHost({
    body: async ({ host: client }) => {
      const listed = await client.listWorkspaces();
      if (listed.isErr()) {
        const problem = `the cmux inventory could not be read (${listed.error.message}) — reporting workspace ids without titles, and reporting every stale row rather than collapsing any`;
        logger.error({ msg: `session watch: ${problem}` });
        return {
          problems: [problem],
          read: false,
          rows: sessionWatchRows({ activities, idleAfterMs, nowIso, workspaces: [] }),
        };
      }
      const workspaces = listed.value;
      const rows = sessionWatchRows({ activities, idleAfterMs, nowIso, workspaces });
      const { walls, scanProblems } = await scanSeatWalls({
        client,
        chairWorkspaceId: readSupervisorPin({ home })?.workspaceId,
        ownWorkspaceId: callerWorkspaceId({ env: process.env }),
        workspaces,
      });
      const problems = scanProblems.map(
        (problem) =>
          `the screen of ${problem.workspace.workspaceRef} could not be read (${problem.message}), so whether it is logged out or limit-retrying is unknown`,
      );
      problems.forEach((problem) => {
        logger.error({ msg: `session watch: ${problem}` });
      });
      return { problems, read: true, rows: withWalledSeats({ rows, wallsByWorkspaceId: walls, workspaces }) };
    },
  });
}
