/**
 * The EFFECTFUL half of a calendar write, split PREPARE / APPLY the way `gmail/outbox.ts` is, and for the
 * same reason: the door wraps a thunk, so the thing being admitted has to be the one call that changes the
 * world and nothing else.
 *
 * - `prepareCalendarWrite` reads the event as Google holds it (for anything but a booking), builds the
 *   intent, persists it under the home, and returns the plan — the preview, the outward verdict and the
 *   digest. Nothing on Google changes.
 * - `prepareCalendarCommit` re-reads the intent AND Google, and rebuilds the plan from the stored form
 *   against the CURRENT event, so a digest approved over a snapshot that has since moved no longer matches.
 * - `applyCalendarWrite` makes the one mutation, reads the event back, and rewrites the intent as `applied`
 *   — or `uncertain` when the mutation may have reached Google but nothing came back to prove it. An
 *   uncertain intent is never retried into a second invite; it is reconciled by its event id.
 *
 * Effectful only through the injected seams and the intent store, so every path is unit tested with fakes
 * and a temporary home.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import { err, ok, type Result } from "../../lib/result.js";
import type { CalendarWriteForm } from "../../outbound/calendar/form.js";
import type { CalendarApi } from "./api.js";
import { type CalendarError, CalendarErrors } from "./errors.js";
import { readCalendarIntent, writeCalendarIntent } from "./intentStore.js";
import { PRIMARY_CALENDAR } from "./read.js";
import type { CalendarWriteApi } from "./writeApi.js";
import { buildCalendarWritePlan, type CalendarIntent, type CalendarWritePlan } from "./writePlan.js";

/** What an applied write left behind, read back from Google. */
export interface CalendarWriteOutcome {
  readonly intentId: string;
  readonly eventId: string;
  /** `applied` with the read-back; `uncertain` when the mutation was sent and nothing readable came back. */
  readonly status: "applied" | "uncertain";
  readonly event: calendar_v3.Schema$Event | undefined;
  /** The Meet link Google minted, when one was asked for and exists on the read-back. */
  readonly meetLink: string | undefined;
  readonly residue: readonly string[];
}

/**
 * Refuse a write whose stored target is not the BOUND account's own primary calendar.
 *
 * Checked at every stage that can reach Google rather than once at prepare, because production resolves a
 * fresh credential for each of prepare, commit and apply — three independent chances for the bound account
 * to have changed between previewing a write and sending it. Without it a booking previewed and approved
 * under one account could be inserted into a DIFFERENT account's diary after a re-connect, carrying a digest
 * computed over the first. The calendar half is what keeps "primary only" — the owner's ruling, narrower
 * than the `calendar.events.owned` scope itself — enforced by the code rather than by the credential, and it
 * is also the precondition that makes Google's calendar-relative `self` flag mean what `isOwnerEntry` reads
 * it to mean.
 *
 * @param intent the stored intent, carrying the account and calendar it was prepared against
 * @param account the account this session's credential actually bound to
 * @returns nothing on a match, or the typed mismatch naming both sides
 */
export function assertWriteTargetIsOwnPrimary({
  intent,
  account,
}: {
  intent: Pick<CalendarIntent, "account" | "calendarId">;
  account: string;
}): Result<undefined, CalendarError> {
  const sameAccount = intent.account.toLowerCase() === account.toLowerCase();
  if (sameAccount && intent.calendarId === PRIMARY_CALENDAR) {
    return ok(undefined);
  }
  return err(
    CalendarErrors.writeTargetMismatch({
      bound: account,
      intended: { account: intent.account, calendarId: intent.calendarId },
    }),
  );
}

