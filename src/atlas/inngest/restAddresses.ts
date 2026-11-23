/**
 * What an UNAUTHENTICATED request can establish about a REST address, and the two surfaces where the answer
 * is opposite.
 *
 * ## The control is the method, not a formality
 *
 * A probe means something only when an INVENTED address answers differently from a real one. MEASURED
 * against `api.inngest.com`, and the two versions disagree completely:
 *
 * ```text
 * GET /v1/events                                  401  {"error":"Unauthorized","status":401}
 * GET /v1/zzzsyntheticzzz-control                 404  404 page not found
 * GET /v1/events/zzzsynthetic/zzzsyntheticzzz-c…  404  404 page not found
 * GET /v2/apps                                    401  {"errors":[{"code":"authorization_header_missing"…
 * GET /v2/zzzsyntheticzzz-control                 401  {"errors":[{"code":"authorization_header_missing"…
 * ```
 *
 * So `/v1` routes its request before it authenticates and `/v2` authenticates before it routes. On v1 a
 * probe establishes existence; on v2 it establishes nothing at all, and recording a v2 row as either
 * "exists" or "not found" would be a lie in one direction or the other. That is what
 * `unprobeable-control-agrees` is for, and it is why {@link INNGEST_V2_CONTROL} must AGREE with a real v2
 * address for this module to behave as documented — if it ever stops agreeing, v2 has begun discriminating
 * and a real v2 route census becomes compilable for the first time.
 *
 * ## The addresses are REVIEWED, and the probe is what makes that falsifiable
 *
 * No published Inngest source binds an operation id to an HTTP method and a path — `restCatalogue.ts`
 * carries why, with the vendor's own 500s. The table below is therefore a REVIEWED reading of the
 * catalogue's own groups and titles, not a vendor declaration, and it says so on every row it produces. What
 * keeps it honest is that a wrong address is not a quiet wrong answer: on v1 it answers 404 like every
 * control, and the sync raises `rest-route-absent` naming it.
 *
 * ## Nothing here sends a method other than GET
 *
 * An anonymous `DELETE` sent to find out whether a route exists is a write attempt whatever it returns. A
 * mutating operation whose address is not also served by a GET is recorded `unprobeable-mutating`. Where a
 * mutating operation's address IS reachable by GET, the GET is sent and a `405 Method Not Allowed` is itself
 * the finding — the route exists and rejects the method — which is how `POST /v1/signals` was established
 * without sending one.
 */
import { absentAsNull } from "#lib/absent.js";
import type { InngestProbeEvidence } from "./model.js";

/** One reviewed address, and which catalogue operations sit on it. */
export interface InngestRestAddress {
  /** The catalogue operation ids this address serves, in catalogue order. */
  readonly operationIds: readonly string[];
  /** The path a GET is sent to, with every identifier segment obviously synthetic. */
  readonly probePath: string;
  /** The path template as reviewed, `{brace}` parameters intact — what a reader needs, never probed as-is. */
  readonly pathShape: string;
}

/**
 * The obviously synthetic segment every identifier in a probe path is replaced by.
 *
 * @internal
 */
export const INNGEST_SYNTHETIC_SEGMENT = "zzzsynthetic";

/** The invented v1 addresses that must ALL answer 404 for a v1 probe to mean anything. */
export const INNGEST_V1_CONTROLS = [
  "/v1/zzzsyntheticzzz-control",
  "/v1/events/zzzsynthetic/zzzsyntheticzzz-control",
  "/v1/runs/zzzsynthetic/zzzsyntheticzzz-control",
] as const;

/**
 * The invented v2 address whose answer must AGREE with a real one.
 *
 * Its agreement is what puts every v2 row in `unprobeable-control-agrees`; its DISAGREEMENT would be the day
 * somebody has to look, so the sync raises a gap in that direction too.
 */
export const INNGEST_V2_CONTROL = "/v2/zzzsyntheticzzz-control";

/** A real v2 address the control is compared against. */
export const INNGEST_V2_REFERENCE_ADDRESS = "/v2/apps";

