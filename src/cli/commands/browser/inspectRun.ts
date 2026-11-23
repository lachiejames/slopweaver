/**
 * `slopweaver browser inspect --url <address>` — open one page in the owner's own Chrome, take the look `browser open`
 * takes, and close the tab again, in one call. The effectful shell; `src/browser/inspect.ts` decides.
 *
 * It is `open`, the snapshot read, and `close` fused, because its caller is the console voice: three separately
 * timed calls could strand a tab in the owner's browser between any two of them. So the whole look runs under one
 * budget — each client command capped at {@link INSPECT_COMMAND_TIMEOUT_MS} rather than the client's own
 * minute — and the tab is let go of in a `finally`, whatever the look came to.
 *
 * The session record is written BEFORE the browser is touched, so a process killed mid-look leaves a row
 * `browser sessions` lists and `browser close` can finish, rather than a tab nothing knows about — and it is
 * KEPT, workspace and all, whenever letting go of the tab reported a problem, for the same reason.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { placementFromEnv, realForegroundRun } from "../../../browser/foreground.js";
import {
  INSPECT_ANSWER_MAX_BYTES,
  InspectErrors,
  inspectAnswer,
  landingProblem,
  resolveInspectUrl,
} from "../../../browser/inspect.js";
import { type InteractionSession, type PageObservation, sessionOwnerOf } from "../../../browser/interactionSession.js";
import { interactionSessionDir, writeInteractionSession } from "../../../browser/interactionSessionStore.js";
import { attachInBackground, BACKGROUND_ATTACH_ARGS } from "../../../browser/keepForeground.js";
import { ATTACH_TIMEOUT_MS, INSPECT_COMMAND_TIMEOUT_MS } from "../../../browser/lookBudget.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import { outlineSnapshot } from "../../../browser/snapshotOutline.js";
import { readSnapshotYaml } from "../../../browser/snapshotOutlineRun.js";
import { prepareClientWorkspace, runClientCommand, type TerminalClientDeps } from "../../../browser/terminalClient.js";
import { datadogSiteRefusalFor } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { closeOneShotLook, keptAliveDeps } from "./sessionHold.js";
import { clientDeps, fail, observe, ownerSessionId, resolveSessionPin } from "./sessionShell.js";
import { BROWSER_USAGE } from "./usage.js";

/**
 * The outline one inspect answer carries: 14 KiB of lines, so the answer's JSON escaping and envelope stay inside
 * {@link INSPECT_ANSWER_MAX_BYTES}, which `inspectAnswer` still enforces on the serialised document.
 */
const INSPECT_OUTLINE_BUDGET = { maxBytes: 14 * 1024, maxLines: 400 };

/**
 * Run `browser inspect` from the parsed flags: validate the address, then look.
 *
 * @param url the raw `--url` value
 * @param home the state home the session record lives under
 * @param profiles the door the recorded work profile is read through, once the address is known to be lookable
 * @returns the process exit code
 */
