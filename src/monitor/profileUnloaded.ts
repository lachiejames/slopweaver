/**
 * `profile-unloaded` — a running session the owner's profile never reached, reported as a recovery already in flight.
 *
 * A fleet running without the owner's profile is no longer operating in alignment with them, which needs their
 * attention right away; but the recovery must be automatic, with no more floating notes and no asking the owner to
 * say so every time. So the session recovers itself — the PreToolUse `profile-held` check (`../admit/profileHeld.ts`) holds its next guarded
 * call and delivers the profile in the refusal — and this card does not float: it says the
 * reload is under way and asks the owner for nothing.
 *
 * ## Why the chair's tick, and not the failing session
 *
 * The case measured is a seat booted on a worktree checked out before the hook existed: its boot hook never runs, and
 * every verb it runs is ITS tree's code, which has neither the load ledger nor the door gate. Nothing inside that
 * seat can say anything. Only a pass running current code outside it — the chair's tick, which fires this — can
 * read that seat's own transcript and see the hook that never ran.
 *
 * ## A notice that asks nothing
 *
 * Nothing waits on the owner: a seat on current hooks is held on its next guarded call and reloads there. So the card asks
 * nothing, is on no queue (the shape `org-health` has), and posts quietly. It claims that recovery only for a session
 * the hold has provably met — its newest failure is the hold's own `PreToolUse` row — and names every other one "not
 * yet held", because a seat on hooks older than the hold looks identical from here until it is met.
 *
 * ## One card for the set, keyed on the newest failure
 *
 * The key names the newest failing session and the minute it failed, so a NEW failure re-floats and an unchanged
 * set says nothing more. A key the owner closed, or one already shown and taken down, is held rather than re-posted — the
 * session it names is still unloaded, which is exactly why it would otherwise come back every tick.
 *
 * Pure: observations in, a reading out. The reads are `./profileUnloadedSource.ts`.
 */
import { type ProfileLoadObservation, unloadedSessions } from "../context/loadLedger.js";
import { MARKER_UNWRITTEN_REASON } from "../context/profileDelivery.js";
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** This monitor's id. */
const MONITOR_ID = "profile-unloaded";

/** How long since a session last wrote that it still counts as running, and so as worth a note. */
export const PROFILE_UNLOADED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How much of a session id a card names — enough to find the transcript, short enough for the step id. */
const SHORT_ID_LENGTH = 8;

/**
 * The key a set's card is posted under: the newest failing session and the minute it failed.
 *
 * @param newest the newest failure in the set
 * @returns `<short id>-<yyyymmddhhmm>`
 */
export function profileUnloadedKey({ newest }: { newest: ProfileLoadObservation }): string {
  const minute = newest.atIso.slice(0, 16).replaceAll(/[-T:]/g, "");
  return `${newest.sessionId.slice(0, SHORT_ID_LENGTH).toLowerCase()}-${minute}`;
}

/**
 * Whether the hold has PROVABLY met this session: its newest failure is the `profile-held` check's own ledger row,
 * which only a seat running the hold writes. Any other failure is a session the hold has not met yet — on current
 * hooks its next guarded call is, but a seat whose hooks predate the hold never is, and nothing here can tell those
 * two apart, so the card claims a recovery only where this answers true.
 *
 * @returns true when the newest failure was written by the hold itself
 */
function heldByTheHold({ observation }: { observation: ProfileLoadObservation }): boolean {
  return observation.event === "PreToolUse";
}

/**
 * Whether the hold delivered the owner's profile but could not write the marker that releases the retry — so the
 * session is held on every guarded call rather than reloading, and calling that a recovery in flight would be false.
 *
 * @returns true when the newest failure is the hold's own row recording an unwritten marker
 */
function markerUnwritten({ observation }: { observation: ProfileLoadObservation }): boolean {
  return heldByTheHold({ observation }) && observation.why.includes(`: ${MARKER_UNWRITTEN_REASON}`);
}

/**
 * One session's state as the card's label names it.
 *
 * @returns `<short id> held`, `<short id> held, marker unwritable` or `<short id> not yet held`
 */