/**
 * Two v1 addresses confirmed ABSENT, kept because the absences are the useful half.
 *
 * `/v1/apps` and `/v1/functions` both answer 404 while `/v1/events` answers 401, which is what proves the v1
 * discrimination is about the ROUTE rather than about the path depth. They are also the honest answer to
 * "can I list apps on v1" — no, and that surface is v2-only.
 */
export const INNGEST_V1_ABSENT_CONTROLS = ["/v1/apps", "/v1/functions"] as const;

/**
 * The reviewed v1 address table.
 *
 * Every entry names the catalogue operations it serves, so a reader can see the binding rather than infer
 * it, and every entry is probed on every sync. A GET is sent to `probePath`; `pathShape` is what a reader
 * needs and is never requested.
 */
export const INNGEST_V1_ADDRESSES: readonly InngestRestAddress[] = [
  { operationIds: ["ListEvents"], pathShape: "/v1/events", probePath: "/v1/events" },
  {
    operationIds: ["GetEvent"],
    pathShape: "/v1/events/{eventID}",
    probePath: `/v1/events/${INNGEST_SYNTHETIC_SEGMENT}`,
  },
  {
    operationIds: ["ListEventRuns"],
    pathShape: "/v1/events/{eventID}/runs",
    probePath: `/v1/events/${INNGEST_SYNTHETIC_SEGMENT}/runs`,
  },
  {
    operationIds: ["GetRun", "CancelRun"],
    pathShape: "/v1/runs/{runID}",
    probePath: `/v1/runs/${INNGEST_SYNTHETIC_SEGMENT}`,
  },
  {
    operationIds: ["GetRunJobs"],
    pathShape: "/v1/runs/{runID}/jobs",
    probePath: `/v1/runs/${INNGEST_SYNTHETIC_SEGMENT}/jobs`,
  },
  { operationIds: ["ResumeSignal"], pathShape: "/v1/signals", probePath: "/v1/signals" },
  {
    operationIds: ["ListCancellations", "CreateCancellation"],
    pathShape: "/v1/cancellations",
    probePath: "/v1/cancellations",
  },
  { operationIds: ["ListWebhooks", "CreateWebhook"], pathShape: "/v1/webhooks", probePath: "/v1/webhooks" },
  {
    operationIds: ["GetWebhook", "DeleteWebhook", "UpdateWebhook"],
    pathShape: "/v1/webhooks/{webhookID}",
    probePath: `/v1/webhooks/${INNGEST_SYNTHETIC_SEGMENT}`,
  },
];

/**
 * Which evidence class one v1 answer falls into.
 *
 * A 401 and a 403 are both "the route exists and wants a credential"; a 405 is "the route exists and rejects
 * this method", which is what a mutating operation's address answers to a GET. Everything else that is not a
 * 404 is recorded as reachable without a credential, which on this API would itself be worth a look.
 *
 * @param status the status the address answered
 * @returns the evidence class
 */
export function v1EvidenceOf({ status }: { status: number }): InngestProbeEvidence {
  const NOT_FOUND = 404;
  const UNAUTHORIZED = 401;
  const FORBIDDEN = 403;
  const METHOD_NOT_ALLOWED = 405;
  if (status === NOT_FOUND) {
    return "absent-404";
  }
  if (status === UNAUTHORIZED || status === FORBIDDEN) {
    return "exists-auth-required";
  }
  if (status === METHOD_NOT_ALLOWED) {
    return "exists-method-not-allowed";
  }
  return "exists-unauthenticated";
}

/**
 * The address serving one catalogue operation, when the reviewed table names one.
 *
 * @param operationId the catalogue's own operation id
 * @returns the reviewed address, or `null` when no entry claims it
 */
export function v1AddressFor({ operationId }: { operationId: string }): InngestRestAddress | null {
  return absentAsNull({ value: INNGEST_V1_ADDRESSES.find((address) => address.operationIds.includes(operationId)) });
}
