/**
 * Turn what the Xero web client asked for into atlas rows — the OPERATION it called and the field NAMES
 * that came back, never a value.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in Xero session sees the organisation's whole books. The browser channel records what the client
 * can ASK FOR, never what those books contain, so the reduction is a thing a reviewer reads once here. The
 * walk and the redaction pass are `kit/responseShape.ts`, shared with the Slack, Vanta, CrowdStrike and
 * Notion atlases; what is Xero's own is here.
 *
 * ## First party is the whole `xero.com` tree, not one origin
 *
 * Unlike the sibling atlases, one Xero page talks to several Xero hosts: the client is served from
 * `go.xero.com`, calls its own edge API on another host, reads reports from a third and the account hub from
 * a fourth. Matching one origin would drop most of the surface the walk exists to find, so the test is the
 * registrable domain — and it is a SUFFIX test written to reject `notxero.com` and `xero.com.evil.test`
 * alike, because a sloppy `includes` here would admit a third party's telemetry into a first-party surface
 * map.
 *
 * ## The operation is the whole path shape, because Xero's own routes carry the meaning
 *
 * Notion's client posts every operation to one path and names it in the last segment, so its reduction keys
 * on that segment. Xero does the opposite: `GET /api.xro/2.0/Invoices` and `GET /api.xro/2.0/Contacts` are
 * different paths, and the shape IS the identity. So a row here is keyed on `<METHOD> <host><path shape>`,
 * which is also exactly the form an SDK-declared operation projects to — see `projection.ts` on why that
 * byte-exactness is the disagreement detector rather than a matching convenience.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

/**
 * The registrable domain every first-party Xero host sits under.
 *
 * @internal
 */
export const XERO_DOMAIN = "xero.com";

/** A uuid in any segment, dashed or bare — Xero's own identifier shape for every business object. */
const XERO_UUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i;

/** A bare run of digits — a legacy numeric id, an epoch, or a page offset. */
const DIGITS_ONLY = /^[0-9]+$/;

/** The organisation short code, which identifies the organisation and may never be written down. */
const SHORT_CODE = /^![A-Za-z0-9_-]+$/;

/**
 * An opaque token segment: long, and mixing cases or carrying base64 punctuation.
 *
 * Xero threads short-lived tokens through some client routes, and a token is a value even though it matches
 * no id shape above. The length floor keeps ordinary route names — `BankAccounts.aspx`, `chart-of-accounts`
 * — out of it, and is stated as a constant rather than inlined so a reader can see where the line is.
 */
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{24,}$/;

/**
 * How long a segment must be before it can be judged an opaque token.
 *
 * @internal
 */
export const XERO_TOKEN_MIN_LENGTH = 24;

/**
 * Xero's own value-segment shapes, handed to the kit's redaction pass.
 *
 * @returns the placeholder to substitute, or `null` for a segment that is a real path name
 * @internal
 */
export const XERO_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (SHORT_CODE.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{org}" };
  }
  if (XERO_UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{id}" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{n}" };
  }
  if (segment.length >= XERO_TOKEN_MIN_LENGTH && OPAQUE_TOKEN.test(segment) && !isRouteName({ segment })) {
    return { collapsesWithPrevious: false, placeholder: "{token}" };
  }
  return null;
};

/**
 * Whether a long segment is a readable route name rather than an opaque token.
 *
 * A route name Xero writes is either camel-cased English or hyphenated English, so it carries a vowel in
 * every few characters; a token does not. This is deliberately a weak test used only to RESCUE a segment
 * the length rule would otherwise redact — being wrong costs a path shape a readable name, never a leak.
 *
 * @param segment the segment to judge
 * @returns whether it reads as a route name
 */
function isRouteName({ segment }: { segment: string }): boolean {
  return segment.includes("-") || segment.includes(".");
}

/**
 * How deep into a response body the field census walks before it stops.
 * @internal
 */
export const XERO_PATH_DEPTH = 2;

/**
 * The most field names one observation keeps.
 * @internal
 */
export const XERO_PATH_CAP = 200;

/** One call the Xero web client made, reduced to what may be stored. */
export interface XeroObservedCall {
  readonly method: string;
  /** The host the call went to, which is part of the identity — Xero spreads its client over several. */
  readonly host: string;
  /** The path with every value segment replaced, e.g. `/api.xro/2.0/Invoices/{id}`. */
  readonly pathShape: string;
  readonly statusCode: number;
  /** Every field name observed in the response body, sorted. Names only, never a value. */
  readonly responseFields: readonly string[];
}

/**
 * Whether a captured response went to Xero itself, rather than to the telemetry a page also sends.
 *
 * @param url the response's URL
 * @returns whether the host is `xero.com` or a subdomain of it
 *
 * @internal
 */
export function isFirstPartyXeroCall({ url }: { url: string }): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === XERO_DOMAIN || host.endsWith(`.${XERO_DOMAIN}`);
}

/**
 * The path shape of a Xero client URL, with every value segment redacted.
 *
 * @param url the response's URL
 * @returns the redacted path shape, or `null` when the URL cannot be read
 *
 * @internal
 */
export function xeroPathShape({ url }: { url: string }): string | null {
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
      const verdict = XERO_SEGMENTS({ segment });
      if (verdict === null) {
        return segment;
      }
      return verdict.placeholder;
    });
  return `/${shaped.join("/")}`;
}

/**
 * The host a Xero client URL went to.
 *
 * @param url the response's URL
 * @returns the lower-cased hostname, or `null` when the URL cannot be read
 *
 * @internal
 */
export function xeroCallHost({ url }: { url: string }): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Reduce one page's captured responses to the rows the atlas may store.
 *
 * @param responses everything the page's own client asked for while it rendered
 * @returns one row per first-party call, ordered by host then path so a published file is stable
 */
export function reduceXeroCalls({
  responses,
}: {
  responses: readonly CapturedResponse[];
}): readonly XeroObservedCall[] {
  const rows = responses.flatMap((response): readonly XeroObservedCall[] => {
    if (!isFirstPartyXeroCall({ url: response.url })) {
      return [];
    }
    const pathShape = xeroPathShape({ url: response.url });
    const host = xeroCallHost({ url: response.url });
    if (pathShape === null || host === null) {
      return [];
    }
    return [
      {
        host,
        method: response.method,
        pathShape,
        responseFields: [
          ...responseFieldPaths({ body: response.body, classify: XERO_SEGMENTS, depthCap: XERO_PATH_DEPTH }),
        ]
          .toSorted()
          .slice(0, XERO_PATH_CAP),
        statusCode: response.statusCode,
      },
    ];
  });
  return rows.toSorted((left, right) =>
    `${left.host}${left.pathShape}`.localeCompare(`${right.host}${right.pathShape}`),
  );
}