function sessionState({ observation }: { observation: ProfileLoadObservation }): string {
  const short = observation.sessionId.slice(0, SHORT_ID_LENGTH);
  if (markerUnwritten({ observation })) {
    return `${short} held, marker unwritable`;
  }
  return heldByTheHold({ observation }) ? `${short} held` : `${short} not yet held`;
}

/**
 * One failing session as the card's details name it.
 *
 * @returns `<short id> at <yyyy-mm-dd>T<hh:mm>Z in <cwd>: <why> — <what the hold has done>`
 */
function sessionLine({ observation }: { observation: ProfileLoadObservation }): string {
  const where = observation.cwd.length > 0 ? ` in ${observation.cwd}` : "";
  let state = "not yet held: its next guarded call is, unless its hooks predate the hold";
  if (markerUnwritten({ observation })) {
    state =
      "held on every guarded call: the owner's profile reaches it, but nothing can release it until its marker can be written";
  } else if (heldByTheHold({ observation })) {
    state = "held, and reloading by itself";
  }
  return `${observation.sessionId.slice(0, SHORT_ID_LENGTH)} at ${observation.atIso.slice(0, 16)}Z${where}: ${observation.why} — ${state}`;
}

/**
 * Evaluate `profile-unloaded`.
 *
 * @param observations every observation of every session still running — the reader has already windowed them
 * @param dismissed the keys the owner closed, held rather than re-posted
 * @param shown every key already posted and taken down, held too
 * @returns firing over the set of unloaded sessions, or clear when every running session's newest load arrived
 */
export function evaluateProfileUnloaded({
  observations,
  dismissed,
  shown,
}: {
  observations: readonly ProfileLoadObservation[];
  dismissed: ReadonlySet<string>;
  shown: ReadonlySet<string>;
}): MonitorReading {
  const unloaded = unloadedSessions({ observations });
  const [newest] = unloaded;
  if (newest === undefined) {
    return { monitorId: MONITOR_ID, state: "clear" };
  }
  const key = profileUnloadedKey({ newest });
  const count = unloaded.length === 1 ? "1 session" : `${String(unloaded.length)} sessions`;
  let delivery: MonitorSubject["delivery"];
  if (dismissed.has(key)) {
    delivery = { kind: "hold", why: "you closed this note, and no session has failed to load your profile since" };
  } else if (shown.has(key)) {
    delivery = {
      kind: "hold",
      why: "this note was already shown, and no session has failed to load your profile since",
    };
  }
  const subject: MonitorSubject = {
    details: unloaded.map((observation) => sessionLine({ observation })),
    id: count,
    key,
    label: unloaded.map((observation) => sessionState({ observation })).join(", "),
    ...(delivery === undefined ? {} : { delivery }),
  };
  return { monitorId: MONITOR_ID, state: "firing", subjects: [subject] };
}

/** `profile-unloaded`: a running session the owner's profile never reached, reported as the recovery already under way. */
export const PROFILE_UNLOADED: MonitorDefinition = {
  blurb:
    "A running session whose load of the owner's profile failed or never ran, posted quietly: one the hold has met is named held and reloads by itself; one it has not met yet is named not yet held, since a seat on hooks older than the hold is never met.",
  id: MONITOR_ID,
  notice: {
    unaddressed:
      "nothing waits on you — a held session reloads your profile by itself; one not yet held is held on its next guarded call unless its hooks predate the hold",
  },
  plainWhat: "A running session lost your profile — the card names which are held and reloading by themselves",
  prefix: "profile",
  resolves: "every session touched in the last day has a newer successful load than its failure, or stops running",
  source:
    "$SLOPWEAVER_HOME/profile/loads.jsonl, and the profile hook's boot records in every Claude transcript written in the last day",
  unblocks: ({ subject }) =>
    fitLine({ cap: UNBLOCKS_CAP, text: `nothing waits on you — ${subject.label}`.replaceAll(/\s+/gu, " ") }),
  what: ({ subject }) =>
    fitLine({ cap: WHAT_CAP, text: `Your profile is missing from ${subject.id}: ${subject.label}` }),
};
