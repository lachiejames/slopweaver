/**
 * Every raw-markup span an `answer` form would put in front of a reader, found at PARSE rather than at the
 * send — so `turn resume --answer` refuses what `../slack/typedRunsOnly.ts` would refuse on the wire.
 *
 * Split out of `./answerForm.ts`, which calls {@link rawMarkupIssuesOfAnswer} once from its `superRefine`.
 */
import type { RawMarkupIssue } from "../artifact/typedRuns.js";
import { rawMarkupIssuesOfDetail, rawMarkupIssuesOfSequences, rawMarkupIssuesOfText } from "../artifact/typedRuns.js";
import { redactPayload } from "../slack/piiRedaction.js";
import { typedRunsOnlyViolations } from "../slack/typedRunsOnly.js";
import type { AnswerFormAnswer } from "./answerForm.js";
import { evidenceTrailFor, renderEvidenceTrail } from "./evidence.js";

/**
 * Every raw-markup issue in an answer form: what conversion could not type in `lead`, `body` and `index`,
 * then every span the evidence trail would render into a plain text run.
 *
 * The first half REFUSES whatever conversion could not type — a channel or user-group reference, and anything
 * in the plain-string `lead`, which has no run to become.
 *
 * The second half renders the trail (`grounding.evidence` and `measurements`) with the send's own renderer and
 * asks the wire guard's own question of it. Nothing read those strings until the send, where the guard
 * refused the whole answer. MEASURED on a live send: a bare URL in
 * `measurements[0].repro` validated, cleared review, and threw at the wire over a live worker. Rendering rather than listing fields is the point — a trail field added later is
 * checked without anyone remembering to. It is REDACTED first, because the send redacts before the wire guard
 * reads (`./answerMessage.ts`'s `answerWrapper`): `https://203.0.113.7/x` goes out as `https://[ip]/x`, which
 * is no URL, and refusing it here would refuse an answer the wire accepts. Its issues sit at the ROOT, not a
 * guessed field path: the scanner reads rendered blocks and cannot say which of the two fields a span came
 * from, so the message names both.
 *
 * @param form the converted answer form
 * @returns every issue, lead/body/index first; empty when the answer renders clean
 */
export function rawMarkupIssuesOfAnswer({ form }: { form: AnswerFormAnswer }): readonly RawMarkupIssue[] {
  const trail = renderEvidenceTrail({
    measurements: form.measurements,
    provenance: form.grounding.provenance,
    trail: evidenceTrailFor({ answer: form }),
  });
  return [
    ...rawMarkupIssuesOfText({ path: ["lead"], text: form.lead }),
    ...rawMarkupIssuesOfDetail({ detail: form.body, path: ["body"] }),
    ...rawMarkupIssuesOfSequences({ items: form.index, path: ["index"] }),
    ...typedRunsOnlyViolations({ payload: redactPayload({ value: trail }).value }).map((violation) => ({
      message: `the evidence trail (grounding.evidence or measurements) would be refused at send — ${violation}`,
      path: [],
    })),
  ];
}
