/**
 * The tick digest's FIRST lines: the cards stopping the owner's work, as the owner's Queue draws them (`slopweaver
 * queue stopping --json`, reading `queue-stopping`), and the same lines `queue stopping` prints for a human.
 *
 * A stopped automation, or any blocker on one of the owner's priorities, is raised every day it stands, and the chat
 * update names it. The order the chair raises things in is the order the owner's Queue shows them — a blocker on a
 * priority first, a stopped automation after the priorities' own cards. So the leader is the digest's opening line,
 * worded as where the chair's update to the owner raises it, with the link that opens the card. Every way the
 * reading can fail to say "nothing stops" says so in capitals — and none of them ever reads as none.
 *
 * Pure — documents in, lines out.
 */
import { consoleQueueLink } from "../hand/consoleLink.js";
import { type QueueStoppingOutcome, queueStoppingOutcomeSchema } from "../queueStopping/report.js";
import { capped, type DigestInputs, shortened } from "./digestRead.js";
import { describeChildOutcome } from "./scratch/childOutcome.js";

/** What every line opens with. */
const LABEL = "queue leader";

/** What a line that could not read the report ends with, so a missing reading is never taken for a clear Queue. */
const UNKNOWN = "what stops the owner's work is UNKNOWN this pass, not none";

/** What closes a leader read off an incomplete report: an unread register may hold a card ahead of it. */
const UNKNOWN_BEYOND = "whether an unread register holds another card stopping the owner's work is UNKNOWN this pass";

/** The lines one outcome comes to, before any cap: the headline, each unread register, then every stopping card. */
export interface QueueStoppingLines {
  readonly head: string;
  readonly unread: readonly string[];
  readonly stopping: readonly string[];
}

/**
 * The link that opens one card on the console the report came from, or the bare key when none can be minted.
 *
 * @returns the address, or the key
 */
function openerOf({ consoleUrl, key }: { consoleUrl: string; key: string }): string {
  if (!URL.canParse(consoleUrl)) {
    return key;
  }
  const link = consoleQueueLink({ base: new URL(consoleUrl).origin, context: undefined, key });
  if (link.isErr()) {
    return key;
  }
  return link.value;
}

/**
 * A reported string as one line: the report's words are data, so a newline in one could print a digest line of its own
 * — `queue leader: none` included.
 *
 * @returns the text with every whitespace run folded to one space
 */
function oneLine({ text }: { text: string }): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/**
 * The lines a `queue stopping` outcome comes to.
 *
 * @param outcome what the verb printed
 * @returns the headline naming the leader, the unread registers and every stopping card, each one line
 */
export function queueStoppingLines({ outcome }: { outcome: QueueStoppingOutcome }): QueueStoppingLines {
  if (!outcome.reached) {
    return {
      head: `${LABEL}: CONSOLE NOT READ — ${oneLine({ text: outcome.why })}; ${UNKNOWN}`,
      stopping: [],
      unread: [],
    };
  }
  const unread = outcome.unread.map(
    (one) => `${LABEL} unread: ${oneLine({ text: one.source })} — ${oneLine({ text: one.why })}`,
  );
  const stopping = outcome.stopping.map(
    (card) =>
      `stopping the owner's work: ${oneLine({ text: card.key })} — ${oneLine({ text: card.question })} ` +
      `(${card.reason === "marked" ? "stopped" : "blocks the owner's focus"})`,
  );
  const leader = outcome.stopping.at(0);
  const incomplete = outcome.complete ? "" : `INCOMPLETE, ${String(outcome.unread.length)} register(s) unread — `;
  if (leader === undefined) {
    const none = outcome.complete ? "none — nothing stops the owner's work" : `none among what read; ${UNKNOWN}`;
    return { head: `${LABEL}: ${incomplete}${none}`, stopping, unread };
  }
  // A register unread may hold another card stopping the owner's work, so an incomplete list says that it is a floor.
  const floor = outcome.complete ? "" : `; ${UNKNOWN_BEYOND}`;
  // A blocker on a priority is the owner's Queue's first card; a stopped automation stands after the priorities' own
  // cards, so the chair raises it there, in the Queue's order, never ahead of them.
  let where = "open your chat update to the owner on this, the first card on the owner's Queue";
  if (leader.reason === "marked") {
    where = "raise this straight after the owner's priorities, where the owner's Queue draws it";
  }
  const head =
    // Quoted and on one line, so no card's own words can read as the `none` verdict.
    `${LABEL}: ${incomplete}"${oneLine({ text: leader.question })}" — ${where} ` +
    `(${String(outcome.stopping.length)} stopping the owner's work): ` +
    `${openerOf({ consoleUrl: outcome.consoleUrl, key: leader.key })}${floor}`;
  return { head, stopping, unread };
}

/**
 * The digest's lines for the `queue-stopping` reading: the headline naming the leader, then the unread registers and
 * every stopping card, each list capped like every other in the digest.
 *
 * @param inputs the tick's readings
 * @returns the lines
 */
export function queueStoppingDigestLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const reading = inputs.readings.get("queue-stopping");
  if (reading === undefined) {
    return [`${LABEL}: NOT READ — not captured this tick; ${UNKNOWN}`];
  }
  if (reading.kind === "unavailable") {
    return [`${LABEL}: NOT READ — ${describeChildOutcome({ outcome: reading.child })}; ${UNKNOWN}`];
  }
  if (reading.kind === "text") {
    return [`${LABEL}: NOT READ — captured as text, not JSON (${shortened({ text: reading.text })}); ${UNKNOWN}`];
  }
  const parsed = queueStoppingOutcomeSchema.safeParse(reading.value);
  if (!parsed.success) {
    const issue = parsed.error.issues.at(0);
    let what = "it carried no readable field";
    if (issue !== undefined) {
      what = `${issue.path.join(".")}: ${issue.message}`;
    }
    return [`${LABEL}: NOT READ — the document is not the shape this build reads (${what}); ${UNKNOWN}`];
  }
  const lines = queueStoppingLines({ outcome: parsed.data });
  return [
    lines.head,
    ...capped({ lines: lines.unread, prefix: `${LABEL} unread` }),
    ...capped({ lines: lines.stopping, prefix: "stopping the owner's work" }),
  ];
}
