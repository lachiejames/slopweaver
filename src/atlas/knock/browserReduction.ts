/**
 * Turn what the Knock dashboard asked for into atlas rows — the OPERATION it called and the field NAMES
 * that came back, never a value.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in Knock dashboard sees every RECIPIENT of every notification the organisation sends: names,
 * email addresses, phone numbers, device tokens, and the full rendered body of messages already delivered.
 * The browser channel records what the client can ASK FOR and never what came back, so the reduction is a
 * thing a reviewer reads once, here. The walk and the redaction pass are `kit/responseShape.ts`, shared
 * with the Slack, Clerk, Vanta, CrowdStrike, Notion and Xero atlases; what is Knock's own is below.
 *
 * ## Knock identifies by human-chosen KEY, which is why the redaction is unusually careful
 *
 * Most platforms mint opaque prefixed ids and a redactor can recognise one by shape. Knock's workflows,
 * guides, broadcasts, audiences, goals, partials, layouts, message types and channel groups are addressed
 * by a key a person typed — `welcome-email`, `billing-alert` — which is indistinguishable in shape from a
 * route name Knock itself chose. So a shape-only redactor either leaves the organisation's own workflow
 * keys in a stored path, or redacts Knock's route names and makes every operation look undeclared.
 *
 * The answer is that a segment is judged by its POSITION rather than only by its shape: the wire path is
 * matched against the operation registry's own path templates, and any segment sitting where a template
 * declares a `{brace}` is a value whatever it looks like. A path that matches no template falls back to the
 * shape rules below, which is the honest behaviour for an operation neither document declares — the exact
 * case this walk exists to find.
 *
 * ## First party is `knock.app`, not one origin
 *
 * One dashboard page talks to the dashboard, the Management API on `control.knock.app` and the data API on
 * `api.knock.app`. Matching one origin would drop most of the surface the walk exists to find, so the test
 * is the registrable domain — and it is a SUFFIX test written to reject `notknock.app` and
 * `knock.app.evil.test` alike. Analytics, session-replay and error-reporting vendors a dashboard page loads
 * contribute nothing at all: not a redacted row, not a count, because recording them would put a third
 * party's endpoint shapes into a map of what Knock offers.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

import { KNOCK_SURFACES } from "./generated/surfaces.js";
import { KNOCK_APIS, type KnockApi } from "./surfaceNaming.js";

/** A UUID, dashed or bare. */
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A bare run of digits — a legacy numeric id, an epoch, or a page offset. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * How long a segment must be before its shape alone can mark it a value.
 *
 * Twenty, matching the Clerk atlas. Knock's own route names are lower-case words joined by underscores and
 * never reach it; its ULIDs and message ids comfortably exceed it.
 * @internal
 */
export const KNOCK_TOKEN_MIN_LENGTH = 20;

/**
 * An opaque token segment: long, and MIXING case with a digit.
 *
 * The mixed-case-and-digit test is what separates a minted id from a route name, because a route name Knock
 * writes is lower-case words and never both — the same measurement the Clerk atlas records, and the same
 * reason: without it, `/v1/message_types` would have had its last segment redacted and a real declared
 * operation reported as undocumented.
 */
const OPAQUE_TOKEN = /^(?=[A-Za-z0-9_-]{20,}$)(?=[^A-Z]*[A-Z])(?=\D*\d)[A-Za-z0-9_-]+$/;

/**
 * Knock's own value-segment shapes, handed to the kit's redaction pass for a path no template matched.
 *
 * @returns the placeholder to substitute, or `null` for a segment that is a real path name
 * @internal
 */
export const KNOCK_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{n}" };
  }
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{uuid}" };
  }
  if (segment.length >= KNOCK_TOKEN_MIN_LENGTH && OPAQUE_TOKEN.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{token}" };
  }
  return null;
};

/**
 * How deep into a response body the field census walks before it stops.
 * @internal
 */
export const KNOCK_PATH_DEPTH = 2;

/**
 * The most field names one observation keeps.
 * @internal
 */
export const KNOCK_PATH_CAP = 200;

/** One call the Knock dashboard made, reduced to what may be stored. */
export interface KnockObservedCall {
  /** Which of Knock's published APIs this host serves, or `null` for the dashboard's own origin. */
  readonly api: KnockApi | null;
  readonly host: string;
  readonly method: string;
  /** Every field name observed in the response body, sorted. Names only, never a value. */
  readonly responseFields: readonly string[];
  readonly statusCode: number;
  /** The wire path with every value segment replaced, e.g. `/v1/workflows/{workflow_key}`. */
  readonly wirePath: string;
}

/** Which of Knock's APIs one host serves, or `null` when it is the dashboard itself. */
function knockApiForHost({ host }: { host: string }): KnockApi | null {
  if (host === "control.knock.app") {
    return "management";
  }
  return host === "api.knock.app" ? "data" : null;
}

