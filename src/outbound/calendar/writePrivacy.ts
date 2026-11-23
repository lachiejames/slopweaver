/**
 * The outbound privacy check at the Google Calendar write seam: every mutation `../../live/calendar/writeApi.ts`
 * makes — insert, patch, delete — is judged by `../privacyCheck.ts` before its provider call starts, so a refusal
 * takes no rate slot and sends no byte. What is judged: `./writePrivacyPayload.ts`.
 *
 * ## The policy comes from an explicit home, on every write
 *
 * A {@link CalendarWritePrivacy} is built from the state home the verb resolved and is a REQUIRED input to
 * `makeCalendarWriteApi`, so the compiler names every construction site and none reads an ambient home. The policy
 * (`../writePrivacyPolicy.ts`) is read afresh on every mutation, a delete included, and never cached, so a terms file
 * deleted between two writes refuses the second. A read never consults it: the reads live on a separate API
 * (`../../live/calendar/api.ts`, `freeApi.ts`) that takes no capability at all.
 *
 * ## Why the seam and not the transport
 *
 * Calendar's reads cannot be told from its writes by HTTP method — `freebusy.query` is a POST — so a guard on the
 * OAuth client's `fetch` would have to classify every request and would couple every read client to the policy. The
 * residue is stated rather than closed: a Calendar mutation made outside `CalendarWriteApi`, or a second Google
 * surface built on `BoundCalendarClient.auth`, is not judged here.
 *
 * There is no override and no hatch: every finding names a rewording that is always possible.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import type { Result } from "../../lib/result.js";
import type { PrivacyPolicy } from "../privacyCheck.js";
import {
  type PrivateTermReviewPort,
  privateTermReviewPort,
  privateTermWriteRefusal,
} from "../privateTermReview/gate.js";
import { writePrivacyRefusal } from "../writePrivacyLeaves.js";
import { loadWritePrivacyPolicy } from "../writePrivacyPolicy.js";
import {
  CALENDAR_DESTINATION,
  type CalendarWriteOperation,
  calendarWriteFindings,
  calendarWriteLeaves,
} from "./writePrivacyPayload.js";

/** The privacy capability `makeCalendarWriteApi` requires: the policy one mutation is judged under. */
export interface CalendarWritePrivacy {
  readonly resolve: () => Promise<Result<PrivacyPolicy, string>>;
  /** Holds a mutation a meant private term matched for a review in context; absent, such a match refuses outright. */
  readonly review?: PrivateTermReviewPort | undefined;
}

/**
 * The production capability over one home: the policy read afresh on every mutation.
 *
 * @param home the state home the verb resolved
 * @returns the capability `makeCalendarWriteApi` requires
 */
export function calendarWritePrivacy({ home }: { home: string }): CalendarWritePrivacy {
  return { resolve: () => Promise.resolve(loadWritePrivacyPolicy({ home })), review: privateTermReviewPort({ home }) };
}

/**
 * The refusal one Calendar mutation is stopped with, or undefined when it may be sent. Loads the policy on every
 * call, a delete with nothing to judge included, so a policy that cannot be relied on refuses every write.
 *
 * @param operation the mutation, which the refusal names first
 * @param body the event body as sent, or undefined for a delete
 * @param privacy the capability the policy comes from
 * @param target the call's own parameters, the calendar and event ids among them, which a held write's key covers
 * @returns the refusal text, or undefined
 */
export async function calendarWritePrivacyRefusal({
  operation,
  body,
  privacy,
  target,
}: {
  operation: CalendarWriteOperation;
  body: calendar_v3.Schema$Event | undefined;
  privacy: CalendarWritePrivacy;
  target: Readonly<Record<string, unknown>>;
}): Promise<string | undefined> {
  const command = `calendar ${operation}`;
  const policy = await privacy.resolve();
  if (policy.isErr()) {
    // The terms did not load, so there are none to withhold a line for; the load refusal names no term.
    return writePrivacyRefusal({ command, reasons: [policy.error], terms: [] });
  }
  const leaves = calendarWriteLeaves({ body, operation });
  const findings = calendarWriteFindings({ leaves, policy: policy.value });
  return privateTermWriteRefusal({
    findings,
    policy: policy.value,
    privacyDestination: CALENDAR_DESTINATION,
    review: privacy.review,
    write: {
      command,
      contents: leaves,
      destination: "the owner's Google Calendar",
      family: "google-calendar",
      request: { body, operation, target },
    },
  });
}
