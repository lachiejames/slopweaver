/**
 * Which Twilio operations this atlas may CALL, and why each refusal is a refusal.
 *
 * ## The criterion, not a list — and it admits no read-shaped POST, for a measured reason
 *
 * A `GET` observes. Nothing else does. `POST`, `PUT`, `PATCH` and `DELETE` all create, change or remove
 * something in this account, so each is inventoried and never called.
 *
 * A vendor with a naming CONVENTION for a read whose input does not fit a query string — a `…/search` or
 * `…/batch/read` suffix — could have those POSTs exempted, because a convention is something a rule can key
 * on. **Twilio has no such convention, MEASURED**: of the eight read-shaped POSTs in the
 * pinned catalogue, `POST /v3/InsightsDomains/Conversations/Query`, `POST /v2/KnowledgeBases/{kbId}/Search`
 * and `POST /v1/Stores/{storeId}/Profiles/Lookup` really are reads, while
 * `POST /v2/Services/{ServiceSid}/VerificationCheck` and `POST /v1/CallerIds/SmsVerificationChecks` CONSUME
 * a live verification attempt against a real phone number. The two groups share no suffix, no tag and no
 * marker of any kind, so a rule admitting "a POST that looks like a query" would admit the ones that spend
 * a person's one-time code. Reproduce the eight with:
 *
 * ```bash
 * slopweaver atlas twilio read --kind method --query "POST Check" --json
 * ```
 *
 * Three reachable reads is not worth a rule that cannot tell them from a side effect on somebody's phone,
 * so the exemption is deliberately not taken. The three are still mapped like every other operation and a
 * reader still learns they exist — what they never get is a call from this atlas.
 *
 * ## A refused operation still gets a row
 *
 * Every operation in the pinned definitions is published as a `method` entity, refused or not. An atlas
 * that omitted the writes would answer "Twilio has no way to send a message", which is false — the
 * inventory is what makes an exclusion a stated decision rather than a silence, and `docs/atlas-intent/settled-decisions.md`'s
 * gap-list-as-deliverable property depends on it.
 */

/** Every HTTP method the pinned definitions declare. */
export const TWILIO_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** One HTTP method, as the definitions spell it. */
export type TwilioMethod = (typeof TWILIO_METHODS)[number];

/**
 * Why one operation is never called, or `null` when it observes.
 *
 * @param method the HTTP method the definition declares
 * @returns the refusal reason, in English, or `null` for an observational operation
 */
export function twilioExclusionFor({ method }: { method: TwilioMethod }): string | null {
  if (method === "GET") {
    return null;
  }
  if (method === "POST") {
    return (
      "Twilio uses POST to create AND to update, and has no naming convention marking the few that only " +
      "read — the same verb sends a message, changes a service and spends a one-time verification code. " +
      "So it is inventoried and never called; see `exclusions.ts` for the measurement behind refusing the " +
      "three genuine reads along with the rest"
    );
  }
  if (method === "DELETE") {
    return "removes a record from this account; an atlas that could call it could destroy the ground truth it maps";
  }
  return `${method} changes a record in this account — this atlas only ever reads`;
}

/**
 * Whether this atlas may call one operation.
 *
 * @param method the HTTP method the definition declares
 * @returns `true` when the operation observes and may be called
 */
export function isTwilioObservational({ method }: { method: TwilioMethod }): boolean {
  return twilioExclusionFor({ method }) === null;
}
