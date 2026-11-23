/**
 * The gate that refuses to send an answer whose Datadog citations open on something other than the evidence
 * they are offered as.
 *
 * ## Why a gate, when review rounds already read the answer
 *
 * `../datadog/answerCitations.ts`'s header carries the class. Review verdicts classify claims and **never
 * citations**: a reviewer re-derives every number through the API, and nobody clicks the links — so a claim is
 * corrected by adding rounds while a citation defect is invariant to them. Two such defects are decidable from
 * the URL: an unscoped metric-explorer link a figure was read off, and a `/apm/traces` freeze that opens a
 * reader on 15 minutes of a longer claim window. Either survives every round and posts.
 *
 * Many review rounds are acceptable if that is what it takes never to output a bad
 * claim, and the improvement the owner wants is to make the failures the reviewers kept catching structurally
 * impossible. This is the half of that class a pure function decides.
 *
 * ## Why it sits in the PRE-FLIGHT list and not only at the door
 *
 * It is decidable from the answer's own bytes with no I/O, which is `../live/turn/answerPreflight.ts`'s entry
 * criterion. A citation defect found at the door has already cost a reviewer workspace and its round; found at
 * pre-flight it costs one re-compose, before a reviewer exists.
 *
 * ## `warn`, like every other gate on this path
 *
 * Block by default with a break-glass, and the door RECORDS the override (`./ledger.ts`), so an acknowledged
 * send is findable afterwards rather than indistinguishable from a clean one. A `hold` would be wrong here:
 * every finding is self-correctable by editing one URL, and a citation this module does not know how to judge
 * already yields nothing at all.
 */
import { datadogCitationIssues } from "../datadog/answerCitations.js";
import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";
import type { DoorFinding, DoorGate } from "./types.js";

/** The override token that waives this gate, recorded by the door whenever it is used. */
export const DATADOG_CITATION_OVERRIDE = "answer.datadogCitation:v1";

/**
 * Every Datadog citation on this answer that does not open on the evidence it is offered as.
 *
 * One finding per CITATION rather than per violation, with that citation's own violations joined into the
 * summary: a reader fixes one link at a time, and a link with an absent scope and a wrong freeze is one edit.
 * Returned as a list rather than the first failure, for the reason `./answerQualityGate.ts` gives — a composer
 * learning about the next problem only after another round trip is the loop the typed forms exist to avoid.
 *
 * @param answer the composed answer about to be sent
 * @returns every finding that stands; empty when no citation is one this module judges, or when all of them
 *   are sound
 *
 * @internal — exported so a test can assert the findings without composing a whole door request.
 */
export function datadogCitationFindings({ answer }: { answer: AnswerFormAnswer }): readonly DoorFinding[] {
  const findings: DoorFinding[] = [];
  for (const citation of answer.citations) {
    const issues = datadogCitationIssues({ url: citation.url });
    if (issues.length === 0) {
      continue;
    }
    findings.push({
      code: "ANSWER_CITATION_DOES_NOT_OPEN_ON_ITS_EVIDENCE",
      correction:
        `rebuild ${citation.label} over the window and scope the claim was actually computed over, then` +
        ` re-run \`turn review\` — build a logs, traces or rum link with \`ddConsoleLink\` rather than pasting` +
        ` one out of the console, and give a metric explorer link the \`exp_scope\` you measured or the \`exp_group\` you read it by`,
      override: DATADOG_CITATION_OVERRIDE,
      severity: "warn",
      summary: `citation ${citation.label} shows a reader something other than the claim's evidence: ${issues.join("; ")}`,
    });
  }
  return findings;
}

/**
 * The gate, bound to the answer it judges.
 *
 * @param answer the composed answer about to be sent
 * @returns a `DoorGate` closing over it
 */
export function datadogCitationGate({ answer }: { answer: AnswerFormAnswer }): DoorGate {
  return () => datadogCitationFindings({ answer });
}
