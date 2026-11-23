/**
 * The `turn-signed-out` declaration — the card a bot turn blocked on a browser sign-in puts in front of the owner: the exact
 * host, and the work Chrome window the pass opened on it (`./turnSignedOut.ts` judges it). Its own module because the
 * wording is the whole of it, and `./registry.ts` lists it in its place in `MONITORS`.
 */
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";
import { IF_IGNORED_CAP } from "../hand/stepConsequence.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorSubject } from "./types.js";

/** What the card says either side of the host, when the pass opened the page in the owner's work Chrome. */
const LOGIN_WHAT_OPEN = "Log into ";
const LOGIN_WHAT_OPENED = " now in the work Chrome window just opened — a Slack answer is waiting on it";
/** What it says after the host when no pin is written yet, so no window could be opened in the work profile. */
const LOGIN_WHAT_BARE = " now in your work Chrome — a Slack answer is waiting on it";

/**
 * The card's sentence: the exact host the owner logs into, fitted to the room the cap leaves it. A terminator followed by a
 * space inside the value would read as a second sentence the hand register refuses, so that space is dropped.
 *
 * @param subject one signed-out origin, whose `id` is its host and `opens` the origin, when the pass opens it
 * @returns the one sentence, never longer than the cap
 */
function loginWhat({ subject }: { subject: MonitorSubject }): string {
  const close = subject.opens === undefined ? LOGIN_WHAT_BARE : LOGIN_WHAT_OPENED;
  const room = WHAT_CAP - LOGIN_WHAT_OPEN.length - close.length;
  const host = subject.id.replaceAll(/([.?!])\s+/g, "$1");
  return `${LOGIN_WHAT_OPEN}${fitLine({ cap: room, text: host })}${close}`;
}

/** `turn-signed-out`: one floating work card per origin a waiting bot turn is blocked on. */
export const TURN_SIGNED_OUT: MonitorDefinition = {
  blurb:
    "A bot turn is blocked on a browser sign-in its answer needs — one card per origin, the page opened in the owner's work Chrome.",
  context: "work",
  floats: true,
  id: "turn-signed-out",
  ifIgnored: ({ subject }) =>
    fitLine({
      cap: IF_IGNORED_CAP,
      text: `the Slack thread waiting on ${subject.id} gets no answer — the turn stays blocked rather than answering without what it needed to read`,
    }),
  perSubject: true,
  plainWhat: "Log into a platform in your work Chrome — a bot turn is blocked on its sign-in page",
  prefix: "login",
  resolves:
    "no waiting turn names that origin — the session holding it ran `turn unblock`; a card the owner pressed Done on is held until then",
  source:
    "$SLOPWEAVER_HOME/live/slack/asks.jsonl (each `blocked-on-human` sign-in's origin), the hand register, and $SLOPWEAVER_HOME/chrome-pin.sh",
  unblocks: ({ subject }) =>
    fitLine({
      cap: UNBLOCKS_CAP,
      text: `${subject.label} — each answer resumes once its session sees the page signed in`.replaceAll(/\s+/g, " "),
    }),
  what: ({ subject }) => loginWhat({ subject }),
  where: "Your work Chrome profile, on that platform's sign-in page — log in there, then press Done",
};
