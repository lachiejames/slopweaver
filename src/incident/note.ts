/**
 * The ONE floating note an incident investigation ends in — the hand step a checked form (`./form.ts`) becomes.
 *
 * The seat that investigated a live incident
 * puts in front of the owner two or three VERBATIM lines from the channel, each linking its message; the root cause and
 * the impact with the Datadog evidence behind them; and exactly one question — share it with the team, yes or no.
 * The share is a cross-post: the write-up to the incident channel, and to the related bugs thread when there is
 * one, both as parked drafts the `hand post` admission refuses when the draft register does not hold them.
 *
 * ## The proof first, the ask last
 *
 * A note that opens on the PR leaves the owner unable to find the evidence, so the proof leads. The note's Open
 * button lands on the receipts page the seat published ({@link incidentProofUrl}), its details open on that page's
 * address, and the drafts the owner would send come last. `../hand/proofLink.ts`'s `incidentWithoutProof` refuses any card on an incident row that opens anything else.
 *
 * ## SOLVED is two halves, and the status says which are in
 *
 * Telemetry going quiet is not the incident being over — a customer may still be failing where no monitor looks —
 * and a customer saying "fixed" is not proof the errors stopped. So the status line names each half, and reads
 * "solved" only when BOTH are present: telemetry clear since an instant, AND a named person confirming it.
 *
 * ## Updates amend the same note
 *
 * A later finding re-cuts the note rather than raising a second one: {@link nextIncidentRevision} numbers the
 * revision and names the one open revision it supersedes, which `hand post`'s own re-cut settles on the same
 * register line.
 *
 * Pure: a form, the register's rows and an instant in; a draft out.
 */
import type { HandRow } from "../hand/row.js";
import type { HandStepDraft } from "../hand/step.js";
import { err, ok, type Result } from "../lib/result.js";
import { consoleViewerUrl } from "../pages/url.js";

import { type IncidentNoteError, IncidentNoteErrors } from "./errors.js";
import type { IncidentNoteForm, IncidentStatus } from "./form.js";
import { channelRevisionPattern, type IncidentRevision, nextChannelRevision } from "./revision.js";

/** The id prefix every revision of an incident note carries. */
const NOTE_KIND = "inc";

/**
 * The status line: which of SOLVED's two halves are in. Never "solved" on one of them.
 *
 * @param status the halves the seat has evidence for
 * @returns one line
 */
export function incidentStatusLine({ status }: { status: IncidentStatus }): string {
  const since = status.telemetryClearSinceIso;
  const by = status.customerConfirmedBy;
  if (since !== undefined && by !== undefined) {
    return `solved — telemetry clear since ${since}; confirmed by ${by}`;
  }
  if (since !== undefined) {
    return `telemetry clear since ${since}, customer confirmation pending`;
  }
  if (by !== undefined) {
    return `${by} says solved, telemetry not yet clear`;
  }
  return "telemetry not yet clear, customer confirmation pending";
}

/**
 * The id every revision of one incident's note carries, its revision number captured.
 *
 * @param channelId the incident channel's id
 * @returns `^inc-<channel id lowered>-r(<n>)$`
 */
export function incidentNoteIdPattern({ channelId }: { channelId: string }): RegExp {
  return channelRevisionPattern({ channelId, kind: NOTE_KIND });
}

/**
 * The next revision of one incident's note, and the open revision it supersedes.
 *
 * Revision ids are `inc-<channel id lowered>-r<n>`, so they are channel-scoped by construction; the fold is
 * `./revision.ts`'s, shared with the postmortem card.
 *
 * @param channelId the incident channel's id
 * @param rows every row the hand register holds
 * @returns the revision, or the refusal when more than one revision is open
 */
export function nextIncidentRevision({
  channelId,
  rows,
}: {
  channelId: string;
  rows: readonly HandRow[];
}): Result<IncidentRevision, IncidentNoteError> {
  const folded = nextChannelRevision({ channelId, kind: NOTE_KIND, rows });
  if (folded.kind === "ambiguous") {
    return err(IncidentNoteErrors.revisionsOpen({ open: folded.open }));
  }
  return ok(folded.revision);
}

/**
 * The share question — the impact in people first, then the one question the owner answers yes or no, its reference in
 * parentheses after it when it has one. Meaning comes before mechanism.
 *
 * @param meaning the impact in people, which opens the line
 * @param channel the incident channel
 * @returns the step's `what`
 */
