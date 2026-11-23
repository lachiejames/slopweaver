/**
 * Turn what the Clerk dashboard asked for into atlas rows — the OPERATION it called and the field NAMES
 * that came back, never a value.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in Clerk dashboard sees every end user of the product it fronts: names, email addresses, phone
 * numbers, sign-in history. The browser channel records what the client can ASK FOR and never what came
 * back, so the reduction is a thing a reviewer reads once, here. The walk and the redaction pass are
 * `kit/responseShape.ts`, shared with the Slack, Vanta, CrowdStrike, Notion and Xero atlases; what is
 * Clerk's own is below.
 *
 * ## Clerk's identifiers are prefixed, and that is what makes the redaction sharp
 *
 * Every object Clerk mints is `<type>_<base58 blob>` — `user_2Zg…`, `ins_2Zg…`, `org_2Zg…`. The prefix is
 * the type, so a redacted segment can keep it: `/v1/instances/{ins}/domains` says more than
 * `/v1/instances/{id}/domains` and costs nothing, because the prefix is a schema name rather than a value.
 * A bare identifier with no prefix still redacts, on length and alphabet, which is what catches the
 * dashboard API's own opaque route tokens.
 *
 * ## First party is the whole `clerk.com` tree, not one origin
 *
 * One dashboard page talks to five Clerk hosts: the dashboard itself, its own Frontend API, the Backend
 * API, the undocumented dashboard API and a settings CDN. Matching one origin would drop most of the
 * surface the walk exists to find, so the test is the registrable domain — and it is a SUFFIX test written
 * to reject `notclerk.com` and `clerk.com.evil.test` alike (`surfaceNaming.ts`). `clerk-telemetry.com` is
 * Clerk's own and is deliberately NOT first party by that test: the registrable domain is the line, and a
 * line drawn by a list of names goes stale.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

import type { ClerkApi } from "./model.js";
import { clerkApiForHost } from "./surfaceNaming.js";

/**
 * A prefixed Clerk object identifier: a short lower-case type, an underscore, then a long opaque blob.
 *
 * The blob floor is deliberately high enough that a real route segment cannot reach it — Clerk's own are 24
 * characters and more — and the type is captured so the placeholder can keep it.
 */
const CLERK_PREFIXED_ID = /^([a-z][a-z0-9]{1,7})_[A-Za-z0-9]{16,}$/;

/** A bare run of digits — a legacy numeric id, an epoch, or a page offset. */
const DIGITS_ONLY = /^[0-9]+$/;

/** A UUID, dashed or bare — what the dashboard's own log rows are identified by. */
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * A COMPOSITE identifier: two or more value parts joined by a separator an id alphabet does not contain.
 *
 * MEASURED on the first full walk, and this rule exists because of it: the dashboard addresses
 * one application-log row as `<epoch milliseconds>:<uuid>`, and every rule above rejected it — the colon
 * disqualified it from the token alphabet, it is not all digits, and it carries no Clerk type prefix. So a
 * real log id reached a stored path shape unredacted, which is precisely the class
 * `docs/atlas-intent/04-corroboration.md` records the Slack atlas shipping unredacted into its stored paths.
 *
 * The test is deliberately structural rather than a pattern for that one shape: a segment whose parts are
 * EACH a value is a value, whatever joins them.
 */
const COMPOSITE_SEPARATORS = [":", "|", "~"] as const;

/**
 * An opaque token segment: long, and MIXING an upper-case letter with a digit.
 *
 * The dashboard threads unprefixed tokens through some of its own routes — a project key such as
 * `Synth0Key0Fixture0Example0abcd12` — and a token is a value even though it matches no identifier shape
 * above. Length alone is not enough to recognise one, MEASURED on the first real walk: Clerk's own routes
 * are snake_case, so `/v1/me/organization_memberships` had its last segment redacted to `{token}` and the
 * corroboration reported a real Frontend API operation as undocumented. The mixed-case-and-digit test is
 * what separates the two, because a route name Clerk writes is lower-case words and never both.
 */
const OPAQUE_TOKEN = /^(?=[A-Za-z0-9_-]{20,}$)(?=[^A-Z]*[A-Z])(?=\D*\d)[A-Za-z0-9_-]+$/;

/**
 * How long a segment must be before it can be judged an opaque token.
 *
 * @internal
 */
export const CLERK_TOKEN_MIN_LENGTH = 20;

/**
 * Clerk's own value-segment shapes, handed to the kit's redaction pass.
 *
 * @returns the placeholder to substitute, or `null` for a segment that is a real path name
 * @internal
 */
