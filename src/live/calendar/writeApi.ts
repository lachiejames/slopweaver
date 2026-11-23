/**
 * The Calendar WRITE seam — the three mutations the door makes, kept apart from {@link ./api.CalendarApi}
 * so the read builders' fakes never grow a method that changes a diary.
 *
 * ## Every mutation is conditional, and none retries
 *
 * A patch and a delete carry the ETag the approval was computed over as `If-Match`, so Google refuses with
 * a 412 when the event moved between preview and commit — the caller re-previews, never fetches a fresh
 * ETag and sends the approved act anyway. An insert has no version to compare and is made idempotent the
 * other way: the caller supplies the event id, so a repeat lands on 409 rather than on a second invite.
 * `retryMode: "never"` on all three, because a mutation that MAY have reached Google must be reconciled by
 * reading back, never re-sent.
 *
 * ## Every mutation is judged by the outbound privacy check first
 *
 * `privacy` is a REQUIRED input, and each method awaits `calendarWritePrivacyRefusal`
 * (`../../outbound/calendar/writePrivacy.ts`) BEFORE `safeProviderCall` is entered, so a refusal takes no rate
 * slot and sends nothing. It comes back as `PRIVACY_REFUSED`, never `API_FAILED`, which is what keeps a refused
 * intent `pending` rather than `uncertain` (`./write.ts`'s `failedSend`).
 */
import type { calendar_v3 } from "@googleapis/calendar";

import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, type Result } from "../../lib/result.js";
import { type CalendarWritePrivacy, calendarWritePrivacyRefusal } from "../../outbound/calendar/writePrivacy.js";
import { type CalendarError, CalendarErrors } from "./errors.js";

/** Whether Google tells the attendees about a change. `none` is only ever used for a change nobody else is on. */
export type SendUpdates = "all" | "none";

/** The calls the Calendar write verbs make. Injected, so the write core is unit tested with plain fakes. */
export interface CalendarWriteApi {
  /** Create one event. The body carries the caller-chosen id, so a repeat is a 409 rather than a twin. */
  readonly insertEvent: (args: {
    calendarId: string;
    body: calendar_v3.Schema$Event;
    sendUpdates: SendUpdates;
    /** `1` when the body asks for a Meet link, else `0`. */
    conferenceDataVersion: 0 | 1;
  }) => Promise<Result<calendar_v3.Schema$Event, CalendarError>>;
  /** Change the named fields of one event, only if it still carries `etag`. */
  readonly patchEvent: (args: {
    calendarId: string;
    eventId: string;
    etag: string;
    body: calendar_v3.Schema$Event;
    sendUpdates: SendUpdates;
    conferenceDataVersion: 0 | 1;
  }) => Promise<Result<calendar_v3.Schema$Event, CalendarError>>;
  /** Cancel one event, only if it still carries `etag`. */
  readonly deleteEvent: (args: {
    calendarId: string;
    eventId: string;
    etag: string;
    sendUpdates: SendUpdates;
  }) => Promise<Result<undefined, CalendarError>>;
}

/**
 * Map a boundary failure into this domain's own union, naming the two statuses a caller branches on.
 *
 * @param error the typed boundary failure
 * @returns a version conflict for 412, an already-applied for 409, else the generic API failure
 */
function toWriteError({ error }: { error: IngestError }): CalendarError {
  if (error.status === 412) {
    return CalendarErrors.versionConflict();
  }
  if (error.status === 409) {
    return CalendarErrors.alreadyApplied();
  }
  return CalendarErrors.apiFailed({ cause: error, message: error.message });
}

// The delete mutation: its policy read afresh, though a delete carries no body to judge, then the conditional send.
function deleteEventSeam({
  account,
  client,
  privacy,
  scopeId,
}: {
  account: string;
  client: calendar_v3.Calendar;
  privacy: CalendarWritePrivacy;
  scopeId: string;
}): CalendarWriteApi["deleteEvent"] {
  return async ({ calendarId, eventId, etag, sendUpdates }) => {
    const refusal = await calendarWritePrivacyRefusal({
      body: undefined,
      operation: "calendar.events.delete",
      privacy,
      target: { account, calendarId, etag, eventId, sendUpdates },
    });
    if (refusal !== undefined) {
      return err(CalendarErrors.privacyRefused({ message: refusal }));
    }
    return safeProviderCall({
      execute: () => client.events.delete({ calendarId, eventId, sendUpdates }, { headers: { "If-Match": etag } }),
      operation: "calendar.events.delete",
      provider: "calendar",
      retryMode: "never",
      scopeId,
    })
      .map(() => undefined)
      .mapErr((error) => toWriteError({ error }));
  };
}

/**
 * The production write seam, bound to one resolved grant.
 *
 * @param client the `@googleapis/calendar` surface
 * @param account the account the grant bound to, hashed into the shared 429 rate scope
 * @param privacy the capability every mutation's policy is read from, afresh each time
 * @returns every mutation the Calendar write verbs make
 */
export function makeCalendarWriteApi({
  client,
  account,
  privacy,
}: {
  client: calendar_v3.Calendar;
  account: string;
  privacy: CalendarWritePrivacy;
}): CalendarWriteApi {
  const scopeId = scopeIdForToken({ token: account });
  return {
    // The bound account rides in every target, so `primary` on one account is never another account's hold.
    deleteEvent: deleteEventSeam({ account, client, privacy, scopeId }),
    insertEvent: async ({ calendarId, body, sendUpdates, conferenceDataVersion }) => {
      const refusal = await calendarWritePrivacyRefusal({
        body,
        operation: "calendar.events.insert",
        privacy,
        target: { account, calendarId, conferenceDataVersion, sendUpdates },
      });
      if (refusal !== undefined) {
        return err(CalendarErrors.privacyRefused({ message: refusal }));
      }
      return safeProviderCall({
        execute: () => client.events.insert({ calendarId, conferenceDataVersion, requestBody: body, sendUpdates }),
        operation: "calendar.events.insert",
        provider: "calendar",
        retryMode: "never",
        scopeId,
      })
        .map((response) => response.data)
        .mapErr((error) => toWriteError({ error }));
    },
    patchEvent: async ({ calendarId, eventId, etag, body, sendUpdates, conferenceDataVersion }) => {
      const refusal = await calendarWritePrivacyRefusal({
        body,
        operation: "calendar.events.patch",
        privacy,
        target: { account, calendarId, conferenceDataVersion, etag, eventId, sendUpdates },
      });
      if (refusal !== undefined) {
        return err(CalendarErrors.privacyRefused({ message: refusal }));
      }
      return safeProviderCall({
        execute: () =>
          client.events.patch(
            { calendarId, conferenceDataVersion, eventId, requestBody: body, sendUpdates },
            { headers: { "If-Match": etag } },
          ),
        operation: "calendar.events.patch",
        provider: "calendar",
        retryMode: "never",
        scopeId,
      })
        .map((response) => response.data)
        .mapErr((error) => toWriteError({ error }));
    },
  };
}
