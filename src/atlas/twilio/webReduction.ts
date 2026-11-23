/**
 * Turn what Twilio's own console client asked for into atlas rows — method, path SHAPE and response field
 * NAMES.
 *
 * ## This file is the redaction, and it is committed so it can be reviewed rather than trusted
 *
 * A signed-in Twilio console carries this account's phone numbers, its message bodies, its recordings and
 * the people they belong to. For a platform carrying customer communications that is the sharpest version
 * of the problem this layer exists for: the atlas must record what the client can ASK FOR, never what this
 * account contains — so the reduction has to be a thing a reviewer reads.
 *
 * The walk and the redaction pass are `kit/responseShape.ts`, shared with the Slack, CrowdStrike and GitHub
 * atlases. What is Twilio's own is here, and it is exactly the part that could not be shared: a Twilio SID
 * is two uppercase letters followed by 32 hex characters, which matches no sibling's pattern — Slack's is
 * `^[A-Z][A-Z0-9]{8,}$`, Falcon's is 32 lowercase hex with no prefix, GitHub's is base64url. Reducing a
 * Twilio capture with any of them would keep every real SID it saw, which is precisely the failure the
 * Slack atlas shipped once: real object ids into a committed file, because its redaction only looked
 * for timestamps.
 *
 * ## An E.164 number is redacted at the SEGMENT level and that is not optional
 *
 * A phone number is the one value in this product that is both a path segment and personal data. The
 * console addresses numbers by SID in most places and by E.164 in a few — `/Lookup/+61...` among them — so
 * the classifier recognises both shapes. Over-redacting is the safe error here in a way it is not
 * elsewhere: a shape reader loses nothing it can act on, and the alternative is storing a person's number
 * in a file.
 */
import { isRecordableBody } from "../kit/consoleFold.js";
import type { SegmentClassifier } from "../kit/responseShape.js";
import { responseFieldPaths } from "../kit/responseShape.js";

/**
 * Twilio's own registrable domain, matched at a DOT BOUNDARY rather than by suffix.
 *
 * The boundary is not style. CodeQL caught the suffix version of this same test in `walk.ts`
 * (`js/incomplete-url-substring-sanitization`, alert 40): `endsWith("twilio.com")` is also true of
 * `eviltwilio.com`, so a lookalike host's response would have been recorded as one of Twilio's own.
 *
 * @internal
 */
export const TWILIO_REGISTRABLE_DOMAIN = "twilio.com";

/**
 * Whether one captured response is a call TWILIO answered — the host test this platform supplies in place
 * of the kit's same-origin one.
 *
 * ## The origin test is wrong here by construction, and it was measured being wrong
 *
 * `kit/consoleFold.ts`'s `isRecordableResponse` judges a first-party call by origin EQUALITY, which is
 * exact on a platform whose console and whose API share one host. Twilio is the platform this atlas exists
 * to say has thirty-eight of them: `descriptor.ts` makes the host "part of the answer" and
 * `twilioMethodBrowserDetailSchema.host` is stored "so a console-only host is visible as one" — a field
 * that could only ever have held the console's own origin while the filter above it admitted nothing else.
 *
 * MEASURED against the owner's signed-in console, reproducible with
 * `slopweaver atlas twilio walk`: of every JSON response body a signed-in walk captured across the pages it
 * landed and photographed, the origin test admitted only those `console.twilio.com` itself served — which,
 * as the next section shows, is not where the console's client does its talking. The browser channel was
 * not thin; it was filtered to nothing.
 *
 * ## What the wider test actually found, which is not what was expected
 *
 * The guess that motivated this change was that the console drives Twilio's PUBLIC product hosts and the
 * origin test was discarding `api.twilio.com` and its siblings. **It is not, and saying so would have been
 * a claim nobody measured.** The second walk, with this predicate in place, folded its recorded calls to
 * **distinct operations on `www.twilio.com` as well as on `console.twilio.com`** — every one of the
 * `www.twilio.com` operations under a `/console/…` prefix (`/console/api/navigation/rpc`,
 * `/console/iam/assertions`, `/console/admin/api/v2/managed-users/<sid>/accounts`). The console is served by a
 * backend-for-frontend on Twilio's MARKETING host, which is the same host the sign-in wall lives on, and
 * that is precisely why an origin test anchored to `console.twilio.com` saw none of it.
 *
 * **That second walk lost its browser session part-way, and what it found is what it had reached by
 * then** — stated rather than rounded up, because a partial denominator quoted as a whole one is the failure
 * `surfaceFill.ts` exists to catch. It is a FLOOR on the operation count for the same reason the route list
 * is a floor, and it does not soften the finding: the domain test's operation count against the origin
 * test's is the comparison, and both walks ran the same routes in the same browser.
 *
 * That makes the finding sharper rather than smaller: not one of those operations matches a
 * spec-declared one, so the whole observed console surface is `report.ts`'s `browser-only` class — private
 * console APIs no published Twilio definition declares.
 *
 * ## Why the registrable domain is the right boundary and not merely a wider one
 *
 * What must stay out is somebody ELSE's traffic — an analytics beacon, a support widget, a font CDN — and
 * none of that is served from `twilio.com`. What must come in is Twilio answering about this account from
 * whichever subdomain serves it, and the measurement above is why that cannot be narrowed to a list of
 * product hosts written in advance: the one host it turned out to need is the one a product-host list would
 * have excluded as marketing. Every row carries its own `host`, so a reader judges what a call was rather
 * than inheriting this repository's guess — whereas a subdomain denylist would be inventing a taxonomy
 * Twilio does not publish.
 *
 * @param response the captured response
 * @returns whether Twilio itself answered it with a JSON object
 */
