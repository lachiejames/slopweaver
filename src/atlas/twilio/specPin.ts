/**
 * The shape of one row in the generated Twilio specification lock.
 *
 * Hand-written and kept beside the generator's output rather than inside it, so the TYPE is reviewable
 * independently of the sixty rows that satisfy it — a generated file nobody reads is a poor place to
 * discover that a field changed meaning.
 *
 * ## Why a Twilio pin carries a HOST
 *
 * Twilio does not serve one API from one origin. Each product answers on its own subdomain —
 * `messaging.twilio.com`, `taskrouter.twilio.com`, `insights.twilio.com` — and the account-level API of
 * 2010 still answers on `api.twilio.com` beside all of them. "Where does this live" is therefore a real
 * question about Twilio in a way it is not about a single-origin product, and an atlas that recorded only
 * paths would answer it wrong for fifty-nine of the sixty documents.
 */

/** One published Twilio API definition, pinned by digest. */
export interface TwilioSpecPin {
  readonly byteLength: number;
  /** Every origin this document's operations answer on, sorted — Twilio's per-product subdomains. */
  readonly hosts: readonly string[];
  /** Twilio's own file stem, e.g. `twilio_messaging_v1`. The id every operation cites. */
  readonly id: string;
  readonly operationCount: number;
  readonly pathCount: number;
  /** The product this document describes, from the stem — `messaging`, `taskrouter`, `api`. */
  readonly product: string;
  /** Every security scheme its operations require, sorted — which credential reaches this API. */
  readonly securitySchemes: readonly string[];
  readonly sha256: string;
  /** `info.title` as Twilio writes it, e.g. `Twilio - Messaging`. */
  readonly title: string;
  readonly url: string;
  /** The API version from the stem — `v1`, `v2`, `v2010`. Several are live at once. */
  readonly version: string;
}
