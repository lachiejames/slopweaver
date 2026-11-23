/**
 * `slopweaver browser read` — the effectful shell of a look, and of opening more of the latest one.
 *
 * A plain read takes a fresh look through `./sessionShell.ts` and prints its outline (`./elementsReceipt.ts`).
 * `--under <ref>` and `--find <text>` take NO look: they never reach the browser, mint no observation and leave
 * the session record untouched, so the observation id they print is the one `act` already accepts and every ref
 * they show is still aimable. A session handed a massive dump of junk in its context
 * window does worse work, and reading the whole filed snapshot to find one ref was that dump.
 */
import type { PageObservation } from "../../../browser/interactionSession.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ElementsSelection, elementsLines, resolveElementsSelection } from "./elementsReceipt.js";
import { renderObservation } from "./lookReceipt.js";
import { claimLiveSession, fileLook, keptAliveDeps } from "./sessionHold.js";
import { fail, liveSession, observe, sessionClientDeps } from "./sessionShell.js";
import { BROWSER_USAGE } from "./usage.js";

/**
 * Run `browser read`: look at the session's page and hand back an outline of its elements — or, with
 * `--under`/`--find`, print part of the session's LATEST look without taking a new one.
 *
 * @param sessionId the session to read
 * @param json whether machine-readable output was asked for
 * @param under the ref to open out of the latest look, as typed
 * @param find the text to search the latest look for, as typed
 * @param home the state home
 * @param profiles the door the recorded work profile is read through
 * @returns the process exit code
 */
export async function runBrowserRead({
  sessionId,
  json,
  under,
  find,
  home,
  profiles,
}: {
  sessionId: string;
  json: boolean;
  under: string | undefined;
  find: string | undefined;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<number> {
  const resolved = resolveElementsSelection({ find, under });
  if (resolved.isErr()) {
    logger.error({ msg: resolved.error.message });
    logger.error({ msg: BROWSER_USAGE });
    return EXIT_USAGE;
  }
  const nowIso = new Date().toISOString();
  if (resolved.value.kind !== "outline") {
    const filedOnly = liveSession({ home, nowIso, sessionId });
    if (filedOnly.isErr()) {
      return fail({ problems: [filedOnly.error.message] });
    }
    return printFiled({ json, observation: filedOnly.value.observation, selection: resolved.value, sessionId });
  }
  return readOutline({ home, json, nowIso, profiles, sessionId });
}

/* Take a new look through the session's tab and print its outline — the read that reaches the browser. */
async function readOutline({
  home,
  json,
  nowIso,
  profiles,
  sessionId,
}: {
  home: string;
  json: boolean;
  nowIso: string;
  profiles: RecordedProfilePort;
  sessionId: string;
}): Promise<number> {
  // A plain read reaches the tab, so it claims the session before it looks.
  const live = claimLiveSession({ home, nowIso, sessionId });
  if (live.isErr()) {
    return fail({ problems: [live.error.message] });
  }
  const deps = (await sessionClientDeps({ home, profiles, session: live.value.session })).map((client) =>
    keptAliveDeps({ deps: client, home, sessionId }),
  );
  if (deps.isErr()) {
    return fail({ problems: deps.error });
  }
  const observation = observe({ deps: deps.value, nowIso });
  if (observation.isErr()) {
    return fail({ problems: [observation.error.message] });
  }
  const filed = fileLook({
    home,
    notFiled: `the look was taken but not filed: observation ${observation.value.id} is not citable, and the session's latest look is unchanged`,
    nowIso,
    observation: observation.value,
    session: live.value.session,
  });
  if (filed.isErr()) {
    return fail({ problems: filed.error });
  }
  if (json) {
    logger.out({ line: JSON.stringify(observation.value, null, 2) });
    return EXIT_OK;
  }
  for (const line of [...renderObservation({ observation: observation.value }), ...filed.value]) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/** Print one ref's subtree, or a search, out of the session's latest look — no browser, no new observation. */
function printFiled({
  observation,
  selection,
  sessionId,
  json,
}: {
  observation: PageObservation | null;
  selection: ElementsSelection;
  sessionId: string;
  json: boolean;
}): number {
  if (observation === null) {
    return fail({
      problems: [
        `session ${sessionId} has no look yet to open — take one with \`slopweaver browser read --session ${sessionId}\``,
      ],
    });
  }
  const elements = elementsLines({ observation, selection, sessionId });
  if (elements.isErr()) {
    return fail({ problems: [elements.error.message] });
  }
  if (json) {
    logger.out({ line: JSON.stringify({ lines: elements.value, observation }, null, 2) });
    return EXIT_OK;
  }
  const header = [
    `browser read: ${observation.url} — from the look of ${observation.observedAtIso}; the browser was not read again`,
    `  observation: ${observation.id}`,
  ];
  for (const line of [...header, ...elements.value]) {
    logger.out({ line });
  }
  return EXIT_OK;
}