export function shareQuestion({
  meaning,
  channel,
}: {
  meaning: IncidentNoteForm["meaning"];
  channel: IncidentNoteForm["channel"];
}): string {
  if (channel.reference === undefined) {
    return `${meaning}: should we share it with the team?`;
  }
  // The reference after the words, never before them (`../briefing/untranslatedCode.ts`).
  return `${meaning}: should we share it with the team (${channel.reference})?`;
}

/**
 * The impact line: what was measured, or — past an access wall — the question and who could answer it.
 *
 * @param impact the form's impact
 * @returns one line
 */
function incidentImpactLine({ impact }: { impact: IncidentNoteForm["impact"] }): string {
  if (typeof impact === "string") {
    return impact;
  }
  return `not measured (${impact.wall}) — a question for ${impact.askWho}: ${impact.question}`;
}

/**
 * The address the note's Open button lands on: the receipts page, in the console's viewer.
 *
 * @param form the checked form
 * @param consoleBase the console's origin, no trailing slash
 * @returns the viewer address of the form's `proof` page
 */
function incidentProofUrl({ form, consoleBase }: { form: IncidentNoteForm; consoleBase: string }): string {
  return consoleViewerUrl({ consoleBase, slug: form.proof });
}

/**
 * The detail lines behind the disclosure row: the proof first, then the impact, what the channel does not have yet,
 * status, the root cause (the mechanism sits below the meaning), stakeholders, and both drafts last — the receipts
 * before anything the owner is asked to send.
 *
 * @param form the checked form
 * @param proofUrl where the receipts page opens ({@link incidentProofUrl})
 * @returns the lines, in that order
 */
export function incidentDetails({ form, proofUrl }: { form: IncidentNoteForm; proofUrl: string }): readonly string[] {
  const bugs =
    "none" in form.bugsThread
      ? `Bugs thread: none — ${form.bugsThread.none}`
      : `Draft for the bugs thread ${form.bugsThread.thread}: ${form.bugsThread.draft}`;
  return [
    `Proof: ${proofUrl}`,
    `Impact: ${incidentImpactLine({ impact: form.impact })}`,
    `What the channel does not have yet: ${form.adds}`,
    `Status: ${incidentStatusLine({ status: form.status })}`,
    `Root cause: ${form.rootCause}`,
    `Stakeholders: ${form.stakeholders.join(", ")}`,
    `Draft for #${form.channel.name}: ${form.channelDraft}`,
    bugs,
  ];
}

/**
 * The hand step draft an incident note posts as — `buildHandStep` and `hand post`'s admission judge it.
 *
 * @param form the checked form
 * @param revision the revision this posting is
 * @param nowIso when it is posted
 * @param postedBy the session posting it
 * @param shot the checked picture's draft field, when the form carried one
 * @param consoleBase the console origin the proof page's viewer address is minted on
 * @returns the draft, whose `url` opens the receipts page
 */
export function incidentStepDraft({
  form,
  revision,
  nowIso,
  postedBy,
  shot,
  consoleBase,
}: {
  form: IncidentNoteForm;
  revision: IncidentRevision;
  nowIso: string;
  postedBy: string;
  shot: HandStepDraft["shot"];
  consoleBase: string;
}): HandStepDraft {
  const proofUrl = incidentProofUrl({ consoleBase, form });
  const reference = form.channel.reference === undefined ? "this incident's" : `the ${form.channel.reference}`;
  const audience = "none" in form.bugsThread ? `#${form.channel.name}` : `#${form.channel.name} and the bugs thread`;
  return {
    cites: form.cites,
    decision: {
      lean: form.lean,
      options: [
        {
          option: "Yes — post both drafts as written",
          tradeoff: "the team reads the root cause in your name before anyone outside the fleet has checked it",
        },
        {
          option: "No — keep it on this card",
          tradeoff: "the channel keeps asking for a root cause the fleet already has",
        },
      ],
      problem: `Nobody outside the fleet has ${reference} root cause and impact yet.`,
      stakes: {
        blastRadius: audience,
        risk: "a wrong root cause posted as you steers the room the wrong way while the incident is live",
        stillReal: form.stillReal,
      },
    },
    details: incidentDetails({ form, proofUrl }),
    id: revision.id,
    postedBy,
    postedIso: nowIso,
    quotes: form.quotes,
    row: form.row,
    ...(shot === undefined ? {} : { shot }),
    unblocks: `${reference} write-up reaching ${audience}`,
    url: proofUrl,
    what: shareQuestion({ channel: form.channel, meaning: form.meaning }),
    witness: `slopweaver slack draft show ${form.channelDraft}`,
  };
}