export async function runInspect({
  url,
  home,
  profiles,
}: {
  url: string | undefined;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<number> {
  const resolved = resolveInspectUrl({ url });
  if (resolved.isErr()) {
    logger.error({ msg: resolved.error.message });
    logger.error({ msg: BROWSER_USAGE });
    return EXIT_USAGE;
  }
  const wrongSite = datadogSiteRefusalFor({
    command: "slopweaver browser inspect",
    home,
    url: resolved.value,
  });
  if (wrongSite !== undefined) {
    logger.error({ msg: wrongSite });
    return EXIT_ERROR;
  }
  const pin = await resolveSessionPin({ home, profiles });
  if (pin.isErr()) {
    return fail({ problems: pin.error });
  }
  return runBrowserInspect({ chromePinPath: pin.value, home, url: resolved.value });
}

/**
 * Look at one validated address.
 *
 * @param url the address, already validated by `resolveInspectUrl`
 * @param home the state home the session record lives under
 * @param chromePinPath the profile pin script resolved from the recorded profile
 * @returns the process exit code
 */
function runBrowserInspect({ url, home, chromePinPath }: { url: string; home: string; chromePinPath: string }): number {
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const session: InteractionSession = {
    clientSession: `slopweaver-${id.slice(0, 8)}`,
    id,
    openedAtIso: nowIso,
    origins: [new URL(url).origin],
    owner: sessionOwnerOf({ cwd: process.cwd(), env: process.env }),
    ownerSessionId: ownerSessionId(),
    placement: placementFromEnv({ env: process.env }),
    touchedAtIso: nowIso,
    workspace: join(interactionSessionDir({ home, id }), "client"),
  };
  mkdirSync(session.workspace, { mode: 0o700, recursive: true });
  const prepared = prepareClientWorkspace({ workspace: session.workspace });
  if (prepared.isErr()) {
    return fail({ problems: [prepared.error.message] });
  }
  const resolved = clientDeps({ chromePinPath, home, session });
  if (resolved.isErr()) {
    return fail({ problems: resolved.error });
  }
  const unheld: TerminalClientDeps = { ...resolved.value, commandTimeoutMs: INSPECT_COMMAND_TIMEOUT_MS };
  const recorded = writeInteractionSession({ home, stored: { observation: null, session } });
  if (recorded.isErr()) {
    return fail({ problems: [recorded.error.message] });
  }
  // A reap can judge the record from here on, so the look's commands hold its lock and the close takes it, as
  // every other verb's do.
  const deps = keptAliveDeps({ deps: unheld, home, sessionId: id });
  let looked: Result<{ observation: PageObservation; snapshot: LookedSnapshot }>;
  let cleanup: readonly string[] = [];
  try {
    looked = lookOnce({ deps, nowIso, url });
  } finally {
    const failures = closeOneShotLook({ deps: unheld, home, id });
    cleanup = failures === 0 ? [] : [InspectErrors.closeFailed({ count: failures }).message];
  }
  if (looked.isErr()) {
    return fail({ problems: [...looked.error, ...cleanup] });
  }
  const { observation, snapshot } = looked.value;
  const answer = inspectAnswer({
    cleanup,
    elements: snapshot.text,
    elementsBytes: snapshot.bytes,
    maxBytes: INSPECT_ANSWER_MAX_BYTES,
    outlineCut: snapshot.outlineCut,
    requestedUrl: url,
    title: observation.title,
    url: observation.url,
  });
  logger.out({ line: JSON.stringify(answer) });
  return EXIT_OK;
}

/** The one snapshot a look read: its outline, the raw file's size, and whether the outline's budget cut it. */
interface LookedSnapshot {
  readonly text: string;
  readonly bytes: number;
  readonly outlineCut: boolean;
}

/** Attach, go to the address, take one look, and read its snapshot — every step that can touch the owner's browser. */
function lookOnce({
  deps,
  url,
  nowIso,
}: {
  deps: TerminalClientDeps;
  url: string;
  nowIso: string;
}): Result<{ observation: PageObservation; snapshot: LookedSnapshot }> {
  for (const args of [BACKGROUND_ATTACH_ARGS, ["goto", url]]) {
    // The attach brings the agent window forward; unless this run chose to show it, it goes straight back
    // (`../../../browser/keepForeground.ts`).
    const ran =
      args === BACKGROUND_ATTACH_ARGS
        ? attachInBackground({
            attach: () => runClientCommand({ args, deps, mayAct: true, timeoutMs: ATTACH_TIMEOUT_MS }),
            placement: deps.placement,
            run: realForegroundRun,
          })
        : runClientCommand({ args, deps, mayAct: true });
    if (ran.isErr()) {
      // Attaching happens before any page, so its own words are safe to pass on; a failed `goto` may already
      // hold the page's text — the client reports an in-page error with what follows it.
      const step = args[0]!;
      return err([step === "attach" ? ran.error.message : InspectErrors.clientFailed({ step }).message]);
    }
  }
  const observation = observe({ deps, nowIso });
  if (observation.isErr()) {
    return err([InspectErrors.clientFailed({ step: "look" }).message]);
  }
  const landed = landingProblem({ url: observation.value.url });
  if (landed !== undefined) {
    return err([landed.message]);
  }
  const yaml = readSnapshotYaml({ path: observation.value.snapshotPath });
  if (yaml.isErr()) {
    return err([InspectErrors.snapshotUnreadable({ path: observation.value.snapshotPath }).message]);
  }
  // The voice gets ONE look and its tab closes, so there is no `--under` to come back with: the outline is opened
  // breadth-first to a budget the answer's 20 KiB envelope still holds, never a head-cut of the raw file.
  const outline = outlineSnapshot({ budget: INSPECT_OUTLINE_BUDGET, under: undefined, yaml: yaml.value });
  if (outline.isErr()) {
    return err([outline.error.message]);
  }
  return ok({
    observation: observation.value,
    snapshot: { bytes: outline.value.fullBytes, outlineCut: outline.value.cut, text: outline.value.lines.join("\n") },
  });
}