/** The event as Google holds it, with the ETag every conditional mutation needs. */
async function snapshot({
  api,
  calendarId,
  eventId,
}: {
  api: CalendarApi;
  calendarId: string;
  eventId: string;
}): Promise<Result<{ etag: string; event: calendar_v3.Schema$Event }, CalendarError>> {
  const read = await api.getEvent({ calendarId, eventId });
  if (read.isErr()) {
    return err(read.error);
  }
  const etag = read.value.etag;
  if (typeof etag !== "string" || etag.length === 0) {
    return err(
      CalendarErrors.apiFailed({
        message: `Google returned event ${eventId} without an ETag, so no conditional write can be made`,
      }),
    );
  }
  return ok({ etag, event: read.value });
}

/**
 * The event an intent addresses. A caller names no event id only for a booking, whose event does not exist
 * yet, so the door chooses one from the intent id: Google takes a caller-chosen base32hex id, and a UUID's
 * hex digits are inside that alphabet, so a repeated insert is a 409 rather than a second invitation.
 */
function addressedEventId({ eventId, intentId }: { eventId: string | undefined; intentId: string }): string {
  if (eventId === undefined) {
    return intentId.replaceAll("-", "");
  }
  return eventId;
}

/**
 * Prepare a write: read the target, persist the intent, and plan the exact mutation.
 *
 * @param api the read seam, for the snapshot and the account zone
 * @param form the validated form
 * @param account the bound account
 * @param calendarId the calendar written to — always the owner's own
 * @param eventId the existing event, or undefined for a booking (then the door chooses one from `intentId`)
 * @param intentId the fresh id the shell minted
 * @param home the state home the intent is persisted under
 * @param nowIso the clock
 * @param zone the account's zone, for a span that names none
 * @returns the plan, or the typed reason none could be made
 */
export async function prepareCalendarWrite({
  api,
  form,
  account,
  calendarId,
  eventId,
  intentId,
  home,
  nowIso,
  zone,
}: {
  api: CalendarApi;
  form: CalendarWriteForm;
  account: string;
  calendarId: string;
  eventId: string | undefined;
  intentId: string;
  home: string;
  nowIso: () => string;
  zone: string;
}): Promise<Result<CalendarWritePlan, CalendarError>> {
  const target = assertWriteTargetIsOwnPrimary({ account, intent: { account, calendarId } });
  if (target.isErr()) {
    return err(target.error);
  }
  let before: CalendarIntent["before"];
  if (form.kind !== "book") {
    if (eventId === undefined) {
      return err(CalendarErrors.invalidWrite({ problems: [`${form.kind} needs an event id`] }));
    }
    const read = await snapshot({ api, calendarId, eventId });
    if (read.isErr()) {
      return err(read.error);
    }
    before = read.value;
  }
  const intent: CalendarIntent = {
    account,
    before,
    calendarId,
    createdAtIso: nowIso(),
    eventId: addressedEventId({ eventId, intentId }),
    form,
    intentId,
    state: "pending",
    version: 1,
  };
  const plan = buildCalendarWritePlan({ intent, zone });
  if (plan.isErr()) {
    return err(plan.error);
  }
  // The plan carries the stored intent, so a later rewrite of its state cannot drop the previewed digest.
  const stored: CalendarIntent = { ...intent, previewDigest: plan.value.digest };
  const written = writeCalendarIntent({ home, intent: stored });
  if (written.isErr()) {
    return err(CalendarErrors.apiFailed({ message: written.error.join("; ") }));
  }
  return ok({ ...plan.value, intent: stored });
}

/**
 * Re-plan a held intent against the event as Google holds it NOW.
 *
 * @param api the read seam
 * @param home the state home the intent lives under
 * @param intentId the id the preview printed
 * @param zone the account's zone
 * @param account the account THIS session bound to, which may not be the one the intent was prepared under
 * @returns the rebuilt plan, or the typed reason — unknown, spent, unreadable, or written for another diary
 */
