/**
 * Turn what the Notion web client asked for into atlas rows — the OPERATION it called and the field NAMES
 * that came back, never a value.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in Notion session sees every page the person can open. The browser channel records what the
 * client can ASK FOR, never what this workspace contains, so the reduction is a thing a reviewer reads once
 * here. The walk and the redaction pass are `kit/responseShape.ts`, shared with the Slack, Vanta and
 * CrowdStrike atlases; what is Notion's own is here.
 *
 * ## The client's own API is a different API from the one the SDK declares
 *
 * The installed `@notionhq/client` addresses `api.notion.com/v1/<resource>`. The web client addresses
 * `www.notion.so/api/v3/<operation>` — a different host, a different version and a different vocabulary. So
 * a reduced row here will almost never share a `providerId` with an SDK-declared method, and that is the
 * finding rather than a matching bug: `disagreement.ts` reports it, and `model.ts` explains why the two
 * channels are kept side by side instead of folded together.
 *
 * ## The operation is the LAST path segment, which is what makes a row identifiable
 *
 * `POST /api/v3/loadCachedPageChunk` and `POST /api/v3/getSpaces` share everything but their final segment,
 * so a reduction that stored only a path SHAPE would produce one indistinguishable `/api/v3/{op}` row and
 * throw the whole surface away — the same failure the Vanta reduction avoids by keying on the GraphQL
 * operation name.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

/**
 * A Notion id ANYWHERE in a path segment: 32 hexadecimal characters, or the dashed uuid form of the same.
 *
 * Deliberately not anchored, and that is what closes a MEASURED leak. An anchored version lets
 * a whole segment through because the id was only part of it — the client fetches an attachment as
 * `/image/attachment%3A<uuid>%3A<the uploader's own file name>.jpg`, so an anchored test matched nothing and
 * the stored path shape carried a real file name out of the workspace and into a printed report. A segment
 * that CONTAINS an id is a value, whatever else is wrapped around it.
 */
const NOTION_ID_ANYWHERE = /[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** A bare run of digits — an epoch, an offset, or a numeric id used as a map key. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * A percent-encoded colon, which is how the client packs a structured reference into one path segment.
 *
 * `attachment%3A<id>%3A<name>` is the measured case, and the NAME half is the workspace's own. A segment
 * carrying one is a value even when its id half is missing or malformed, so this is a second, independent
 * reason to redact rather than a restatement of the first.
 */
const PACKED_REFERENCE = "%3a";

/**
 * The path prefix every first-party operation of the web client is addressed under.
 *
 * @internal
 */
export const NOTION_CLIENT_API_PREFIX = "/api/v3/";

/**
 * Notion's own value-segment shapes, handed to the kit's redaction pass.
 *
 * @returns the placeholder to substitute, or `null` for a segment that is a real path name
 * @internal
 */
export const NOTION_SEGMENTS: SegmentClassifier = ({ segment }) => {
  const lowered = segment.toLowerCase();
  // No Notion value is split across two dotted segments, so two adjacent ids are genuinely two ids and
  // collapsing them would understate the shape.
  if (lowered.includes(PACKED_REFERENCE)) {
    return { collapsesWithPrevious: false, placeholder: "{ref}" };
  }
  if (NOTION_ID_ANYWHERE.test(lowered)) {
    return { collapsesWithPrevious: false, placeholder: "{id}" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{n}" };
  }
  return null;
};

/**
 * How deep into a response body the field census walks before it stops.
 * @internal
 */
export const NOTION_PATH_DEPTH = 2;

/**
 * The most field names one observation keeps.
 * @internal
 */
export const NOTION_PATH_CAP = 200;

/** One call the Notion web client made, reduced to what may be stored. */
export interface NotionObservedCall {
  /** The operation the client named, or `null` for a call that is not one of its own API posts. */
  readonly operation: string | null;
  readonly method: string;
  /** The path with every value segment replaced, e.g. `/api/v3/getSpaces`. */
  readonly pathShape: string;
  readonly statusCode: number;
  /** Every field name observed in the response body, sorted. Names only, never a value. */
  readonly responseFields: readonly string[];
}

/**
 * Whether a captured response is Notion's own, rather than the telemetry a page also sends.
 *
 * @param url the response's URL
 * @param origin the Notion web origin
 * @returns whether this response belongs to Notion itself
 *
 * @internal
 */
export function isFirstPartyNotionCall({ url, origin }: { url: string; origin: string }): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The operation a Notion client URL names.
 *
 * @param url the response's URL
 * @returns the final path segment beneath the client's own API prefix, or `null` when the call is not one
 *
 * @internal
 */
export function notionOperationName({ url }: { url: string }): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(NOTION_CLIENT_API_PREFIX)) {
    return null;
  }
  const tail = pathname.slice(NOTION_CLIENT_API_PREFIX.length);
  return tail.length === 0 ? null : tail;
}

/**
 * The path shape of a Notion client URL, with every id segment redacted.
 *
 * @param url the response's URL
 * @returns the redacted path shape, or `null` when the URL cannot be read
 *
 * @internal
 */
export function notionPathShape({ url }: { url: string }): string | null {
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
      const verdict = NOTION_SEGMENTS({ segment });
      if (verdict === null) {
        // The classifier names no value shape in it, so it is a literal route segment and stays as written.
        return segment;
      }
      return verdict.placeholder;
    });
  return `/${shaped.join("/")}`;
}

/** Order two reduced calls: named operations first and alphabetically, then by path shape. */
function compareCalls({ left, right }: { left: NotionObservedCall; right: NotionObservedCall }): number {
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
 * @param origin the Notion web origin, so third-party telemetry is dropped at extraction rather than filtered later
 * @returns one row per first-party call, ordered by operation then path so a published file is stable
 */
export function reduceNotionCalls({
  responses,
  origin,
}: {
  responses: readonly CapturedResponse[];
  origin: string;
}): readonly NotionObservedCall[] {
  const rows = responses.flatMap((response): readonly NotionObservedCall[] => {
    if (!isFirstPartyNotionCall({ origin, url: response.url })) {
      return [];
    }
    const pathShape = notionPathShape({ url: response.url });
    if (pathShape === null) {
      return [];
    }
    return [
      {
        method: response.method,
        operation: notionOperationName({ url: response.url }),
        pathShape,
        responseFields: [
          ...responseFieldPaths({ body: response.body, classify: NOTION_SEGMENTS, depthCap: NOTION_PATH_DEPTH }),
        ]
          .toSorted()
          .slice(0, NOTION_PATH_CAP),
        statusCode: response.statusCode,
      },
    ];
  });
  // A call with no operation name is not one of the client's own API posts, and those sort after the named
  // ones rather than being coalesced to an empty string — an empty operation and an absent one differ.
  return rows.toSorted((left, right) => compareCalls({ left, right }));
}
