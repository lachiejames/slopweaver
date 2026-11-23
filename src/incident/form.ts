/**
 * The incident note's FORM — the one JSON object an investigating seat writes — and the check that refuses the first
 * field that does not describe a whole write-up.
 *
 * Rule 7: what sits above the fold is capped by the form, and a violation is REFUSED rather than cut. The quotes
 * are the only lines above the fold besides the question (`../hand/quotes.ts`); root cause, impact, status,
 * stakeholders and the two drafts sit behind the note's disclosure row; the evidence rides `cites`. Two to three
 * quotes, because one is an anecdote and four is a transcript. Nothing is posted before the owner's yes, so both cross-posts
 * arrive as PARKED drafts (`slack draft record`) named by id.
 *
 * Pure: parsed JSON in, a checked form or the refusal naming its field out.
 */
import { checkedQuotes, type HandQuote } from "../hand/quotes.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type IncidentFormInvalidError, IncidentNoteErrors } from "./errors.js";
import {
  checkedAdds,
  checkedImpact,
  checkedLean,
  checkedMeaning,
  checkedShot,
  type IncidentImpactQuestion,
  type IncidentShot,
} from "./findingFields.js";
import { checkedCites, checkedProof } from "./formEvidence.js";
import { FINDING_LINE_CAP, line } from "./formLine.js";

/** The fewest verbatim lines a note carries — one line is an anecdote, not the room. */
const QUOTES_MIN = 2;

/** The most people the note names. */
const STAKEHOLDERS_MAX = 8;

/** A parked Slack draft's id, as `slack draft record` mints it. */
const DRAFT_ID = /^sd-[0-9a-f]{8}$/u;

/**
 * A Slack channel id — public `C…` or private `G…`. Exported for `./postmortemCandidates.ts`, which holds an incident
 * whose snapshot channel fails it rather than print a row slug `handover register` would refuse. Bounded at 21
 * characters (Slack's run 9 to 11) so a card id `pm-<channel>-r<n>` stays under `hand`'s 60-character `ID_MAX` for
 * any revision a register could reach: a trial build at `r1` would otherwise accept a channel whose `r10` is
 * refused.
 */
export const CHANNEL_ID = /^[CG][A-Z0-9]{6,20}$/u;

/** A Slack message permalink — what a bugs thread is named by. */
const THREAD_LINK = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+(?:\?\S*)?$/u;

/** An ISO-8601 instant to the minute or finer. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/u;

/**
 * The longest incident reference (`INC-98`), as incidents.io puts it in the channel topic — sized with
 * `./findingFields.ts`'s `MEANING_CAP` so the two make the 120-character headline.
 */
export const REFERENCE_CAP = 20;

/** Every key the form may carry. */
const FORM_KEYS = new Set([
  "adds",
  "bugsThread",
  "channel",
  "channelDraft",
  "cites",
  "impact",
  "lean",
  "meaning",
  "proof",
  "quotes",
  "rootCause",
  "row",
  "shot",
  "stakeholders",
  "status",
  "stillReal",
]);

/** The two halves SOLVED needs; each present only once it is true. */
export interface IncidentStatus {
  /** When the telemetry the root cause names last went quiet, as an ISO instant. */
  readonly telemetryClearSinceIso?: string;
  /** Who, outside the fleet, confirmed the incident is over for the people it hit. */
  readonly customerConfirmedBy?: string;
}

/** A whole incident write-up, as the investigating seat composes it. */
export interface IncidentNoteForm {
  /**
   * The slug of the receipts page the seat published with `slopweaver page publish` — what the note's Open button
   * lands on, before anything else is asked of the owner.
   */
  readonly proof: string;
  readonly channel: { readonly id: string; readonly name: string; readonly reference?: string };
  /** The board row the detection registered, which the note's card waits on. */
  readonly row: string;
  /** What the fleet brings that the channel does not already have — hard evidence, never a restatement. */
  readonly adds: string;
  /** The impact in people, the card's first words, never the mechanism. */
  readonly meaning: string;
  readonly rootCause: string;
  /** Who was hit, how many, for how long — or, past an access wall, the question that would say. */
  readonly impact: string | IncidentImpactQuestion;
  readonly status: IncidentStatus;
  readonly quotes: readonly HandQuote[];
  /** Evidence links — Datadog first, then the deploys and pull requests. */
  readonly cites: readonly string[];
  readonly stakeholders: readonly string[];
  /** The parked draft for the incident channel. */
  readonly channelDraft: string;
  /** The related bugs thread: its parked cross-post, or why there is none. */
  readonly bugsThread: { readonly draft: string; readonly thread: string } | { readonly none: string };
  /** What the seat recommends, said as its lean and never as the owner's word. */
  readonly lean: string;
  /** How the finding was re-checked just before the note — the command or observation. */
  readonly stillReal: string;
  /** The Datadog screenshot that proves it and its boxes, as `hand post --shot`/`--box` take them. */
  readonly shot: IncidentShot;
}

