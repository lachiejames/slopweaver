/**
 * The tick digest's lines for the Queue cards a gate withheld (`slopweaver queue refusals --json`, reading
 * `queue-refusals`), and the same lines `queue refusals` prints for a human.
 *
 * A withheld card never reaches the owner, so this line is the only place it surfaces: each key it names is the chair's
 * to route to a seat that fixes the card's source record that pass (`skills/supervisor/reference/sweep-contract.md`).
 * So every way the reading can fail to say "nothing withheld" says so in capitals — a console that did not answer, a
 * reading never captured, a register the console could not read — and none of them ever prints as a zero.
 *
 * Pure — documents in, lines out.
 */
import { type QueueRefusalsOutcome, queueRefusalsOutcomeSchema } from "../queueRefusals/report.js";
import { ALERT_CHARS, capped, type DigestInputs, shortened } from "./digestRead.js";
import { describeChildOutcome } from "./scratch/childOutcome.js";

/** What every line opens with. */
const LABEL = "queue refusals";

/** What a line that could not read the report ends with, so a missing reading is never taken for a quiet Queue. */
const UNKNOWN = "withheld Queue cards are UNKNOWN this pass, not zero";

/** The lines one outcome comes to, before any cap: the headline, then each unread register, then each withheld card. */
export interface QueueRefusalLines {
  readonly head: string;
  readonly unread: readonly string[];
  readonly withheld: readonly string[];
}

/**
 * The lines a `queue refusals` outcome comes to.
 *
 * @param outcome what the verb printed
 * @param whyLimit how many characters of each reason a line keeps; absent keeps the whole reason
 * @returns the headline, the unread registers and the withheld cards, each one line
 */
export function queueRefusalLines({
  outcome,
  whyLimit,
}: {
  outcome: QueueRefusalsOutcome;
  whyLimit?: number;
}): QueueRefusalLines {
  const said = ({ text }: { text: string }): string => {
    if (whyLimit === undefined) {
      return text;
    }
    return shortened({ limit: whyLimit, text });
  };
  if (!outcome.reached) {
    return {
      head: `${LABEL}: CONSOLE NOT READ — ${said({ text: outcome.why })}; ${UNKNOWN}`,
      unread: [],
      withheld: [],
    };
  }
  const unread = outcome.unread.map((one) => `${LABEL} unread: ${one.source} — ${said({ text: one.why })}`);
  const withheld = outcome.withheld.map((one) => `queue refusal: ${one.key} — ${said({ text: one.why })}`);
  const count = String(outcome.withheld.length);
  let head = `${LABEL}: 0 withheld`;
  if (!outcome.complete) {
    head = `${LABEL}: INCOMPLETE — ${String(outcome.unread.length)} register(s) unread, at least ${count} withheld`;
  } else if (outcome.withheld.length > 0) {
    head = `${LABEL}: ${count} withheld — route each to a seat that fixes its source record this pass`;
  }
  return { head, unread, withheld };
}

/**
 * The digest's lines for the `queue-refusals` reading: the headline, then the unread registers and the withheld
 * cards, each list capped like every other in the digest.
 *
 * @param inputs the tick's readings
 * @returns the lines
 */
export function queueRefusalDigestLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const reading = inputs.readings.get("queue-refusals");
  if (reading === undefined) {
    return [`${LABEL}: NOT READ — not captured this tick; ${UNKNOWN}`];
  }
  if (reading.kind === "unavailable") {
    return [`${LABEL}: NOT READ — ${describeChildOutcome({ outcome: reading.child })}; ${UNKNOWN}`];
  }
  if (reading.kind === "text") {
    return [`${LABEL}: NOT READ — captured as text, not JSON (${shortened({ text: reading.text })}); ${UNKNOWN}`];
  }
  const parsed = queueRefusalsOutcomeSchema.safeParse(reading.value);
  if (!parsed.success) {
    const issue = parsed.error.issues.at(0);
    let what = "it carried no readable field";
    if (issue !== undefined) {
      what = `${issue.path.join(".")}: ${issue.message}`;
    }
    return [`${LABEL}: NOT READ — the document is not the shape this build reads (${what}); ${UNKNOWN}`];
  }
  const lines = queueRefusalLines({ outcome: parsed.data, whyLimit: ALERT_CHARS });
  return [
    lines.head,
    ...capped({ lines: lines.unread, prefix: `${LABEL} unread` }),
    ...capped({ lines: lines.withheld, prefix: "queue refusal" }),
  ];
}
