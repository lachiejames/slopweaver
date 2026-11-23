/**
 * The effectful half of `hand post`'s look at its own `--url`: open the page in the owner's Chrome through the browser route,
 * let it draw, photograph it, read what it shows, and let go of the tab — all before the note goes up. The verdict on
 * what it read is `../../../hand/pageLook.ts`'s.
 *
 * The sequence is `browser inspect`'s (`../browser/inspectRun.ts`), for its reasons: the session record is written
 * BEFORE the browser is touched, so a process killed mid-look leaves a row `browser sessions` lists and `browser
 * close` can finish, and the tab is let go of in a `finally` whatever the look came to — with the record and its
 * workspace KEPT whenever letting go reported a problem. The picture is read out of that workspace before it is
 * removed, since the workspace is where the client wrote it.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { evalReplyValue } from "../../../browser/evalReply.js";
import { placementFromEnv, realForegroundRun } from "../../../browser/foreground.js";
import { type InteractionSession, sessionOwnerOf } from "../../../browser/interactionSession.js";
import {
  interactionSessionDir,
  makeInteractionWorkspace,
  removeInteractionWorkspace,
  writeInteractionSession,
} from "../../../browser/interactionSessionStore.js";
import { attachInBackground, BACKGROUND_ATTACH_ARGS } from "../../../browser/keepForeground.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import { prepareClientWorkspace, runClientCommand, type TerminalClientDeps } from "../../../browser/terminalClient.js";
import { lookAddress, PAGE_LOOK_PROBE, pageLookProblem, readPageLook } from "../../../hand/pageLook.js";
import { type ReadShot, readHandShot } from "../../../hand/shotStore.js";
import { closeOneShotLook, keptAliveDeps } from "../browser/sessionHold.js";
import { observe, ownerSessionId, sessionClientDeps } from "../browser/sessionShell.js";

/** What the post's look at its `--url` came to. */
export type HandPageLook =
  /** The page shows something; `picture` is what it showed, when the screenshot could be read. */
  | { readonly kind: "seen"; readonly picture: ReadShot | undefined }
  /** The page loaded and shows nothing — an error status, a page Chrome could not load, or an empty one. */
  | { readonly kind: "not-shown"; readonly why: string }
  /** The browser could not look at all — no pin, no extension, a client that failed. Nothing is known of the page. */
  | { readonly kind: "unlooked"; readonly why: string };

/**
 * Open a step's `--url` in the owner's Chrome — the document it frames, for a console viewer address (`lookAddress`) — judge
 * what it shows, and close the tab again.
 *
 * @param url the step's web address
 * @param home the state home the session record, the pin and the consent token live under
 * @param profiles the door the recorded work profile is read through, for the pin
 * @returns what the look came to
 */
export async function lookAtHandUrl({
  url: stepUrl,
  home,
  profiles,
}: {
  url: string;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<HandPageLook> {
  const url = lookAddress({ url: stepUrl });
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
  makeInteractionWorkspace({ workspace: session.workspace });
  const prepared = prepareClientWorkspace({ workspace: session.workspace });
  if (prepared.isErr()) {
    return { kind: "unlooked", why: prepared.error.message };
  }
  const resolved = await sessionClientDeps({ home, profiles, session });
  if (resolved.isErr()) {
    const removed = removeInteractionWorkspace({ home, id });
    const problems = removed.isErr() ? [...resolved.error, ...removed.error] : resolved.error;
    return { kind: "unlooked", why: problems.join("; ") };
  }
  // The client's own cap (`CLIENT_COMMAND_TIMEOUT_MS`), not `browser inspect`'s 6s one. MEASURED with
  // several other sessions holding the owner's Chrome: under the 6s cap this look and `browser inspect --url <github pull>`
  // both timed out before reaching the page, while `browser open --url <same page>` on the default cap reached it.
  // Repro: run those two verbs back to back while `slopweaver browser sessions` lists several live. A look that
  // times out refuses the post, so a tight cap trades a slower post for a note the owner never gets.
  const unheld: TerminalClientDeps = resolved.value;
  const recorded = writeInteractionSession({ home, stored: { observation: null, session } });
  if (recorded.isErr()) {
    return { kind: "unlooked", why: recorded.error.message };
  }
  // A reap can judge the record from here on, so the look's commands hold its lock and the close takes it, as
  // every browser verb's do.
  const deps = keptAliveDeps({ deps: unheld, home, sessionId: id });
  let looked: HandPageLook;
  try {
    looked = lookOnce({ deps, nowIso, url });
  } finally {
    // The picture is read into memory by now, so the workspace may go with the record.
    closeOneShotLook({ deps: unheld, home, id });
  }
  return looked;
}

/** Attach, go to the address, let it draw and photograph it, then read what it shows — every step touching the owner's browser. */
function lookOnce({ deps, url, nowIso }: { deps: TerminalClientDeps; url: string; nowIso: string }): HandPageLook {
  // The attach brings the agent window forward; unless this run chose to show it, it goes straight back
  // (`../../../browser/keepForeground.ts`).
  const attached = attachInBackground({
    attach: () => runClientCommand({ args: BACKGROUND_ATTACH_ARGS, deps, mayAct: true }),
    placement: deps.placement,
    run: realForegroundRun,
  });
  if (attached.isErr()) {
    return { kind: "unlooked", why: attached.error.message };
  }
  const visited = runClientCommand({ args: ["goto", url], deps, mayAct: true });
  if (visited.isErr()) {
    // A failed `goto` may echo the page's own text, so only the step is named.
    return { kind: "unlooked", why: "the browser client could not go to the address" };
  }
  // `observe` waits for the page to finish drawing before it photographs it, so the read below sees what the owner would.
  const observation = observe({ deps, nowIso });
  if (observation.isErr()) {
    return { kind: "unlooked", why: observation.error.message };
  }
  const reply = runClientCommand({ args: ["eval", PAGE_LOOK_PROBE], deps });
  if (reply.isErr()) {
    return { kind: "unlooked", why: "the browser client could not read the page" };
  }
  const reading = readPageLook({ value: evalReplyValue({ stdout: reply.value.stdout }) });
  if (reading === undefined) {
    return { kind: "unlooked", why: "the page's reading did not come back in the shape the look asks for" };
  }
  const problem = pageLookProblem({ reading });
  if (problem !== undefined) {
    return { kind: "not-shown", why: problem };
  }
  const shotPath = observation.value.screenshotPath;
  if (shotPath === null) {
    return { kind: "seen", picture: undefined };
  }
  const picture = readHandShot({ path: shotPath });
  return { kind: "seen", picture: picture.isOk() ? picture.value : undefined };
}
