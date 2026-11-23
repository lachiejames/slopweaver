/**
 * Which session the records name as the chair, and on which host — the one answer every reader that would otherwise
 * judge the cmux-pinned workspace's Claude tab asks first, so a Codex chair is never judged through a Claude session
 * beside it.
 *
 * The supervisor pin record decides when there is one. With none, the chain journal's newest link is the only
 * record of who took the chair, so it decides instead: a Codex thread named there is still the chair, and a reader
 * that fell through to the Claude tab would report that tab as the chair, clean. With neither,
 * nothing on disk names a host, and the reader keeps its base behaviour.
 *
 * Both reads are STRICT. A pin that is there and will not parse, a chain line that will not decode, or a link whose
 * instant will not parse could each be the newest record of the chair, so each makes the answer `unresolved` rather
 * than letting an older Claude link decide it: read as absence, a mixed-shape Codex pin let an older Claude link
 * authorise a Claude-only read.
 */
import type { SupervisorPinDisposition } from "../sessions/supervisorPinStore.js";
import { readSupervisorPinDisposition } from "../sessions/supervisorPinStore.js";
import type { SupervisorLink } from "./chain.js";
import { readSupervisorChainJournal } from "./chainStore.js";
import type { VisibleSessionHost, VisibleSupervisorSession } from "./session.js";

/** What the records say about the chair: nothing, one session, or evidence that could not be trusted. */
export type RecordedChair =
  | { readonly kind: "absent" }
  | { readonly kind: "session"; readonly session: VisibleSupervisorSession; readonly pinnedAtIso: string }
  | { readonly kind: "unresolved"; readonly why: string };

/** The recorded chair's host, `unresolved` when the records could not be trusted to name one. */
export type RecordedChairHost = VisibleSessionHost | "unresolved";

/** Why a Claude-only reader stops when the records could not be trusted to name the chair's host. */
export const UNRESOLVED_CHAIR_RECORD =
  "the supervisor pin or chain journal would not read cleanly, so which host holds the chair is unknown and no Claude session in the pinned workspace is judged as the chair";

/** Why a reader stops when no pin record or chain link names the chair at all: no measured signal says who holds it. */
export const UNMEASURED_CHAIR_HOST =
  "no supervisor pin record or chain link names the chair, so which session holds it is UNMEASURED and no session in the pinned workspace is judged as the chair";

/**
 * The recorded chair and the instant its record took the chair: the pin's; with the pin genuinely absent, the chain's
 * newest link's — unless any record that could be newer was refused, or the chosen instant will not parse.
 *
 * @param pin the strict pin read
 * @param chain the strict chain read: every link it decoded, and what it could not read
 * @returns the chair, nothing recorded, or why the records are not trusted
 */
export function recordedChairOf({
  pin,
  chain,
}: {
  pin: SupervisorPinDisposition;
  chain: { readonly links: readonly SupervisorLink[]; readonly problems: readonly string[] };
}): RecordedChair {
  if (pin.kind === "unreadable") {
    return { kind: "unresolved", why: pin.why };
  }
  // A refused or undated chain line is checked even beside a valid pin: it could be a newer link the pin write
  // missed, naming a Codex chair the pin does not.
  if (chain.problems.length > 0) {
    return { kind: "unresolved", why: chain.problems.join("; ") };
  }
  if (chain.links.some((link) => Number.isNaN(Date.parse(link.pinnedAtIso)))) {
    return { kind: "unresolved", why: "a supervisor chain link carries an instant that does not parse" };
  }
  if (pin.kind === "pin") {
    const { pinnedAtIso, session } = pin.record;
    if (Number.isNaN(Date.parse(pinnedAtIso))) {
      return { kind: "unresolved", why: "the supervisor pin carries an instant that does not parse" };
    }
    return { kind: "session", pinnedAtIso, session };
  }
  const newest = chain.links
    .toSorted((left, right) => Date.parse(left.pinnedAtIso) - Date.parse(right.pinnedAtIso))
    .at(-1);
  if (newest === undefined) {
    return { kind: "absent" };
  }
  return { kind: "session", pinnedAtIso: newest.pinnedAtIso, session: newest.session };
}

/**
 * {@link recordedChairOf} over the pin record and chain journal in a home.
 *
 * @param home the Slopweaver home the pin and chain journal live under
 * @returns the chair, nothing recorded, or why the records are not trusted
 */
export function readRecordedChair({ home }: { home: string }): RecordedChair {
  return recordedChairOf({
    chain: readSupervisorChainJournal({ home }),
    pin: readSupervisorPinDisposition({ home }),
  });
}

/**
 * The recorded chair's host, as {@link readRecordedChair} names the chair.
 *
 * @param home the Slopweaver home the pin and chain journal live under
 * @returns the host, `unresolved` when the records are not trusted, or `undefined` when nothing is recorded
 */
export function readRecordedChairHost({ home }: { home: string }): RecordedChairHost | undefined {
  const chair = readRecordedChair({ home });
  if (chair.kind === "absent") {
    return undefined;
  }
  if (chair.kind === "unresolved") {
    return "unresolved";
  }
  return chair.session.host;
}
