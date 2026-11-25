/**
 * One SUPERVISOR CHAIN link — a session that held the supervisor pin, where it was hosted, and when it took the pin —
 * and the journal line it is written as. `./chain.ts` orders and windows the links; this file only says what one is.
 *
 * Pure: a line or a pin record in, a link out. No filesystem, no clock.
 */

import { err, ok, type Result } from "#lib/result.js";
import { isRecord } from "../lib/parsers.js";
import { APP_SESSION_HANDLE_PREFIX } from "../sessionHarness/appProtocol.js";
import { isBareSessionId } from "../sessions/liveSessionStore.js";
import { type SupervisorPinRecord, type SupervisorPinTarget, supervisorPinTarget } from "../sessions/supervisorPin.js";
import { recordedSupervisorSession, supervisorSessionKey, type VisibleSupervisorSession } from "./session.js";

/** How a link got into the journal — recorded live by the pin verb, or recovered from the transcripts. */
export type SupervisorLinkSource = "pin" | "scan";

/** The two link sources, in the order a usage line lists them. */
const SUPERVISOR_LINK_SOURCES: readonly SupervisorLinkSource[] = ["pin", "scan"];

/* What every link carries, wherever its session was hosted. */
interface SupervisorLinkCommon {
  /**
   * The session — a Claude Code session (its transcript's basename) or a Codex thread (its rollout's
   * `session_meta` id), so the link is checkable. A pre-Codex journal line's `claudeSessionId` reads as Claude.
   */
  readonly session: VisibleSupervisorSession;
  /** When this session took the pin — the floor its own turns are read from. */
  readonly pinnedAtIso: string;
  readonly source: SupervisorLinkSource;
}

/* A link for a chair in a cmux workspace — every journal line written before the app could host one. */
interface CmuxSupervisorLink extends SupervisorLinkCommon {
  /** cmux's own id for the workspace it ran in, or "" when a scan recovered the link without one. */
  readonly workspaceId: string;
  /** The addressable ref (`workspace:936`), or "" when a scan recovered the link without one. */
  readonly workspaceRef: string;
}

/* A link for a chair the desktop app hosted. */
interface AppSupervisorLink extends SupervisorLinkCommon {
  /** The desktop control plane's id for the hosted session. */
  readonly appSessionId: string;
}

/** One session that held the supervisor pin, hosted in a cmux workspace or by the desktop app. */
export type SupervisorLink = CmuxSupervisorLink | AppSupervisorLink;

/** Why a chain link could not be built. Each code names the field that failed. */
export type SupervisorChainError =
  | { readonly code: "SESSION_ID_INVALID"; readonly message: string }
  | { readonly code: "PIN_INSTANT_INVALID"; readonly message: string }
  | { readonly code: "TARGET_INVALID"; readonly message: string };

/* The factory for SupervisorChainError, so every refusal carries the same words. */
const SupervisorChainErrors = {
  pinInstantInvalid: ({ pinnedAtIso }: { pinnedAtIso: string }): SupervisorChainError => ({
    code: "PIN_INSTANT_INVALID",
    message: `${pinnedAtIso} is not an instant — a link with no readable instant orders nothing`,
  }),
  sessionIdInvalid: (): SupervisorChainError => ({
    code: "SESSION_ID_INVALID",
    message: "a chain link needs a session id — the transcript it names is what makes it checkable",
  }),
  targetInvalid: ({ appSessionId }: { appSessionId: string }): SupervisorChainError => ({
    code: "TARGET_INVALID",
    message: `"${appSessionId}" is not an app session id — a link must name the hosted session it vouches for`,
  }),
} as const;

/**
 * Where a link's session was hosted, as a discriminated value, so no renderer probes the link's fields itself.
 *
 * @returns the cmux workspace or the app session the link names
 */
export function supervisorLinkTarget({ link }: { link: SupervisorLink }): SupervisorPinTarget {
  if ("appSessionId" in link) {
    return { appSessionId: link.appSessionId, kind: "app" };
  }
  return { kind: "cmux", workspaceId: link.workspaceId, workspaceRef: link.workspaceRef };
}

/**
 * The label a reader is shown for where a link's chair ran: the workspace ref (blank for a scan that saw none)
 * or `app:<id>`.
 *
 * @returns the addressable label
 */
export function supervisorLinkLabel({ link }: { link: SupervisorLink }): string {
  const target = supervisorLinkTarget({ link });
  return target.kind === "app" ? `${APP_SESSION_HANDLE_PREFIX}${target.appSessionId}` : target.workspaceRef;
}

/**
 * The live pin record as a `pin` link, keeping whichever location arm it carries, so a chair the journal never
 * caught is still read.
 *
 * @returns the link the pin record stands for
 */