export function isFirstPartyTwilioResponse({ response }: { response: { url: string; body: unknown } }): boolean {
  if (!isRecordableBody({ response })) {
    return false;
  }
  try {
    const { hostname } = new URL(response.url);
    return hostname === TWILIO_REGISTRABLE_DOMAIN || hostname.endsWith(`.${TWILIO_REGISTRABLE_DOMAIN}`);
  } catch {
    return false;
  }
}

/**
 * A Twilio SID: two uppercase letters then exactly 32 hex characters.
 *
 * Twilio's own universal identifier shape, and the prefix is the type — `AC` an account, `PN` a phone
 * number, `MG` a messaging service, `SM` a message, `CA` a call. The prefix is deliberately NOT preserved
 * in the placeholder: it would be a per-type placeholder for no gain, and the shape map is about paths
 * rather than about which two letters this account's records happen to start with.
 */
const TWILIO_SID = /^[A-Z]{2}[0-9a-fA-F]{32}$/;

/** An E.164 phone number as the console writes one into a path — a plus and 7 to 15 digits. */
const E164 = /^\+?[1-9][0-9]{6,14}$/;

/** A trace or correlation uuid, which the console stamps on some of its own calls. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A bare run of digits — a page number, a numeric id, or a cache-buster used as a segment. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * What a path segment must look like to be a FIELD NAME and survive as itself.
 *
 * An ALLOWLIST, and the direction is the whole point. A denylist of value shapes has to anticipate every
 * value a provider might use as a map KEY, and it will not: the sibling GitHub reduction learned this when
 * a response of the form `{"membersByEmail": {"a@example.test": {…}}}` put a real email address into a
 * stored path, because an email matches no value pattern anyone had written.
 *
 * A JSON field name is essentially always a plain identifier. Anything that is not one is a value somebody
 * used as a key, so it is redacted. On Twilio that is what catches a phone number used as an object key,
 * which no shape pattern above would have to anticipate.
 */
const FIELD_NAME = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

/**
 * How deep a response path is worth keeping.
 *
 * Two, matching `specSurface.ts`'s own depth so a browser-observed field path and a spec-declared one are
 * comparable. A disagreement between two surfaces measured at different depths would be an artefact of the
 * measurement rather than a fact about Twilio, which is the opposite of what `report.ts` exists to find.
 * @internal
 */
export const TWILIO_BROWSER_FIELD_DEPTH = 2;

/**
 * How many field paths one endpoint retains, so a single large payload cannot dominate the store.
 * @internal
 */
export const TWILIO_BROWSER_PATH_CAP = 200;

/**
 * A parameter name that describes the SESSION rather than the endpoint.
 *
 * A name says what an endpoint accepts; a CSRF value, a cache-buster or a trace id says what this session
 * was, which is the thing an atlas must not keep.
 * @internal
 */
export const TWILIO_TELEMETRY_PARAM = /^(?:_|x-|csrf|xsrf|nonce|trace|traceparent|cb|ts|t)$|token|session|signature/i;

/**
 * Whether one path segment is a VALUE rather than a name, and what to write in its place.
 *
 * Every verdict sets `collapsesWithPrevious: false`, and that is a decision rather than a default: none of
 * these shapes is ever SPLIT across two adjacent segments the way a sibling atlas's compound timestamp is,
 * so two `<sid>` segments in a row are two different records and must stay two placeholders.
 *
 * @param segment one path segment, already split on `/`
 * @returns the placeholder to substitute, or `null` to keep the segment as itself
 */
export const classifyTwilioSegment: SegmentClassifier = ({ segment }) => {
  if (segment.length === 0) {
    return null;
  }
  if (TWILIO_SID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<sid>" };
  }
  if (E164.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<phone>" };
  }
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<uuid>" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<n>" };
  }
  // The array marker the kit's own walker emits is a POSITION rather than a key, so it must survive the
  // allowlist. Without this, every array-valued field in every body reduced to `<value>` and the shape map
  // lost exactly the paths a list endpoint exists to carry — `messages[].status` became `<value>.status`.
  if (segment === "[]" || FIELD_NAME.test(segment.replace(/\[\]$/u, ""))) {
    return null;
  }
  return { collapsesWithPrevious: false, placeholder: "<value>" };
};

/**
 * The response field paths one observed body yields, reduced to names.
 *
 * @param body the parsed response body
 * @returns the field paths, redacted, capped and sorted
 */
export function twilioResponseFieldPaths({ body }: { body: unknown }): readonly string[] {
  return responseFieldPaths({ body, classify: classifyTwilioSegment, depthCap: TWILIO_BROWSER_FIELD_DEPTH }).slice(
    0,
    TWILIO_BROWSER_PATH_CAP,
  );
}
