/**
 * Turn what Hex's own web client asked for into atlas rows — method, path SHAPE and, for the calls this
 * atlas is allowed to describe at all, response field NAMES.
 *
 * ## This file is the redaction, and it is committed so it can be reviewed rather than trusted
 *
 * A signed-in Hex session is a window onto the organisation's warehouse. That is a sharper version of the
 * problem this layer exists for than any sibling has: on Twilio the risk is a phone number in a path, and
 * here the risk is a table of sensitive rows in a body. So the reduction has to be a thing a reviewer reads,
 * and it does one thing no sibling reduction does.
 *
 * ## The result-bearing test comes FIRST, and it refuses the shape rather than redacting it
 *
 * Every sibling atlas reduces a captured body to field NAMES and stores those, on the reasoning that a name
 * is what an endpoint offers while a value is what this account holds. **That reasoning does not survive
 * contact with a data workspace.** A cell output's field names ARE the column names of whatever table the
 * query ran against, so "names only" would put the organisation's warehouse schema — and, where a query
 * pivots, its VALUES promoted to keys — into a local file, one row at a time.
 *
 * So {@link isHexResultBearing} runs before any reduction, and a call it matches contributes a row with
 * NOTHING in `responseFields` and a stored sentence saying why. `model.ts`'s `fieldsWithheldBecause` is the
 * field that makes that legible: on every sibling an empty list means the body carried nothing, and here it
 * can also mean the body carried a result set — a reader who cannot tell those apart has been misled by a
 * silence, which is the whole failure `docs/atlas-intent/settled-decisions.md`'s honesty properties exist to prevent.
 *
 * ## Over-redaction is the safe error here, and that is a decision rather than a default
 *
 * A shape reader loses nothing it can act on when a path collapses to `<id>`. The alternative is a
 * person-linked identifier in a file. Every doubtful segment therefore becomes a placeholder, and the
 * key allowlist below is the direction that matters: a DENYLIST of value shapes has to anticipate every
 * value a provider might use as a map key and will not — the sibling GitHub reduction learned this when a
 * body of the form `{"membersByEmail": {"a@example.test": {…}}}` put a real email address into a stored
 * path, because an email matches no value pattern anyone had written.
 */
import { isRecordableBody } from "../kit/consoleFold.js";
import type { SegmentClassifier } from "../kit/responseShape.js";
import { responseFieldPaths } from "../kit/responseShape.js";

import { hexGraphqlWithholdingFor } from "./disposition.js";

/**
 * Hex's own registrable domains, matched at a DOT BOUNDARY rather than by suffix.
 *
 * Two, because the app and its static assets are served from different registrable domains — `hex.tech`
 * carries the app and its APIs, `hex.site` carries the JavaScript. The boundary is not style: CodeQL caught
 * the suffix version of this same test on the sibling Twilio atlas
 * (`js/incomplete-url-substring-sanitization`), where `endsWith("twilio.com")` is also true of
 * `eviltwilio.com` — so a lookalike host's response would have been recorded as one of the vendor's own.
 *
 * @internal
 */
export const HEX_REGISTRABLE_DOMAINS = ["hex.tech", "hex.site"] as const;

/**
 * Whether one captured response is a call HEX answered with a JSON object.
 *
 * The kit's own `isRecordableResponse` judges a first-party call by origin EQUALITY, which would be exact
 * if the app and its APIs shared one host. They nearly do — `app.hex.tech` serves the page, the public API
 * and the client's GraphQL endpoint — but the registrable-domain test is used anyway, because the sibling
 * Twilio atlas MEASURED what an origin test costs when a vendor moves one call to a neighbouring host: a
 * full walk's captured JSON bodies, once the origin test had filtered them, folded to ONE distinct
 * operation. The browser channel was not thin; it was filtered to nothing. Every row here
 * carries its own `host`, so a reader judges what a call was rather than inheriting this repository's guess.
 *
 * @param response the captured response
 * @returns whether Hex itself answered it with a JSON object
 */
export function isFirstPartyHexResponse({ response }: { response: { url: string; body: unknown } }): boolean {
  if (!isRecordableBody({ response })) {
    return false;
  }
  try {
    const { hostname } = new URL(response.url);
    return HEX_REGISTRABLE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/**
 * The GraphQL operation name one observed URL carries, or `null` when it is not a GraphQL call.
 *
 * Hex puts the name in the query string — `app.hex.tech/graphql?op=OrgDetails` — which is what makes the
 * client's GraphQL surface corroborable between the two channels at all: the bundle census mints the same
 * `GRAPHQL <name>` provider id from the shipped JavaScript that a walk mints from a live call.
 *
 * @param url the observed request url
 * @returns the operation name, or `null`
 */
export function hexGraphqlOperationName({ url }: { url: string }): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith("/graphql")) {
      return null;
    }
    const name = parsed.searchParams.get("op");
    return name !== null && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Path fragments whose response is, or renders, the result of executing something against a data connection.
 *
 * The same criterion `disposition.ts` applies to the published document, applied here to a live URL. It is
 * duplicated as DATA rather than shared as a function because the two inputs are different — a declared
 * path template with `{brace}` parameters against a concrete URL with real ids — and a single matcher over
 * both would have to be loose enough to be wrong about one of them.
 *
 * @internal
 */
const RESULT_BEARING_FRAGMENTS = ["/output", "/image", "/threads", "/export", "/download", "/preview"] as const;

/**
 * Whether this atlas may describe one observed response's shape at all.
 *
 * Consulted BEFORE any reduction — see this file's header. A match means the row records that the call
 * happened and nothing about what came back.
 *
 * @param url the observed request url
 * @returns why the body is never described, or `null` when its field names may be recorded
 */
export function isHexResultBearing({ url }: { url: string }): string | null {
  const operation = hexGraphqlOperationName({ url });
  if (operation !== null) {
    return hexGraphqlWithholdingFor({ name: operation });
  }
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    // A url this reader cannot parse is one it cannot classify, and an unclassifiable body on a data
    // workspace is exactly the one to refuse. Over-redaction is the safe error — see this file's header.
    return "this response's address could not be parsed, so it could not be shown to be free of query results";
  }
  if (!RESULT_BEARING_FRAGMENTS.some((fragment) => path.includes(fragment))) {
    return null;
  }
  return (
    "this response is, or renders, the result of executing something against a data connection. Under the " +
    "owner's rule this atlas stores no customer data locally, and on a data workspace a " +
    "response's own field NAMES are the column names of whatever table the query ran against — so not even " +
    "the shape is recorded. That the call happens, on which page, and how often, is"
  );
}

