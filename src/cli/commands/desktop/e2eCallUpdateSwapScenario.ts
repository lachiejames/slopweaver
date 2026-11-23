/**
 * `update-swap-resume`: a live call, ended for an update the way the sidebar's "End call, update & restart call" ends
 * it for a held console build (the `swap` step), then the console page reloaded under the wait so the page's own
 * deadline is gone — and the call must come back by itself, with nobody pressing Talk.
 *
 * The owner pressed the button, the call ended, and nothing restarted it. The
 * swap's deadline lived only in the page, which a console outage's reload wipes, and the shell cleared what it owed
 * before the voice window had been handed it. The shell now holds the deadline (`slopweaver:update-swap`) and keeps
 * what it owes until a listening voice window takes it (`desktop/src/updateCallShell.ts` `resumeIfOwed`).
 *
 * The cap sits under the shell's four-minute orphan backstop, so a call back inside it is the swap's own deadline
 * firing, never the backstop covering for it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "playwright-core";

import { err, type Result } from "#lib/result.js";
import { VOICE_PATH } from "../../../desktop/e2ePlan.js";
import { owedSinceIso, updateResumeProblem } from "../../../desktop/e2eUpdateSwapResume.js";
import { isIdle, isLive, until } from "./e2eCallPage.js";
import { awaitAnswer, nothingYet, type Scenario, startLive } from "./e2eCallScenarios.js";
import { type CallSession, readCallLogs } from "./e2eCallSession.js";
import { consolePathOfUrl } from "./e2ePage.js";

/** How long the call has to come back after the console reloads: the shell's three-minute swap wait, and room. */
const RESUME_CAP_MS = 210_000;

/** How long the call has to end once the shell is asked to end it. */
const END_CAP_MS = 30_000;

/**
 * The test instance's console tab, the one sender the shell takes an update step from.
 *
 * @returns the page, or `undefined` when no console tab shows
 */
function consoleTabOf({ session }: { session: CallSession }): Page | undefined {
  return session.app
    .context()
    .pages()
    .find((page) => {
      const path = page.isClosed() ? undefined : consolePathOfUrl({ url: page.url() });
      return path !== undefined && !path.startsWith(VOICE_PATH);
    });
}

/**
 * What the test instance saved it owes, read from its own scratch `state.json` — never the owner's app. The shell writes it
 * at once (`persist`, `immediate: true`) before it asks for the hang-up.
 *
 * @param userData the test instance's own scratch folder
 * @returns the saved `sinceIso`, or why it could not be read
 */
export function readOwedSinceIso({ userData }: { userData: string }): Result<string> {
  const path = join(userData, "state.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return err([`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`]);
  }
  return owedSinceIso({ text });
}

/**
 * The drive.
 *
 * @returns what the call showed, for the judge
 */
export const updateSwapResume: Scenario = async ({ session }) => {
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  await awaitAnswer({ capMs: 30_000, ownerText: undefined, view });
  const tab = consoleTabOf({ session });
  if (tab === undefined) {
    return {
      ...nothingYet({ view }),
      blocked: "the test instance showed no console tab to press update from",
      live: true,
    };
  }
  const opened = session.tracker.planCallIds.length;
  // The bridge `desktop/src/preload.ts` exposes to a console tab, called as an expression string because `src/` has no
  // type for the page's global.
  const refused: unknown = await tab.evaluate("globalThis.slopweaverDesktop.endCallForUpdate()");
  if (refused !== null) {
    return {
      ...nothingYet({ view }),
      blocked: `the shell refused to end the call: ${JSON.stringify(refused)}`,
      live: true,
    };
  }
  const owed = readOwedSinceIso({ userData: session.userData });
  if (owed.isErr()) {
    return { ...nothingYet({ view }), blocked: owed.error.join("; "), live: true };
  }
  if (!(await until({ capMs: END_CAP_MS, test: async () => isIdle({ view }) }))) {
    return { ...nothingYet({ view }), blocked: "the call did not end for the update", live: true };
  }
  await tab.evaluate("globalThis.slopweaverDesktop.beginSwapForUpdate()");
  // What a console outage does: the page reloads under the wait, and its own deadline goes with it.
  await tab.reload();
  if (!(await until({ capMs: RESUME_CAP_MS, test: async () => isLive({ view }) }))) {
    const blocked = `no call came back within ${String(RESUME_CAP_MS / 1000)}s of the swap's call ending`;
    return { ...nothingYet({ view }), blocked, live: true };
  }
  const logs = readCallLogs({ session });
  if (logs.isErr()) {
    return { ...nothingYet({ view }), blocked: logs.error.message, live: true };
  }
  const problem = updateResumeProblem({
    addedPlanCalls: session.tracker.planCallIds.length - opened,
    events: logs.value.desktopEvents,
    sinceIso: owed.value,
  });
  return { ...nothingYet({ view }), blocked: problem, live: true };
};