export const CLERK_SEGMENTS: SegmentClassifier = ({ segment }) => {
  const prefixed = CLERK_PREFIXED_ID.exec(segment);
  if (prefixed !== null) {
    // `exec` with a matching group guarantees index 1 when the regex matched at all.
    return { collapsesWithPrevious: false, placeholder: `{${prefixed[1]!}}` };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{n}" };
  }
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{uuid}" };
  }
  if (isCompositeValue({ segment })) {
    return { collapsesWithPrevious: false, placeholder: "{id}" };
  }
  if (segment.length >= CLERK_TOKEN_MIN_LENGTH && OPAQUE_TOKEN.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{token}" };
  }
  return null;
};

/**
 * Whether a segment is two or more VALUE parts joined by a separator.
 *
 * Each part is judged by the same rules a lone segment is, minus this one, so the test cannot recurse. A
 * segment with a separator but only one value part — `v1:users`, say — is left alone, because a readable
 * name beside a value is still a readable name and redacting it would cost the path shape its meaning.
 *
 * @param segment the segment to judge
 * @returns whether every part of it is a value
 */
function isCompositeValue({ segment }: { segment: string }): boolean {
  const separator = COMPOSITE_SEPARATORS.find((candidate) => segment.includes(candidate));
  if (separator === undefined) {
    return false;
  }
  const parts = segment.split(separator).filter((part) => part.length > 0);
  if (parts.length < 2) {
    return false;
  }
  return parts.every(
    (part) =>
      DIGITS_ONLY.test(part) ||
      UUID.test(part) ||
      CLERK_PREFIXED_ID.test(part) ||
      (part.length >= CLERK_TOKEN_MIN_LENGTH && OPAQUE_TOKEN.test(part)),
  );
}

/**
 * How deep into a response body the field census walks before it stops.
 * @internal
 */
export const CLERK_PATH_DEPTH = 2;

/**
 * The most field names one observation keeps.
 * @internal
 */
export const CLERK_PATH_CAP = 200;

/** One call the Clerk dashboard made, reduced to what may be stored. */
export interface ClerkObservedCall {
  readonly method: string;
  /** The host the call went to, which is what {@link clerkApiForHost} decided the API from. */
  readonly host: string;
  /** Which of Clerk's APIs that host and path belong to. */
  readonly api: ClerkApi;
  /** The wire path with every value segment replaced, e.g. `/v1/instances/{ins}/domains`. */
  readonly wirePath: string;
  readonly statusCode: number;
  /** Every field name observed in the response body, sorted. Names only, never a value. */
  readonly responseFields: readonly string[];
}

/**
 * The wire path of a Clerk client URL, with every value segment redacted.
 *
 * @param url the response's URL
 * @returns the redacted path, or `null` when the URL cannot be read
 *
 * @internal
 */
export function clerkWirePathOf({ url }: { url: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const shaped = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      // No verdict is the classifier saying this segment is a real path name, which the shape keeps as written.
      const verdict = CLERK_SEGMENTS({ segment });
      if (verdict === null) {
        return segment;
      }
      return verdict.placeholder;
    });
  return `/${shaped.join("/")}`;
}

/**
 * The host a Clerk client URL went to.
 *
 * @param url the response's URL
 * @returns the lower-cased hostname, or `null` when the URL cannot be read
 *
 * @internal
 */
export function clerkCallHost({ url }: { url: string }): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Reduce one page's captured responses to the rows the atlas may store.
 *
 * A response from a host that is not Clerk's contributes nothing at all — not a redacted row, not a count.
 * A dashboard page loads Sentry, Google Analytics and a session-replay vendor, and none of them is a Clerk
 * surface; recording them would put a third party's endpoint shapes into a map of what Clerk offers.
 *
 * @param responses everything the page's own client asked for while it rendered
 * @returns one row per first-party call, ordered by API then path so a published file is stable
 */
export function reduceClerkCalls({
  responses,
}: {
  responses: readonly CapturedResponse[];
}): readonly ClerkObservedCall[] {
  const rows = responses.flatMap((response): readonly ClerkObservedCall[] => {
    const host = clerkCallHost({ url: response.url });
    const wirePath = clerkWirePathOf({ url: response.url });
    if (host === null || wirePath === null) {
      return [];
    }
    const api = clerkApiForHost({ host, wirePath });
    if (api === null) {
      return [];
    }
    return [
      {
        api,
        host,
        method: response.method.toUpperCase(),
        responseFields: [
          ...responseFieldPaths({ body: response.body, classify: CLERK_SEGMENTS, depthCap: CLERK_PATH_DEPTH }),
        ].slice(0, CLERK_PATH_CAP),
        statusCode: response.statusCode,
        wirePath,
      },
    ];
  });
  return rows.toSorted((left, right) => `${left.api}${left.wirePath}`.localeCompare(`${right.api}${right.wirePath}`));
}