export function linkFromPin({ pin }: { pin: SupervisorPinRecord }): SupervisorLink {
  const common = { pinnedAtIso: pin.pinnedAtIso, session: pin.session, source: "pin" } as const;
  const target = supervisorPinTarget({ pin });
  if (target.kind === "app") {
    return { ...common, appSessionId: target.appSessionId };
  }
  return { ...common, workspaceId: target.workspaceId, workspaceRef: target.workspaceRef };
}

function linkLocation({
  parsed,
}: {
  parsed: Readonly<Record<string, unknown>>;
}): { readonly appSessionId: string } | { readonly workspaceId: string; readonly workspaceRef: string } | undefined {
  const appSessionId = parsed["appSessionId"];
  const workspaceId = parsed["workspaceId"];
  const workspaceRef = parsed["workspaceRef"];
  if (appSessionId !== undefined) {
    const bare = typeof appSessionId === "string" && isBareSessionId({ sessionId: appSessionId });
    const mixed = workspaceId !== undefined || workspaceRef !== undefined || parsed["claudeSessionId"] !== undefined;
    return bare && !mixed && parsed["session"] !== undefined ? { appSessionId } : undefined;
  }
  if (typeof workspaceId !== "string" || typeof workspaceRef !== "string") {
    return undefined;
  }
  return { workspaceId, workspaceRef };
}

/**
 * Read one journal line, refusing anything that is not completely a link.
 *
 * @param line one line of the journal
 * @returns the link, or `undefined` for a blank, malformed, incomplete or mixed-shape line
 */
export function parseSupervisorLinkLine({ line }: { line: string }): SupervisorLink | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  // A pre-Codex line's `claudeSessionId` reads as Claude; a line carrying both shapes is refused. An app line
  // needs the canonical session and no workspace field; a line mixing the two locations is refused.
  const session = recordedSupervisorSession({ record: parsed });
  const location = linkLocation({ parsed });
  const pinnedAtIso = parsed["pinnedAtIso"];
  const source = SUPERVISOR_LINK_SOURCES.find((known) => known === parsed["source"]);
  if (
    session === undefined ||
    location === undefined ||
    typeof pinnedAtIso !== "string" ||
    Number.isNaN(Date.parse(pinnedAtIso)) ||
    source === undefined
  ) {
    return undefined;
  }
  return { pinnedAtIso, session, source, ...location };
}

/**
 * Every decodable link in a journal, in file order.
 *
 * @param text the whole journal
 * @returns the links; a line that will not decode is skipped rather than failing the read
 */
export function parseSupervisorChainJournal({ text }: { text: string }): readonly SupervisorLink[] {
  return text
    .split("\n")
    .map((line) => parseSupervisorLinkLine({ line }))
    .filter((link): link is SupervisorLink => link !== undefined);
}

/**
 * Build one link, refusing a blank session id, an instant that will not parse, or an app session id that is
 * not a bare id. A cmux target's blank workspace stays allowed: a rescan recovers links without one.
 *
 * @param session the visible session taking the pin — Claude Code or Codex
 * @param target where it is hosted: a cmux workspace or a desktop-app session
 * @param pinnedAtIso when it took the pin
 * @param source whether the pin verb recorded it or a rescan recovered it
 * @returns the link, or which field refused it
 */
export function buildSupervisorLink({
  session,
  target,
  pinnedAtIso,
  source,
}: {
  session: VisibleSupervisorSession;
  target: SupervisorPinTarget;
  pinnedAtIso: string;
  source: SupervisorLinkSource;
}): Result<SupervisorLink, SupervisorChainError> {
  const id = session.id.trim();
  if (id.length === 0) {
    return err(SupervisorChainErrors.sessionIdInvalid());
  }
  if (Number.isNaN(Date.parse(pinnedAtIso))) {
    return err(SupervisorChainErrors.pinInstantInvalid({ pinnedAtIso }));
  }
  const common = { pinnedAtIso, session: { host: session.host, id }, source };
  if (target.kind === "app") {
    if (!isBareSessionId({ sessionId: target.appSessionId })) {
      return err(SupervisorChainErrors.targetInvalid({ appSessionId: target.appSessionId }));
    }
    return ok({ ...common, appSessionId: target.appSessionId });
  }
  return ok({ ...common, workspaceId: target.workspaceId, workspaceRef: target.workspaceRef });
}

/**
 * The key a link's session is grouped by — host AND id, so a Claude session and a Codex thread sharing an opaque
 * string stay two sessions.
 *
 * @returns its session's reversible key
 */
export function linkKey({ link }: { link: SupervisorLink }): string {
  return supervisorSessionKey({ session: link.session });
}