/** A canonical UUID, in the layout Hex addresses most of its objects by. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A bare run of digits — a page number, a numeric id, or a cache-buster used as a segment. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * The identifier alphabet a segment must be made entirely of to be considered an opaque handle.
 *
 * Split from the length and digit tests rather than expressed as one regex, because the natural single
 * pattern — a lookahead asserting the length, then a greedy run either side of a required digit — is
 * polynomial-backtracking and the `redos-check` gate refuses it. Three linear tests say the same thing and
 * cannot backtrack at all.
 */
const HANDLE_ALPHABET = /^[A-Za-z0-9_-]+$/;

/** How long a segment must be before its shape is worth reading as a generated handle rather than a word. */
const HANDLE_MIN_LENGTH = 16;

/** What makes a long identifier-shaped segment a HANDLE rather than a route word.
 *
 * Hex's own locators are not all UUIDs — a project can be addressed by a slug-plus-hash locator — so a
 * UUID-only rule would keep half of them. The digit requirement is what keeps ordinary route words
 * (`context-studio`, `agent-dev-tools`) out of the placeholder while catching a generated handle.
 *
 * @param segment one path segment
 * @returns whether it reads as a generated identifier
 */
function isOpaqueHandle({ segment }: { segment: string }): boolean {
  return segment.length >= HANDLE_MIN_LENGTH && HANDLE_ALPHABET.test(segment) && /[0-9]/.test(segment);
}

/**
 * What a path segment must look like to be a FIELD NAME and survive as itself.
 *
 * An ALLOWLIST, and the direction is the whole point — see this file's header.
 */
const FIELD_NAME = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

/**
 * How deep a response path is worth keeping.
 *
 * Two, matching `specSurface.ts`'s own depth so a browser-observed field path and a declared one are
 * comparable. A disagreement between two surfaces measured at different depths would be an artefact of the
 * measurement rather than a fact about Hex, which is the opposite of what `report.ts` exists to find.
 * @internal
 */
export const HEX_BROWSER_FIELD_DEPTH = 2;

/**
 * How many field paths one endpoint retains, so a single large payload cannot dominate the store.
 * @internal
 */
export const HEX_BROWSER_PATH_CAP = 200;

/**
 * A parameter name that describes the SESSION rather than the endpoint.
 *
 * A name says what an endpoint accepts; a CSRF value, a cache-buster or a trace id says what this session
 * was, which is the thing an atlas must not keep.
 * @internal
 */
export const HEX_TELEMETRY_PARAM = /^(?:_|x-|csrf|xsrf|nonce|trace|traceparent|cb|ts|t)$|token|session|signature/i;

/**
 * Whether one path segment is a VALUE rather than a name, and what to write in its place.
 *
 * Every verdict sets `collapsesWithPrevious: false`, and that is a decision rather than a default: none of
 * these shapes is ever SPLIT across two adjacent segments, so two `<id>` segments in a row are two
 * different records and must stay two placeholders.
 *
 * @param segment one path segment, already split on `/`
 * @returns the placeholder to substitute, or `null` to keep the segment as itself
 */
export const classifyHexSegment: SegmentClassifier = ({ segment }) => {
  if (segment.length === 0) {
    return null;
  }
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<uuid>" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<n>" };
  }
  if (isOpaqueHandle({ segment })) {
    return { collapsesWithPrevious: false, placeholder: "<id>" };
  }
  // The array marker the kit's own walker emits is a POSITION rather than a key, so it must survive the
  // allowlist. Without this, every array-valued field in every body reduced to `<value>` and the shape map
  // lost exactly the paths a list endpoint exists to carry — `values[].id` became `<value>.id`.
  if (segment === "[]" || FIELD_NAME.test(segment.replace(/\[\]$/u, ""))) {
    return null;
  }
  return { collapsesWithPrevious: false, placeholder: "<value>" };
};

/**
 * The response field paths one observed body yields, reduced to names — for a body this atlas may describe.
 *
 * Callers must consult {@link isHexResultBearing} first. This function does not re-check it, deliberately:
 * a shape reducer that also decided policy would put the two decisions in one place where only one of them
 * gets reviewed.
 *
 * @param body the parsed response body
 * @returns the field paths, redacted, capped and sorted
 */
export function hexResponseFieldPaths({ body }: { body: unknown }): readonly string[] {
  return responseFieldPaths({ body, classify: classifyHexSegment, depthCap: HEX_BROWSER_FIELD_DEPTH }).slice(
    0,
    HEX_BROWSER_PATH_CAP,
  );
}
