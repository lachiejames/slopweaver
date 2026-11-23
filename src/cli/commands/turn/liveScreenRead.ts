/**
 * One fresh-visible-session dispatch's live truth — the durable marker `turn resume` writes on completion,
 * checked FIRST (no cmux needed, so it sidesteps whatever TUI quirk might hide a screen-scraped marker),
 * falling back to a live screen read only when no current-generation marker exists.
 *
 * ## The third question, added after the screen answered the wrong one
 *
 * A marker says the turn FINISHED and a screen says what it last PRINTED. Neither says a session still
 * exists, and `freshScreenTruth`'s default arm is `working` — so a dispatch whose workspace had been closed
 * read as healthy progress forever. Once the marker and the screen have both declined to report a finish,
 * this module asks the one remaining question through `cmux/liveness.ts`: does the workspace the dispatch
 * record NAMES still hold a running host? A `phantom` answer replaces `working`/`unreachable`; `alive` and
 * `unknown` leave the screen's own verdict exactly as it was, because a broken oracle must never manufacture
 * a phantom.
 *
 * ## A ready from before the first answer is not a ready
 *
 * A dispatch whose worker posted a first answer with follow-through owed keeps its lease token, so the plan's
 * own ready marker stays generation-bound. Given `notBeforeIso` — that first answer's instant — a durable ready
 * recorded earlier (or with no time at all) is skipped, and a screen-scraped ready is read as `working`, so
 * the liveness question is asked and a builder that vanished after its plan reads `phantom`.
 * `../../../live/turn/turnMarkerStore.ts`'s `markerOutlivesFirstAnswer` carries the measurement.
 */
import { realWorkspaceLivenessCheck, type WorkspaceLivenessCheck } from "../../../cmux/liveness.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { type FreshScreenTruth, freshScreenTruth } from "../../../live/turn/dispatch.js";
import {
  markerOutlivesFirstAnswer,
  readCurrentGenerationTurnMarker,
  turnMarkerTruth,
} from "../../../live/turn/turnMarkerStore.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";

/** A fresh workspace's live screen, read once: the raw text AND its classified truth, together. */
export interface LiveScreenRead {
  readonly screen: string;
  readonly truth: FreshScreenTruth;
}

/**
 * Reading one surface's text — injected so the marker-first-then-screen DECISION is testable without a
 * running cmux, which is the only part of this module that has any logic in it at all.
 */
export type SurfaceReader = (options: {
  workspaceId: string;
  surfaceId: string;
}) => Promise<{ readonly screen: string } | { readonly unreachable: string }>;

/**
 * The production surface reader: one connection, opened and closed around a single read. A screen read is
 * cmux-only, named on the host surface as what stage 2 replaces with the session's own events.
 *
 * @returns the reader
 */
function realSurfaceReader(): SurfaceReader {
  return ({ workspaceId, surfaceId }) =>
    withCmuxSessionHost({
      body: async ({ host }) => {
        const read = await host.readScreen({ target: { surfaceId, workspaceId } });
        return read.isOk() ? { screen: read.value } : { unreachable: read.error.message };
      },
    });
}

/**
 * Whether a screen-derived truth is one the liveness check may override — the two arms that say nothing
 * about existence. A `ready` or `failed` marker is a report from the session itself and outranks any later
 * liveness verdict: a session that finished and then exited is DONE, not a phantom. Pure.
 *
 * @param truth the screen's own verdict
 * @returns whether liveness should be consulted at all
 */
function needsLivenessCheck({ truth }: { truth: FreshScreenTruth }): boolean {
  return truth.kind === "working" || truth.kind === "unreachable";
}

/**
 * One surface read, classified — with a scraped `ready` read as `working` once a first answer stands, because
 * the screen cannot say WHEN its marker was printed and the plan's own may still be on it. Pure.
 *
 * @param read what the surface reader returned
 * @param notBeforeIso the first answer's instant, or `undefined` when none stands
 * @returns the screen's truth
 */
function screenTruthOf({
  dispatchId,
  notBeforeIso,
  read,
}: {
  dispatchId: string;
  notBeforeIso: string | undefined;
  read: { readonly screen: string } | { readonly unreachable: string };
}): FreshScreenTruth {
  if (!("screen" in read)) {
    return { kind: "unreachable", reason: read.unreachable };
  }
  const truth = freshScreenTruth({ dispatchId, screen: read.screen });
  return truth.kind === "ready" && notBeforeIso !== undefined ? { kind: "working" } : truth;
}

/**
 * Read one dispatch's current truth.
 *
 * @param askIdentity the ask this dispatch is for — resolves the durable marker file
 * @param dispatchId the dispatch being polled — a marker naming a different id is ignored, not accepted
 * @param home the resolved state home
 * @param surfaceId the workspace surface to read when no durable marker is found
 * @param workspaceId the workspace to read when no durable marker is found, and to check liveness against
 * @param readSurface the surface reader, defaulting to a real cmux client
 * @param checkLiveness the workspace liveness check, defaulting to a real cmux client
 * @param notBeforeIso when this dispatch's first answer was posted — a ready from before it is the plan's,
 *   not the build's; `undefined` when no first answer stands
 * @returns the live truth, and the raw screen text when a read was actually needed (empty otherwise)
 */
export async function liveScreenRead({
  askIdentity,
  dispatchId,
  home,
  surfaceId,
  workspaceId,
  readSurface = realSurfaceReader(),
  checkLiveness = realWorkspaceLivenessCheck(),
  notBeforeIso,
}: {
  askIdentity: AskIdentity;
  dispatchId: string;
  home: string;
  surfaceId: string;
  workspaceId: string;
  readSurface?: SurfaceReader;
  checkLiveness?: WorkspaceLivenessCheck;
  notBeforeIso?: string | undefined;
}): Promise<LiveScreenRead> {
  const marker = readCurrentGenerationTurnMarker({ askIdentity, home });
  if (marker?.dispatchId === dispatchId && markerOutlivesFirstAnswer({ marker, notBeforeIso })) {
    return { screen: "", truth: turnMarkerTruth({ dispatchId, marker }) };
  }
  const read = await readSurface({ surfaceId, workspaceId });
  const screen = "screen" in read ? read.screen : "";
  const truth: FreshScreenTruth = screenTruthOf({ dispatchId, notBeforeIso, read });
  if (!needsLivenessCheck({ truth })) {
    return { screen, truth };
  }
  const liveness = await checkLiveness({ workspaceId });
  return liveness.kind === "phantom"
    ? { screen, truth: { kind: "phantom", reason: liveness.reason, workspaceId } }
    : { screen, truth };
}