export async function prepareCalendarCommit({
  api,
  home,
  intentId,
  zone,
  account,
}: {
  api: CalendarApi;
  home: string;
  intentId: string;
  zone: string;
  account: string;
}): Promise<Result<CalendarWritePlan, CalendarError>> {
  const stored = readCalendarIntent({ home, intentId });
  if (stored.isErr()) {
    return err(CalendarErrors.apiFailed({ message: stored.error.join("; ") }));
  }
  const intent = stored.value;
  if (intent?.state !== "pending") {
    return err(CalendarErrors.intentUnknown({ intentId }));
  }
  const target = assertWriteTargetIsOwnPrimary({ account, intent });
  if (target.isErr()) {
    return err(target.error);
  }
  let before = intent.before;
  if (intent.form.kind !== "book") {
    const read = await snapshot({ api, calendarId: intent.calendarId, eventId: intent.eventId });
    if (read.isErr()) {
      return err(read.error);
    }
    before = read.value;
  }
  return buildCalendarWritePlan({ intent: { ...intent, before }, zone });
}

/** Perform the plan's one mutation. */
async function mutate({
  writeApi,
  plan,
}: {
  writeApi: CalendarWriteApi;
  plan: CalendarWritePlan;
}): Promise<Result<calendar_v3.Schema$Event | undefined, CalendarError>> {
  const { intent, mutation, sendUpdates, conferenceDataVersion } = plan;
  const target = { calendarId: intent.calendarId, eventId: intent.eventId };
  switch (mutation.kind) {
    case "insert":
      return writeApi.insertEvent({
        body: mutation.body,
        calendarId: intent.calendarId,
        conferenceDataVersion,
        sendUpdates,
      });
    case "patch":
      return writeApi.patchEvent({
        ...target,
        body: mutation.body,
        conferenceDataVersion,
        etag: mutation.etag,
        sendUpdates,
      });
    case "delete":
      return (await writeApi.deleteEvent({ ...target, etag: mutation.etag, sendUpdates })).map(() => undefined);
    default: {
      const never: never = mutation;
      return never;
    }
  }
}

/**
 * Apply a plan the door admitted: mutate once, read back, and rewrite the intent as applied or uncertain.
 *
 * A 409 on an INSERT is treated as "already applied" — the id is ours, so Google holding it means the first
 * attempt reached it — and the read-back is what is reported. A 409 on a patch or a delete is NOT that: the
 * id was not chosen by this door, so the conflict says something about the event rather than about a repeat
 * of this write, and it is reported as the failure it is. Any other failure BEFORE a response leaves the
 * intent `uncertain` rather than pending, so a retry cannot send a second invitation.
 *
 * @param api the read seam, for the read-back
 * @param writeApi the mutation seam
 * @param plan the admitted plan
 * @param home the state home the intent lives under
 * @param account the account THIS session bound to, re-checked because production resolves it again here
 * @returns what Google reported back, or the typed reason the mutation failed
 */
export async function applyCalendarWrite({
  api,
  writeApi,
  plan,
  home,
  account,
}: {
  api: CalendarApi;
  writeApi: CalendarWriteApi;
  plan: CalendarWritePlan;
  home: string;
  account: string;
}): Promise<Result<CalendarWriteOutcome, CalendarError>> {
  const { intent } = plan;
  const target = assertWriteTargetIsOwnPrimary({ account, intent });
  if (target.isErr()) {
    return err(target.error);
  }
  const sent = await mutate({ plan, writeApi });
  const repeatedInsert = sent.isErr() && sent.error.code === "ALREADY_APPLIED" && plan.mutation.kind === "insert";
  if (sent.isErr() && !repeatedInsert) {
    return err(failedSend({ error: sent.error, home, intent }));
  }
  const readBack =
    plan.mutation.kind === "delete"
      ? undefined
      : await api.getEvent({ calendarId: intent.calendarId, eventId: intent.eventId });
  const event = readBack === undefined || readBack.isErr() ? undefined : readBack.value;
  const status: CalendarWriteOutcome["status"] =
    plan.mutation.kind === "delete" || event !== undefined ? "applied" : "uncertain";
  // The terminal state is what stops this intent being applied a second time, so a failure to persist it is
  // reported rather than swallowed: the write DID reach Google and the local record no longer agrees.
  const settled = writeCalendarIntent({ home, intent: { ...intent, state: status } });
  const unsettled = settled.isErr() ? settled.error : [];
  const meetLink = meetLinkOf({ event });
  return ok({
    event,
    eventId: intent.eventId,
    intentId: intent.intentId,
    meetLink,
    residue: outcomeResidue({ meetAsked: plan.conferenceDataVersion === 1, meetLink, plan, status, unsettled }),
    status,
  });
}

