/**
 * `steer-at-risk` — a deliverable the owner EXPLICITLY STEERED is at risk, as one floating note per row, raised
 * the moment the register knows it and never at the deadline.
 *
 * A steered deliverable at risk gets a floating note AND a voice cut-in the minute it is known. The worked example
 * is a seat parked on a clock behind a door rule the owner had already waived, which the owner learnt of only
 * shortly before their deadline, by reading the supervisor chat (`docs/doctrine-rationale/explicit-steer.md`). The
 * judge is `../handover/steerRisk.ts`; this file turns its verdicts into notes.
 *
 * ## A notice, not a decision — and it says when something waits on the owner
 *
 * The note is news the owner may act on — steer it another way, take it themselves — so it is a NOTICE, raised in
 * front of every note already up, and never `stopsWork`. It says what is TRUE about who waits: a row stopped on the
 * owner's question opens
 * `waiting on you: <the question> — answer it on your Queue` whichever reason leads, because that question already
 * has its own ask card there and the note must not be a second one; every other row opens `nothing waits on you — `,
 * and its no-link line claims nothing of the fleet, since a parked row's reason says nobody is on it. A
 * postmortem is why: seven notes overnight told the owner nothing waited on them, one over "it is stopped
 * on a question to you", while seats sat parked on the owner's pick. One subject per row (`perSubject`), since each
 * row is its own deliverable; the key is a digest
 * of the slug and the reason's own identity, so a reason that changes re-cuts the note and one that stands holds.
 *
 * A note the owner closed, or one already shown and taken down, is held rather than re-posted while the reason that
 * raised it still stands — the same pacing `profile-unloaded` uses, for the same reason.
 *
 * Pure: verdicts and held keys in, a reading out. The read is `./steerAtRiskSource.ts`.
 */
import { DETAIL_LINE_CAP } from "../hand/details.js";
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";
import { onQuestion, type SteerRiskVerdict, steerRiskSentence } from "../handover/steerRisk.js";

import { subjectKey } from "./evaluate.js";
import type { MonitorDefinition } from "./registry.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** This monitor's id. */
const MONITOR_ID = "steer-at-risk";

/** One row's slug and its judged verdict. */
export interface SteerAtRiskRow {
  readonly slug: string;
  readonly verdict: SteerRiskVerdict;
}

/**
 * One at-risk row as its note's subject.
 *
 * @param slug the row's slug, named in full on the note
 * @param verdict the row's at-risk verdict
 * @returns the subject
 */
export function steerAtRiskSubject({
  slug,
  verdict,
}: {
  slug: string;
  verdict: Extract<SteerRiskVerdict, { kind: "at-risk" }>;
}): MonitorSubject {
  const { alsoStanding, reason, steer } = verdict;
  const due = steer.explicitSteer.deliverByIso;
  const details = [
    `Your steer, word for word: ${steer.ruling}`,
    due === undefined ? "You named no time for it" : `You wanted it by ${due}`,
    `At risk since ${reason.sinceIso}: ${steerRiskSentence({ reason })}`,
    ...alsoStanding.map((other) => `Also standing since ${other.sinceIso}: ${steerRiskSentence({ reason: other })}`),
    `Row ${slug}, anchored at ${steer.anchor}`,
  ].map((line) => fitLine({ cap: DETAIL_LINE_CAP, text: line }));
  // The owner's question opens the note whichever reason leads, since who waits is what the opening line says: a named
  // risk that outranks it must not read "nothing waits on you" over a Queue card asking the owner. A question standing
  // BEHIND the lead — the owner's, or the park it became — joins the key, so asking, answering or pausing it re-cuts the note; one that
  // leads already is the key.
  const waiting = [reason, ...alsoStanding].find((one) => one.kind === "waiting-on-owner");
  const keyParts = [slug, reason.identity];
  const question = alsoStanding.find((one) => onQuestion({ reason: one }));
  if (question !== undefined) {
    keyParts.push(question.identity);
  }
  const subject: MonitorSubject = {
    details,
    id: slug,
    key: subjectKey({ name: keyParts.join(" ") }),
    label: steerRiskSentence({ reason }),
  };
  if (waiting?.kind !== "waiting-on-owner") {
    return subject;
  }
  return { ...subject, steerQuestion: waiting.question, unaddressed: STEER_WAITING_UNADDRESSED };
}

/**
 * Evaluate `steer-at-risk` over every steered row.
 *
 * @param rows every row carrying an explicit steer, with its verdict
 * @param dismissed the keys the owner closed, held rather than re-posted
 * @param shown every key already posted and taken down, held too
 * @returns firing with one subject per at-risk row, or clear when none is
 */