/**
 * A form's `channel`, checked — shared with the postmortem card's form, which re-homes the refusal.
 *
 * @param value whatever the form carried
 * @returns the channel, `#` stripped from its name, or the refusal naming its field
 */
export function checkedChannel({
  value,
}: {
  value: unknown;
}): Result<IncidentNoteForm["channel"], IncidentFormInvalidError> {
  if (!isRecord(value)) {
    return err(IncidentNoteErrors.formInvalid({ field: "channel", why: "is { id, name, reference? }" }));
  }
  const { id, name, reference } = value;
  if (typeof id !== "string" || !CHANNEL_ID.test(id)) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "channel.id",
        why: "is a Slack channel id (C… or G…, at most 21 characters)",
      }),
    );
  }
  const named = line({ cap: 80, field: "channel.name", value: name });
  if (named.isErr()) {
    return err(named.error);
  }
  if (reference === undefined) {
    return ok({ id, name: named.value.replace(/^#/u, "") });
  }
  const ref = line({ cap: REFERENCE_CAP, field: "channel.reference", value: reference });
  if (ref.isErr()) {
    return err(ref.error);
  }
  return ok({ id, name: named.value.replace(/^#/u, ""), reference: ref.value });
}

/** The form's `status`, checked: each half absent, or well-formed. */
function checkedStatus({ value }: { value: unknown }): Result<IncidentStatus, IncidentFormInvalidError> {
  if (!isRecord(value)) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "status",
        why: "is { telemetryClearSinceIso?, customerConfirmedBy? } — {} while neither is true",
      }),
    );
  }
  const unknown = Object.keys(value).find((key) => key !== "telemetryClearSinceIso" && key !== "customerConfirmedBy");
  if (unknown !== undefined) {
    return err(IncidentNoteErrors.formInvalid({ field: "status", why: `carries an unknown key "${unknown}"` }));
  }
  const since = value["telemetryClearSinceIso"];
  const by = value["customerConfirmedBy"];
  if (since !== undefined && (typeof since !== "string" || !ISO_INSTANT.test(since))) {
    return err(
      IncidentNoteErrors.formInvalid({ field: "status.telemetryClearSinceIso", why: "is an ISO instant in UTC" }),
    );
  }
  let confirmedBy: string | undefined;
  if (by !== undefined) {
    const named = line({ cap: 60, field: "status.customerConfirmedBy", value: by });
    if (named.isErr()) {
      return err(named.error);
    }
    confirmedBy = named.value;
  }
  return ok({
    ...(typeof since === "string" ? { telemetryClearSinceIso: since } : {}),
    ...(confirmedBy === undefined ? {} : { customerConfirmedBy: confirmedBy }),
  });
}

/** The form's `stakeholders`: one to eight names. */
function checkedStakeholders({ value }: { value: unknown }): Result<readonly string[], IncidentFormInvalidError> {
  if (!Array.isArray(value) || value.length === 0) {
    return err(IncidentNoteErrors.formInvalid({ field: "stakeholders", why: "is a non-empty list of names" }));
  }
  if (value.length > STAKEHOLDERS_MAX) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "stakeholders",
        why: `names ${String(value.length)} people and the cap is ${String(STAKEHOLDERS_MAX)} — keep the ones who own a part of it`,
      }),
    );
  }
  const names: string[] = [];
  for (const entry of value) {
    const named = line({ cap: 60, field: "stakeholders", value: entry });
    if (named.isErr()) {
      return err(named.error);
    }
    names.push(named.value);
  }
  return ok(names);
}

/**
 * A parked draft id, or the refusal — shared with the postmortem card's form.
 *
 * @param value whatever the form carried
 * @param field the field's name in the form
 * @returns the id, or the refusal naming the field
 */
export function draftId({ value, field }: { value: unknown; field: string }): Result<string, IncidentFormInvalidError> {
  if (typeof value !== "string" || !DRAFT_ID.test(value)) {
    return err(
      IncidentNoteErrors.formInvalid({ field, why: "is a parked draft's id (sd-xxxxxxxx) from `slack draft record`" }),
    );
  }
  return ok(value);
}

