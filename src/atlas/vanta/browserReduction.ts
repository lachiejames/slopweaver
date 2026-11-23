/**
 * Turn what the Vanta web client asked for into atlas rows — the OPERATION it called and the field NAMES
 * that came back, never a value.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in Vanta session sees every person's employment and leave state, every device's serial number
 * and every piece of evidence behind a control. The browser channel records what the client can ASK FOR,
 * never what this tenant contains, so the reduction is a thing a reviewer reads once here.
 *
 * The walk and the redaction pass are `kit/responseShape.ts`, shared with the Slack and CrowdStrike
 * atlases. What is Vanta's own is here, and it is exactly the part that could not be shared twice over.
 *
 * ## Vanta addresses operations, not paths, which changes what a row IS
 *
 * MEASURED on a live page: every first-party call the client makes is
 * `POST /c/<tenant>/graphql?operation=<name>` — `userContext`, `featureFlagConfig`, `getNextOpenInvoice`
 * on one page alone. So the path shape is nearly constant and carries no information, and the OPERATION
 * NAME is the identity of the call. Reducing Vanta with a path-shaped classifier would have produced one
 * indistinguishable `graphql` row per page and thrown the entire surface away.
 *
 * ## The tenant segment is redacted, and that is not cosmetic
 *
 * The slug in `/c/<tenant>/graphql` is the organisation's own name, which this repository may not carry.
 * {@link VANTA_SEGMENTS} classifies it so the stored path shape reads `/c/{tenant}/graphql`, which is why a
 * reduced row can be committed to a fixture at all.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

/** A Vanta identifier: 24 lowercase hex characters, the shape every id in its own API and client carries. */
const VANTA_HEX_ID = /^[0-9a-f]{24}$/;

/** A trace or correlation uuid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A bare run of digits — an epoch, an offset, or a numeric id used as a map key. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Vanta's own value-segment shapes, handed to the kit's redaction pass.
 *
 * The `c` marker is what makes the segment AFTER it a tenant rather than a page, so the classifier is
 * positional in exactly one place and stated rather than inferred.
 *
 * @returns the placeholder to substitute, or `null` for a segment that is a real path name
 * @internal
 */
export const VANTA_SEGMENTS: SegmentClassifier = ({ segment }) => {
  // No Vanta value is split across two dotted segments, so two adjacent ids are genuinely two ids and
  // collapsing them would understate the shape — unlike a Slack timestamp, which is why the kit asks.
  if (VANTA_HEX_ID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{id}" };
  }
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{uuid}" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{n}" };
  }
  return null;
};

/** How deep into a response body the field census walks before it stops. *
 * @internal
 */
export const VANTA_PATH_DEPTH = 5;

/** The most field paths one observation keeps. *
 * @internal
 */
export const VANTA_PATH_CAP = 200;

/** One call the Vanta web client made, reduced to what may be stored. */
export interface VantaObservedCall {
  /** The GraphQL operation name, or `null` for a call that is not a GraphQL post. */
  readonly operation: string | null;
  readonly method: string;
  /** The path with every value segment replaced, e.g. `/c/{tenant}/graphql`. */
  readonly pathShape: string;
  readonly statusCode: number;
  /** Every field path observed in the response body, sorted. Names only, never a value. */
  readonly responseFields: readonly string[];
}

/**
 * The identity of one observed call: its operation name where it has one, and its redacted path shape
 * otherwise. A call with no operation is not a GraphQL post, and those are genuinely different things — so
 * a `null` operation is a declared state of the call, never a missing value.
 *
 * @param call one reduced call
 * @returns the operation name, or `<method> <pathShape>` for a call that names none
 */
export function vantaCallProviderId({ call }: { call: VantaObservedCall }): string {
  if (call.operation === null) {
    return `${call.method} ${call.pathShape}`;
  }
  return call.operation;
}

/**
 * Whether a captured response is Vanta's own, rather than the telemetry a page also sends.
 *
 * MEASURED on one page: the responses seen outnumbered the eligible ones, and the ones that were not
 * eligible were Datadog RUM and a feature-flag registry. A walk that stored those would be an atlas of somebody else's product.
 *
 * @param url the response's URL
 * @param origin the Vanta web origin
 * @returns whether this response belongs to Vanta itself
 *
 * @internal
 */
export function isFirstPartyVantaCall({ url, origin }: { url: string; origin: string }): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The GraphQL operation a Vanta client URL names.
 *
 * @param url the response's URL
 * @returns the operation name, or `null` when the call is not a named GraphQL post
 *
 * @internal
 */
export function vantaOperationName({ url }: { url: string }): string | null {
  try {
    return new URL(url).searchParams.get("operation");
  } catch {
    return null;
  }
}

/**
 * The path shape of a Vanta client URL, with the tenant and every id segment redacted.
 *
 * @param url the response's URL
 * @returns the redacted path shape, or `null` when the URL cannot be read
 *
 * @internal
 */
export function vantaPathShape({ url }: { url: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const shaped = segments.map((segment, index) => {
    if (index > 0 && segments[index - 1] === "c") {
      return "{tenant}";
    }
    const verdict = VANTA_SEGMENTS({ segment });
    return verdict === null ? segment : verdict.placeholder;
  });
  return `/${shaped.join("/")}`;
}

/** Order two reduced calls: named operations first and alphabetically, then by path shape. */
function compareCalls({ left, right }: { left: VantaObservedCall; right: VantaObservedCall }): number {
  if (left.operation !== null && right.operation !== null && left.operation !== right.operation) {
    return left.operation.localeCompare(right.operation);
  }
  if (left.operation === null && right.operation !== null) {
    return 1;
  }
  if (left.operation !== null && right.operation === null) {
    return -1;
  }
  return left.pathShape.localeCompare(right.pathShape);
}

/**
 * Reduce one page's captured responses to the rows the atlas may store.
 *
 * @param responses everything the page's own client asked for while it rendered
 * @param origin the Vanta web origin, so third-party telemetry is dropped at extraction rather than filtered later
 * @returns one row per first-party call, ordered by operation then path so a published file is stable
 */
export function reduceVantaCalls({
  responses,
  origin,
}: {
  responses: readonly CapturedResponse[];
  origin: string;
}): readonly VantaObservedCall[] {
  const rows = responses.flatMap((response): readonly VantaObservedCall[] => {
    if (!isFirstPartyVantaCall({ origin, url: response.url })) {
      return [];
    }
    const pathShape = vantaPathShape({ url: response.url });
    if (pathShape === null) {
      return [];
    }
    return [
      {
        method: response.method,
        operation: vantaOperationName({ url: response.url }),
        pathShape,
        responseFields: [
          ...responseFieldPaths({
            body: response.body,
            classify: VANTA_SEGMENTS,
            depthCap: VANTA_PATH_DEPTH,
          }),
        ]
          .toSorted()
          .slice(0, VANTA_PATH_CAP),
        statusCode: response.statusCode,
      },
    ];
  });
  // A call with no operation name is not a GraphQL post, and those sort after the named ones rather than
  // being coalesced to an empty string — an empty operation and an absent one are different facts.
  return rows.toSorted((left, right) => compareCalls({ left, right }));
}