export function evaluateSteerAtRisk({
  rows,
  dismissed,
  shown,
}: {
  rows: readonly SteerAtRiskRow[];
  dismissed: ReadonlySet<string>;
  shown: ReadonlySet<string>;
}): MonitorReading {
  const subjects = rows.flatMap(({ slug, verdict }): MonitorSubject[] => {
    if (verdict.kind !== "at-risk") {
      return [];
    }
    const subject = steerAtRiskSubject({ slug, verdict });
    if (dismissed.has(subject.key)) {
      return [{ ...subject, delivery: { kind: "hold", why: "you closed this note, and the same risk still stands" } }];
    }
    if (shown.has(subject.key)) {
      return [{ ...subject, delivery: { kind: "hold", why: "this note was already shown for the same risk" } }];
    }
    return [subject];
  });
  if (subjects.length === 0) {
    return { monitorId: MONITOR_ID, state: "clear" };
  }
  return { monitorId: MONITOR_ID, state: "firing", subjects };
}

/** What the note says either side of the row's slug. */
const WHAT_OPEN = "Your steered ";
const WHAT_CLOSE = " is at risk";

/** What a steer note's `unblocks` opens with, before the reason, when nothing waits on the owner. */
export const STEER_UNBLOCKS_OPEN = "nothing waits on you — ";

/** What a steer note's `unblocks` opens with, before the owner's question, when the row is stopped on it. */
const STEER_WAITING_OPEN = "waiting on you: ";

/** What closes that line, after the question — never cut, so the note always says where the owner answers. */
const STEER_WAITING_CLOSE = " — answer it on your Queue";

/** The note's no-link sentence on a row stopped on the owner's question: the Queue's ask card is where they answer it. */
const STEER_WAITING_UNADDRESSED = "waiting on you — answer the question on your Queue";

/**
 * A steer note's opening line: the owner's question when the row is stopped on one, fit so the Queue clause survives, else
 * the reason after "nothing waits on you".
 *
 * @param subject the note's subject, carrying `steerQuestion` only when the reason is the owner's question
 * @returns the line, within `UNBLOCKS_CAP`
 */
function steerUnblocks({ subject }: { subject: MonitorSubject }): string {
  const { steerQuestion } = subject;
  if (steerQuestion === undefined) {
    return fitLine({ cap: UNBLOCKS_CAP, text: `${STEER_UNBLOCKS_OPEN}${subject.label}`.replaceAll(/\s+/gu, " ") });
  }
  const room = UNBLOCKS_CAP - STEER_WAITING_OPEN.length - STEER_WAITING_CLOSE.length;
  const question = fitLine({ cap: room, text: steerQuestion.replaceAll(/\s+/gu, " ") });
  return `${STEER_WAITING_OPEN}${question}${STEER_WAITING_CLOSE}`;
}

/**
 * The reason a steer note's `unblocks` carries, as the voice says it: what follows "nothing waits on you", or the
 * whole line when it waits on the owner — so the voice says that too — and the whole line for a note written otherwise.
 *
 * @param unblocks the note's `unblocks`
 * @returns the reason
 */
export function steerRiskReasonOf({ unblocks }: { unblocks: string }): string {
  if (!unblocks.startsWith(STEER_UNBLOCKS_OPEN)) {
    return unblocks;
  }
  return unblocks.slice(STEER_UNBLOCKS_OPEN.length);
}

/** `steer-at-risk`: one floating notice per explicitly steered row whose deliverable is at risk. */
export const STEER_AT_RISK: MonitorDefinition = {
  blurb:
    "A deliverable the owner explicitly steered is at risk — a named risk, a question to the owner, a clock-park, a seat given up or dead, or the owner's time passed — one floating note per row, raised the moment it is known.",
  floats: true,
  id: MONITOR_ID,
  notice: {
    unaddressed: "nothing waits on you — steer it another way, or take it yourself, if you want",
  },
  perSubject: true,
  plainWhat: "A deliverable you explicitly steered is at risk — the note names which and why",
  prefix: "steer",
  resolves:
    "the reason clears — the risk is cleared, the owner's question answered, a seat open on the row again — or the row ships, settles or finishes, or a later ordinary ruling replaces the steer",
  source:
    "$SLOPWEAVER_HOME/runs/*.jsonl carrying an explicit-steer ruling, each judged by `handover/steerRisk.ts` against its row document",
  unblocks: steerUnblocks,
  what: ({ subject }) =>
    `${WHAT_OPEN}${fitLine({ cap: WHAT_CAP - WHAT_OPEN.length - WHAT_CLOSE.length, text: subject.id })}${WHAT_CLOSE}`,
};