/**
 * Whether a host is Knock's own, by registrable domain rather than by an exact name.
 *
 * A suffix test written to reject `notknock.app` — the dot is part of the match — and `knock.app.evil.test`,
 * which cannot end in the domain at all.
 *
 * @param host the lower-cased hostname
 * @returns true when this is Knock's own
 * @internal
 */
export function isKnockHost({ host }: { host: string }): boolean {
  return host === "knock.app" || host.endsWith(".knock.app");
}

/**
 * Every declared path template, split into segments, so a wire path can be matched positionally.
 *
 * Built once from the committed registry rather than per call: every declared template against every call a
 * page makes is a hot enough loop to matter, and the registry is a constant.
 */
const TEMPLATES: readonly { readonly api: KnockApi; readonly segments: readonly string[] }[] = KNOCK_SURFACES.map(
  (row) => ({ api: row.api, segments: row.path.split("/").filter((segment) => segment.length > 0) }),
);

/**
 * The declared template one wire path matches, or `null` when no declared operation has its shape.
 *
 * A `{brace}` segment matches anything; every other segment must match byte-exactly. `null` is the
 * interesting answer — it means the dashboard called something neither document declares.
 *
 * @param api which API the call went to
 * @param segments the wire path's own segments, empty ones removed
 * @returns the matching template's segments, or `null`
 */
function matchTemplate({
  api,
  segments,
}: {
  api: KnockApi | null;
  segments: readonly string[];
}): readonly string[] | null {
  if (api === null) {
    return null;
  }
  const matched = TEMPLATES.find(
    (template) =>
      template.api === api &&
      template.segments.length === segments.length &&
      template.segments.every((declared, at) => declared.startsWith("{") || declared === segments[at]),
  );
  if (matched === undefined) {
    // Absent by design: no declared operation has this shape — the dashboard called something undeclared.
    return null;
  }
  return matched.segments;
}

/**
 * The wire path of a Knock client URL, with every value segment redacted.
 *
 * A path matching a declared template is rewritten to the TEMPLATE, which restores the provider's own
 * parameter names — `/v1/workflows/{workflow_key}` rather than `/v1/workflows/{token}` — and is what keeps
 * a human-chosen workflow key out of the store whatever it looks like. A path matching nothing falls back
 * to the shape rules, which is the honest treatment of an undeclared operation.
 *
 * @param url the response's URL
 * @param api which API the call went to
 * @returns the redacted path, or `null` when the URL cannot be read
 * @internal
 */
export function knockWirePathOf({ url, api }: { url: string; api: KnockApi | null }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const template = matchTemplate({ api, segments });
  if (template !== null) {
    return `/${template.join("/")}`;
  }
  const redacted = segments.map((segment) => {
    const verdict = KNOCK_SEGMENTS({ segment });
    // A segment no rule reads as a value is a literal path word, so it is kept exactly as written.
    if (verdict === null) {
      return segment;
    }
    return verdict.placeholder;
  });
  return `/${redacted.join("/")}`;
}

/**
 * Reduce one page's captured responses to the rows the atlas may store.
 *
 * @param responses everything the page's own client asked for while it rendered
 * @returns one row per first-party call, ordered by host then path so a published file is stable
 */
export function reduceKnockCalls({
  responses,
}: {
  responses: readonly CapturedResponse[];
}): readonly KnockObservedCall[] {
  const rows = responses.flatMap((response): readonly KnockObservedCall[] => {
    let host: string;
    try {
      host = new URL(response.url).hostname.toLowerCase();
    } catch {
      return [];
    }
    if (!isKnockHost({ host })) {
      return [];
    }
    const api = knockApiForHost({ host });
    const wirePath = knockWirePathOf({ api, url: response.url });
    if (wirePath === null) {
      return [];
    }
    return [
      {
        api,
        host,
        method: response.method.toUpperCase(),
        responseFields: [
          ...responseFieldPaths({ body: response.body, classify: KNOCK_SEGMENTS, depthCap: KNOCK_PATH_DEPTH }),
        ].slice(0, KNOCK_PATH_CAP),
        statusCode: response.statusCode,
        wirePath,
      },
    ];
  });
  return rows.toSorted((left, right) => `${left.host}${left.wirePath}`.localeCompare(`${right.host}${right.wirePath}`));
}

/**
 * Every API this reduction knows how to attribute a host to.
 *
 * Exported so a test can assert the attribution covers every member of {@link KNOCK_APIS} rather than
 * silently answering `null` for one — a host that stopped being attributed would make every call to it look
 * like the dashboard's own.
 * @internal
 */
export const KNOCK_ATTRIBUTED_APIS: readonly KnockApi[] = KNOCK_APIS;
