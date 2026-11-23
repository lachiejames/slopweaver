/**
 * Turn what GitHub's own web client asked for into atlas rows — method, path SHAPE and response field NAMES.
 *
 * ## This file is the redaction, and it is committed so it can be reviewed rather than trusted
 *
 * A signed-in GitHub session carries the organisation's own name, its repositories, its people and every
 * response body behind them. The atlas must record what the client can ASK FOR, never what this account
 * contains — so the reduction has to be a thing a reviewer reads.
 *
 * The walk and the redaction pass are `kit/responseShape.ts`, shared with the Slack and CrowdStrike
 * atlases. What is GitHub's own is here, and it is exactly the part that could not be shared: Slack's id
 * pattern is `^[A-Z][A-Z0-9]{8,}$` and Falcon's is 32 lowercase hex, and NEITHER matches a GitHub node id
 * (`MDEyOk9yZ2FuaXphdGlvbjE=`, base64url) or a GitHub database id (a bare integer). Reducing a GitHub
 * capture with either sibling's constants would keep every real id it saw, which is precisely the failure
 * the Slack atlas shipped once — real object ids into a committed file, because its redaction only
 * looked for timestamps.
 *
 * ## What a redacted path deliberately still contains
 *
 * An ORGANISATION or REPOSITORY name in a path is not redacted here, and that is the right call rather than
 * an oversight: it is the scope the observation belongs to, it is already the `scopeRef` on every
 * configuration entity beside it, and a path shape without it would collapse two organisations' surfaces
 * into one row. It stays private the way every other generation field does — under `$SLOPWEAVER_HOME`,
 * never committed, never a fixture. The protection is that it does not leave the machine, not that it was
 * never recorded.
 */
import type { SegmentClassifier } from "../kit/responseShape.js";
import { responseFieldPaths } from "../kit/responseShape.js";

/**
 * A GitHub node id, matched only where it cannot be confused with a field NAME.
 *
 * Base64url either carrying its `=` padding, or long enough (24+) that no camelCase field name reaches it.
 * A first version matched any base64url run of 16 or more, and that destroyed real field names —
 * `ssoOrganizations` is exactly 16 characters of `[A-Za-z]` and was being stored as `<id>`, which is the
 * opposite failure to the one this pattern exists for and quieter: a redaction that eats the shape map
 * leaves a reader with nothing to notice.
 *
 * The residue, stated rather than discovered: a short unpadded node id used as a map key survives as
 * itself. That is the deliberate trade — an opaque provider id is a far smaller thing to hold than a field
 * name is to lose, and the FIELD_NAME allowlist below still catches every key that is not identifier-shaped
 * at all, which is where the real values (emails, display names, paths) live.
 */
const GITHUB_NODE_ID = /^(?:[A-Za-z0-9_-]{16,}={1,2}|[A-Za-z0-9_-]{24,})$/;

/** A bare run of digits — a database id, a page number, or a numeric id used as a map key. */
const DIGITS_ONLY = /^[0-9]+$/;

/** A commit or blob sha: 7 to 40 lowercase hex characters, which no GitHub route word ever is. */
const GIT_SHA = /^[0-9a-f]{7,40}$/;

/** A trace or correlation uuid, which the web client stamps on some of its own calls. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * What a path segment must look like to be a FIELD NAME and survive as itself.
 *
 * An ALLOWLIST, and the direction is the whole point. A denylist of value shapes has to anticipate every
 * value a provider might use as a map KEY, and it will not: a first version of this recognised uuids, git
 * shas, digits and node ids, and a response of the form `{"membersByEmail": {"a@example.test": {…}}}` put a
 * real email address into a stored path, because an email matches none of those. That is the same class the
 * Slack atlas shipped once — real object ids into a committed file, because its redaction only looked
 * for timestamps — arrived at from a different direction.
 *
 * A JSON field name is essentially always a plain identifier. Anything that is not one is a value somebody
 * used as a key, so it is redacted. Over-redacting is the safe error: a shape reader loses nothing it can
 * act on, and the alternative is storing whatever a page happened to be keyed by.
 */
const FIELD_NAME = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

/**
 * GitHub's own value-segment shapes, handed to the kit's redaction pass.
 *
 * None collapses with its neighbour: unlike a Slack timestamp, no GitHub value is split across two dotted
 * segments, so two adjacent ids are genuinely two ids and flattening them would understate the shape.
 *
 * The specific patterns are tested BEFORE the identifier allowlist, and only to give a reader a better
 * placeholder — `<sha>` says something `<value>` does not. The allowlist is what actually makes the
 * redaction safe, and it is the last word: a segment that is not a plain identifier never survives.
 *
 * @param segment one dot-separated path segment
 * @returns how to redact it, or `null` when it is a genuine field name
 */
export const GITHUB_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<uuid>" };
  }
  if (GIT_SHA.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<sha>" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<n>" };
  }
  if (GITHUB_NODE_ID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<id>" };
  }
  // The array marker the kit's own walker emits is a position, not a key, and must survive.
  if (segment.length === 0 || segment === "[]" || FIELD_NAME.test(segment.replace(/\[\]$/u, ""))) {
    return null;
  }
  return { collapsesWithPrevious: false, placeholder: "<value>" };
};