/**
 * The Meet link on a read-back. Google sets the read-only `hangoutLink` only on an event with a Google Meet
 * conference, so it is read first; an event conferenced any other way carries its join address only as the
 * conference block's video entry point; an event with neither, or no read-back at all, has no link.
 */
function meetLinkOf({ event }: { event: calendar_v3.Schema$Event | undefined }): string | undefined {
  const hangoutLink = event?.hangoutLink;
  if (hangoutLink != null) {
    return hangoutLink;
  }
  const video = event?.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video")?.uri;
  if (video == null) {
    return undefined;
  }
  return video;
}

/**
 * What a failed mutation leaves behind, and the error a caller is given for it.
 *
 * A failure that reached Google definitively (a 412, a refused body) says nothing ambiguous and is reported
 * as it is. An `API_FAILED` MAY have reached Google, so `uncertain` is the barrier that stops a retry
 * sending a second invitation — and a failure to PERSIST that barrier is carried into the message rather
 * than dropped, because the intent then still reads as `pending`, which is exactly the state a second
 * commit would act on.
 *
 * @param error what the mutation seam reported
 * @param intent the pending write
 * @param home the state home the intent lives under
 * @returns the error to return, wrapped when the barrier could not be written
 */
function failedSend({
  error,
  intent,
  home,
}: {
  error: CalendarError;
  intent: CalendarIntent;
  home: string;
}): CalendarError {
  if (error.code !== "API_FAILED") {
    return error;
  }
  const settled = writeCalendarIntent({ home, intent: { ...intent, state: "uncertain" } });
  if (settled.isOk()) {
    return error;
  }
  return CalendarErrors.apiFailed({
    cause: error,
    message:
      `${error.message} — and intent ${intent.intentId} could NOT be marked uncertain locally ` +
      `(${settled.error.join("; ")}), so it still reads as pending. Reconcile event ${intent.eventId} on ` +
      `${intent.calendarId} by reading it back before anything else; do NOT re-run this write`,
  });
}

/** What an outcome does not establish. */
function outcomeResidue({
  plan,
  status,
  meetAsked,
  meetLink,
  unsettled,
}: {
  plan: CalendarWritePlan;
  status: CalendarWriteOutcome["status"];
  meetAsked: boolean;
  meetLink: string | undefined;
  /** Why the intent's terminal state could not be persisted, empty when it was. */
  unsettled: readonly string[];
}): readonly string[] {
  return [
    status === "applied"
      ? "this is the event as Google reported it back after the write"
      : "the mutation was sent and no readable event came back — reconcile by the event id before doing anything else; do NOT re-run the write",
    ...(plan.sendUpdates === "all"
      ? ["attendees are told by Google on its own schedule; an accepted write is not a delivered invitation"]
      : []),
    ...(meetAsked && meetLink === undefined
      ? ["a Meet link was asked for and none is on the read-back yet; Google can mint it after the write returns"]
      : []),
    ...(unsettled.length > 0
      ? [
          `the write reached Google and this intent could NOT be marked ${status} locally (${unsettled.join("; ")}) — it still reads as pending, so treat a second commit of it as a repeat and reconcile by the event id`,
        ]
      : []),
  ];
}