/** The form's `bugsThread`: a parked cross-post and the thread it replies under, or why there is none. */
function checkedBugsThread({
  value,
}: {
  value: unknown;
}): Result<IncidentNoteForm["bugsThread"], IncidentFormInvalidError> {
  if (isRecord(value) && Object.keys(value).length === 1 && "none" in value) {
    return line({ cap: 160, field: "bugsThread.none", value: value["none"] }).map((none) => ({ none }));
  }
  if (!isRecord(value) || Object.keys(value).length !== 2 || !("draft" in value) || !("thread" in value)) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "bugsThread",
        why: "is { draft, thread } for the related bugs thread, or { none: <why there is none> } — never left out",
      }),
    );
  }
  const thread = value["thread"];
  if (typeof thread !== "string" || !THREAD_LINK.test(thread)) {
    return err(IncidentNoteErrors.formInvalid({ field: "bugsThread.thread", why: "is the thread's Slack permalink" }));
  }
  return draftId({ field: "bugsThread.draft", value: value["draft"] }).map((draft) => ({ draft, thread }));
}

/**
 * The form's shape and its proof: one object of known keys, whose receipts it can open.
 *
 * @returns the object and its proof address, or the first refusal of the two
 */
function checkedFormHead({
  value,
}: {
  value: unknown;
}): Result<{ form: Record<string, unknown>; proof: string }, IncidentFormInvalidError> {
  if (!isRecord(value)) {
    return err(IncidentNoteErrors.formInvalid({ field: "form", why: "is one JSON object" }));
  }
  const unknown = Object.keys(value).find((key) => !FORM_KEYS.has(key));
  if (unknown !== undefined) {
    return err(IncidentNoteErrors.formInvalid({ field: "form", why: `carries an unknown key "${unknown}"` }));
  }
  // The proof first: a note that cannot open its receipts is refused before any other field is read. Read as an
  // OWN key, the same set the unknown-key check saw, so an inherited one is absent.
  return checkedProof({ value: Object.hasOwn(value, "proof") ? value["proof"] : undefined }).map((proof) => ({
    form: value,
    proof,
  }));
}

/** The form's closing fields, in the order a whole form is checked: the lean, the re-check, what the fleet adds, the meaning, and the screenshot. */
function checkedClosingFields({
  value,
}: {
  value: Record<string, unknown>;
}): Result<Pick<IncidentNoteForm, "adds" | "lean" | "meaning" | "shot" | "stillReal">, IncidentFormInvalidError> {
  return checkedLean({ value: value["lean"] }).andThen((lean) =>
    line({ cap: 200, field: "stillReal", value: value["stillReal"] }).andThen((stillReal) =>
      checkedAdds({ value: value["adds"] }).andThen((adds) =>
        checkedMeaning({ value: value["meaning"] }).andThen((meaning) =>
          checkedShot({ value: value["shot"] }).map((shot) => ({ adds, lean, meaning, shot, stillReal })),
        ),
      ),
    ),
  );
}

/**
 * Check a whole incident note form, refusing the first field that does not describe a whole write-up.
 *
 * @param value the parsed JSON the seat wrote
 * @returns the form, or the refusal naming its field
 */
export function checkedIncidentForm({ value }: { value: unknown }): Result<IncidentNoteForm, IncidentFormInvalidError> {
  const head = checkedFormHead({ value });
  if (head.isErr()) {
    return err(head.error);
  }
  const { form, proof } = head.value;
  const quotes = checkedQuotes({ value: form["quotes"] }).mapErr((error) =>
    IncidentNoteErrors.formInvalid({ field: "quotes", why: error.message.replace(/^quotes /u, "") }),
  );
  if (quotes.isOk() && (quotes.value === undefined || quotes.value.length < QUOTES_MIN)) {
    const count = quotes.value === undefined ? 0 : quotes.value.length;
    return err(
      IncidentNoteErrors.formInvalid({
        field: "quotes",
        why: `carries ${String(count)} and the note needs ${String(QUOTES_MIN)} to 3 verbatim lines from the channel`,
      }),
    );
  }
  return checkedChannel({ value: form["channel"] }).andThen((channel) =>
    line({ cap: 120, field: "row", value: form["row"] }).andThen((row) =>
      line({ cap: FINDING_LINE_CAP, field: "rootCause", value: form["rootCause"] }).andThen((rootCause) =>
        checkedImpact({ value: form["impact"] }).andThen((impact) =>
          checkedStatus({ value: form["status"] }).andThen((status) =>
            quotes.andThen((quoted) =>
              checkedCites({ value: form["cites"] }).andThen((cites) =>
                checkedStakeholders({ value: form["stakeholders"] }).andThen((stakeholders) =>
                  draftId({ field: "channelDraft", value: form["channelDraft"] }).andThen((channelDraft) =>
                    checkedBugsThread({ value: form["bugsThread"] }).andThen((bugsThread) =>
                      checkedClosingFields({ value: form }).map((closing): IncidentNoteForm => ({
                        ...closing,
                        bugsThread,
                        channel,
                        channelDraft,
                        cites,
                        impact,
                        proof,
                        quotes: quoted!,
                        rootCause,
                        row,
                        stakeholders,
                        status,
                      })),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