/**
 * Query parameters dropped before a request is recorded.
 *
 * Everything beginning with an underscore is the web client's own cache-busting and analytics bundle, and
 * the named entries are session material. A parameter NAME says what an endpoint accepts; these say what
 * this session was, which is the thing the atlas must not keep.
 *
 * @internal
 */
export const GITHUB_TELEMETRY_PARAM = /^(?:_|cb$|t$|timestamp$|token$|access_token$|authenticity_token$|csrf|nonce$)/i;

/**
 * How deep a response path is kept, matched to where GitHub's own JSON payloads carry their fields.
 *
 * @internal
 */
export const GITHUB_PATH_DEPTH = 4;

/**
 * The most response paths one recorded call retains.
 *
 * A cap rather than the whole shape: GitHub's own feature-flag and side-panel documents run to hundreds of
 * per-account preference keys that say nothing about what an endpoint can do. The accumulator below counts
 * before it truncates, so the omission is visible rather than silent.
 *
 * @internal
 */
export const GITHUB_PATH_CAP = 100;

/** One first-party call the walk observed on one page. */
export interface ObservedWebCall {
  readonly url: string;
  readonly method: string;
  readonly statusCode: number;
  /** The parsed response body, or `undefined` when it was absent or not JSON. */
  readonly body: unknown;
  /** The canonical path of the admin page that was open when this call was made. */
  readonly onPage: string;
}

/** One distinct endpoint the web client was observed calling, reduced to shape. */
export interface WebRequestObservation {
  readonly method: string;
  readonly observedOnPages: readonly string[];
  readonly paramNames: readonly string[];
  readonly pathShape: string;
  readonly responseFieldPaths: readonly string[];
  readonly statusCodes: readonly number[];
}

/**
 * Canonicalise a request URL into a path SHAPE: one entity per endpoint, not one per invocation.
 *
 * Volatile id segments become placeholders, so a call about one repository and the next are one row. The
 * query is dropped entirely — its NAMES are recorded separately, and its values are exactly what must not
 * be kept.
 *
 * @param url the absolute request URL
 * @returns the path shape, or `null` when the URL cannot be parsed
 */
export function githubPathShape({ url }: { url: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").map((segment) => {
    const verdict = GITHUB_SEGMENTS({ segment });
    return verdict === null ? segment : verdict.placeholder;
  });
  return segments.join("/");
}

/**
 * Every query parameter NAME on a request URL, telemetry dropped.
 *
 * @param url the absolute request URL
 * @returns the surviving parameter names, sorted
 */
export function githubParamNames({ url }: { url: string }): readonly string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const names = [...parsed.searchParams.keys()].filter((name) => !GITHUB_TELEMETRY_PARAM.test(name));
  return [...new Set(names)].toSorted();
}

/** What a walk has gathered so far about one endpoint, across every page that called it. */
interface EndpointTally {
  method: string;
  pathShape: string;
  params: Set<string>;
  paths: Set<string>;
  pages: Set<string>;
  codes: Set<number>;
}

/** The tally an endpoint already holds, or a fresh empty one the first time a call reaches it. */
function tallyFor({
  held,
  method,
  pathShape,
}: {
  held: EndpointTally | undefined;
  method: string;
  pathShape: string;
}): EndpointTally {
  if (held == null) {
    return {
      codes: new Set<number>(),
      method,
      pages: new Set<string>(),
      params: new Set<string>(),
      paths: new Set<string>(),
      pathShape,
    };
  }
  return held;
}

/**
 * Fold every call a whole walk observed into one row per distinct endpoint.
 *
 * Accumulating across pages rather than per page is what makes `observedOnPages` useful: the same
 * `/_side-panels/user.json` called from every settings page is one endpoint that every page depends on,
 * which is a fact about GitHub, and thirty identical rows would be a fact about the walk.
 *
 * @param calls every call the walk observed, from every page
 * @returns one observation per distinct method-and-path-shape, sorted
 */
export function reduceWebCalls({ calls }: { calls: readonly ObservedWebCall[] }): readonly WebRequestObservation[] {
  const byEndpoint = new Map<string, EndpointTally>();
  for (const call of calls) {
    const pathShape = githubPathShape({ url: call.url });
    if (pathShape === null) {
      continue;
    }
    const key = `${call.method} ${pathShape}`;
    const entry = tallyFor({ held: byEndpoint.get(key), method: call.method, pathShape });
    for (const name of githubParamNames({ url: call.url })) {
      entry.params.add(name);
    }
    for (const path of responseFieldPaths({
      body: call.body,
      classify: GITHUB_SEGMENTS,
      depthCap: GITHUB_PATH_DEPTH,
    })) {
      entry.paths.add(path);
    }
    entry.pages.add(call.onPage);
    entry.codes.add(call.statusCode);
    byEndpoint.set(key, entry);
  }
  return [...byEndpoint.values()]
    .map((entry): WebRequestObservation => ({
      method: entry.method,
      observedOnPages: [...entry.pages].toSorted(),
      paramNames: [...entry.params].toSorted(),
      pathShape: entry.pathShape,
      responseFieldPaths: [...entry.paths].toSorted().slice(0, GITHUB_PATH_CAP),
      statusCodes: [...entry.codes].toSorted((left, right) => left - right),
    }))
    .toSorted(
      (left, right) => left.pathShape.localeCompare(right.pathShape) || left.method.localeCompare(right.method),
    );
}
