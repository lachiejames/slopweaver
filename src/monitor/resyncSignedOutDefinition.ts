/**
 * The `resync-signed-out` declaration — the card a scheduled resync stopped at a sign-in page puts in front of the owner:
 * the exact host, and the work Chrome window the pass opened on it (`./resyncSignedOut.ts` judges it). Its own
 * module because the wording is the whole of it, and `./registry.ts` lists it in its place in `MONITORS`.
 */
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";
import { IF_IGNORED_CAP } from "../hand/stepConsequence.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorSubject } from "./types.js";

/** What the card says either side of the host, when the pass opened the page in the owner's work Chrome. */
const SIGNIN_WHAT_OPEN = "Sign in to ";
const SIGNIN_WHAT_OPENED = " in the work Chrome window just opened, so its resync can read again";
/** What it says after the host when no pin is written yet, so no window could be opened in the work profile. */
const SIGNIN_WHAT_BARE = " in your work Chrome — a scheduled resync stopped at its sign-in page";

/**
 * The card's sentence: the exact host the owner signs in to, fitted to the room the cap leaves it. A terminator followed by a
 * space inside the value would read as a second sentence the hand register refuses, so that space is dropped.
 *
 * @param subject one signed-out origin, whose `id` is its host and `opens` the origin, when the pass opens it
 * @returns the one sentence, never longer than the cap
 */
function signInWhat({ subject }: { subject: MonitorSubject }): string {
  const close = subject.opens === undefined ? SIGNIN_WHAT_BARE : SIGNIN_WHAT_OPENED;
  const room = WHAT_CAP - SIGNIN_WHAT_OPEN.length - close.length;
  const host = subject.id.replaceAll(/([.?!])\s+/g, "$1");
  return `${SIGNIN_WHAT_OPEN}${fitLine({ cap: room, text: host })}${close}`;
}

/**
 * What doing nothing costs the owner, from the subject's own data: how stale the platform's read stays, and that a
 * schedule raised the card rather than a run that needs it. Most syncs bring in little that is useful, so there is
 * little cost to ignoring the card — and it says so. It cannot
 * see a run that needs the same sign-in, so an incident read waiting on it is not on this line.
 *
 * A demand-gated atlas (`../live/resync/demand.ts`) walks only because a person named it, so its card says who and
 * when instead — ask only when a sync is useful — and leaves the owner to judge whether the stored
 * read already answers them.
 *
 * @param subject one signed-out origin, whose `id` is its host, `syncedThrough` the stalest read it stopped and
 *   `wantedBy` the mention it walked for
 * @returns the line, never longer than the cap
 */
export function signInIfIgnored({ subject }: { subject: MonitorSubject }): string {
  let freshness = "stays as it is";
  if (subject.syncedThrough?.kind === "at") {
    freshness = `stays as of ${subject.syncedThrough.iso.slice(0, ISO_DATE_LENGTH)}`;
  } else if (subject.syncedThrough?.kind === "never") {
    freshness = "stays empty — it has never synced";
  }
  if (subject.wantedBy !== undefined) {
    let who = "a person";
    if (subject.wantedBy.author !== null) {
      who = subject.wantedBy.author;
    }
    return fitLine({
      cap: IF_IGNORED_CAP,
      text: `${subject.id}'s read ${freshness}. It walked because ${who} named it on ${subject.wantedBy.occurredAt.slice(0, ISO_DATE_LENGTH)} — the stored read may already answer them`,
    });
  }
  return fitLine({
    cap: IF_IGNORED_CAP,
    text: `${subject.id}'s read ${freshness}, and each scheduled resync stops at this page again — routine freshness the schedule raised, not a run`,
  });
}

/** `yyyy-mm-dd`, the date an ISO instant opens with. */
const ISO_DATE_LENGTH = 10;

/** `resync-signed-out`: one floating work card per origin a scheduled resync stopped at. */
export const RESYNC_SIGNED_OUT: MonitorDefinition = {
  blurb:
    "A scheduled resync stopped at a platform's sign-in page — one card per origin, the sign-in in the owner's work Chrome.",
  context: "work",
  floats: true,
  id: "resync-signed-out",
  ifIgnored: ({ subject }) => signInIfIgnored({ subject }),
  perSubject: true,
  plainWhat: "Sign in to a platform in your work Chrome — a scheduled resync stopped at its sign-in page",
  prefix: "signin",
  resolves:
    "the row's newest resync attempt no longer stops at that sign-in page; a card the owner pressed Done on is held until then",
  source:
    "$SLOPWEAVER_HOME/live/recipe/resync-state/ (each attempt's sign-in wall), the hand register, and $SLOPWEAVER_HOME/chrome-pin.sh",
  unblocks: ({ subject }) =>
    fitLine({
      cap: UNBLOCKS_CAP,
      text: `${subject.label} — each row stays paused on its failure finding until an attempt gets past it`.replaceAll(
        /\s+/g,
        " ",
      ),
    }),
  what: ({ subject }) => signInWhat({ subject }),
  where: "Your work Chrome profile, on that platform's sign-in page — sign in there, then press Done",
};
