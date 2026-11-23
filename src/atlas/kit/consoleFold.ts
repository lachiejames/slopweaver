/**
 * Fold every first-party call a browser walk observed into one row per distinct endpoint — kit-owned,
 * because the fold generalises and only its CONSTANTS do not.
 *
 * `responseShape.ts` already holds the redaction pass for the same reason. This is the layer above it: the
 * accumulation, which two atlases had written identically before it moved here.
 *
 * ## What a platform still supplies, and why each one has to
 *
 * - **The segment classifier.** What a value-shaped path segment LOOKS like is the one thing that cannot be
 *   shared: Falcon's ids are 32 hex characters, Vanta's are 24, and another console's may be plain two- or
 *   three-digit integers. A Falcon capture reduced with an integer classifier would redact its API version;
 *   an integer-id capture reduced with Falcon's would keep every real user id it saw. `responseShape.ts` carries the
 *   measured incident behind that.
 * - **The telemetry parameter pattern.** A parameter NAME says what an endpoint accepts; a session token,
 *   a CSRF value or a cache-buster says what this session was, which is the thing an atlas must not keep.
 *   Which names those are is the client's own vocabulary.
 * - **The two caps.** How deep a response path is worth keeping, and how many paths one endpoint retains,
 *   are judgements about where a particular client's payloads carry their meaning.
 *
 * ## Accumulating across PAGES is the point
 *
 * One row per distinct method-and-path-shape, with the pages it was seen on, rather than one row per page.
 * The same people list called from four console pages is one endpoint that four pages depend on — a fact
 * about the console. Four identical rows would be a fact about the walk.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { responseFieldPaths, type SegmentClassifier } from "./responseShape.js";

/** One first-party call a walk observed on one page. */
export interface ObservedCall {
  readonly url: string;
  readonly method: string;
  readonly statusCode: number;
  /** The parsed response body, or `undefined` when it was absent or not JSON. */
  readonly body: unknown;
  /** The canonical href of the page that was open when this call was made. */
  readonly onPage: string;
}

/**
 * One endpoint, as a walk finally records it: what it is, never what it returned.
 *
 * @internal
 */
export interface FoldedCall {
  readonly method: string;
  readonly pathShape: string;
  readonly paramNames: readonly string[];
  readonly responseFieldPaths: readonly string[];
  readonly statusCodes: readonly number[];
  readonly observedOnPages: readonly string[];
}

/** The four things a platform supplies that this fold cannot decide for it. See this file's header. */
export interface ConsoleFoldSpec {
  readonly classify: SegmentClassifier;
  readonly telemetryParam: RegExp;
  readonly depthCap: number;
  readonly pathCap: number;
}

/**
 * Whether a captured response body is worth recording at all, before anything is asked about WHERE it came
 * from.
 *
 * Only what came back as a JSON object: a stylesheet, a font and a bundle say nothing about what a client
 * can ask for. Split from {@link isRecordableResponse} because the body half generalises across every
 * console walk and the HOST half does not — see that function.
 *
 * @param response the captured response
 * @returns whether the body is a JSON object
 */
export function isRecordableBody({ response }: { response: { body: unknown } }): boolean {
  return response.body !== null && response.body !== undefined && typeof response.body === "object";
}

/**
 * Whether a captured response is a first-party call worth recording, on a platform whose console and whose
 * API share ONE origin.
 *
 * Same-origin, plus {@link isRecordableBody}: a third-party analytics beacon is neither the vendor's nor
 * ours to record, and on Falcon and GitHub the console's own calls all answer where the console
 * itself lives, so origin-equality separates the two exactly.
 *
 * **It is the wrong test on a platform that answers from more than one host, and that is not hypothetical.**
 * MEASURED against a signed-in Twilio console: a walk over the console's pages captured its JSON
 * response bodies and this predicate admitted a fraction of them, which folded to exactly ONE distinct operation.
 * Twilio's console is served by a backend-for-frontend on a DIFFERENT host from the console's own origin, so
 * origin-equality discarded the entire browser surface. A platform like that supplies its own host
 * judgement instead (`atlas/twilio/webReduction.ts`'s `isFirstPartyTwilioResponse`), composed over the body
 * half above.
 *
 * @param response the captured response
 * @param origin the console origin to judge it against
 * @returns whether to record it
 */
export function isRecordableResponse({
  response,
  origin,
}: {
  response: { url: string; body: unknown };
  origin: string;
}): boolean {
  if (!isRecordableBody({ response })) {
    return false;
  }
  try {
    return new URL(response.url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Canonicalise a request URL into a path SHAPE: one entity per endpoint, not one per invocation.
 *
 * Volatile id segments become placeholders, so the call for one record and the call for the next are one
 * row. The query is dropped entirely — its NAMES are recorded separately, and its values are exactly what
 * must not be kept.
 *
 * @param url the absolute request URL
 * @param classify the platform's own value-segment recogniser
 * @returns the path shape, or `null` when the URL cannot be parsed
 */
export function pathShapeOf({ url, classify }: { url: string; classify: SegmentClassifier }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.pathname
    .split("/")
    .map((segment) => {
      // A segment the classifier does not judge a value is a path word, kept as it stands.
      const verdict = classify({ segment });
      if (verdict === null) {
        return segment;
      }
      return verdict.placeholder;
    })
    .join("/");
}

/**
 * Every query parameter NAME on a request URL, telemetry dropped.
 *
 * @param url the absolute request URL
 * @param telemetryParam the platform's own pattern for a name that describes the SESSION rather than the
 *   endpoint
 * @returns the surviving parameter names, sorted
 */
export function paramNamesOf({ url, telemetryParam }: { url: string; telemetryParam: RegExp }): readonly string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const names = [...parsed.searchParams.keys()].filter((name) => !telemetryParam.test(name));
  return [...new Set(names)].toSorted();
}

/** One endpoint's accumulator while the fold runs. */
interface Accumulated {
  method: string;
  pathShape: string;
  params: Set<string>;
  paths: Set<string>;
  pages: Set<string>;
  codes: Set<number>;
}

/** The accumulator an endpoint already holds, or a fresh empty one the first time a call reaches it. */
function accumulatorFor({
  held,
  method,
  pathShape,
}: {
  held: Accumulated | undefined;
  method: string;
  pathShape: string;
}): Accumulated {
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
 * @param calls every call the walk observed, from every page
 * @param spec the platform's own classifier, telemetry pattern and two caps
 * @returns one row per distinct method-and-path-shape, sorted so two runs are diffable
 */
export function foldConsoleCalls({
  calls,
  spec,
}: {
  calls: readonly ObservedCall[];
  spec: ConsoleFoldSpec;
}): readonly FoldedCall[] {
  const byEndpoint = new Map<string, Accumulated>();
  for (const call of calls) {
    const pathShape = pathShapeOf({ classify: spec.classify, url: call.url });
    if (pathShape === null) {
      continue;
    }
    const key = `${call.method} ${pathShape}`;
    const entry = accumulatorFor({ held: byEndpoint.get(key), method: call.method, pathShape });
    for (const name of paramNamesOf({ telemetryParam: spec.telemetryParam, url: call.url })) {
      entry.params.add(name);
    }
    for (const path of responseFieldPaths({ body: call.body, classify: spec.classify, depthCap: spec.depthCap })) {
      entry.paths.add(path);
    }
    entry.pages.add(call.onPage);
    entry.codes.add(call.statusCode);
    byEndpoint.set(key, entry);
  }
  return [...byEndpoint.values()]
    .map((entry): FoldedCall => ({
      method: entry.method,
      observedOnPages: [...entry.pages].toSorted(),
      paramNames: [...entry.params].toSorted(),
      pathShape: entry.pathShape,
      responseFieldPaths: [...entry.paths].toSorted().slice(0, spec.pathCap),
      statusCodes: [...entry.codes].toSorted((left, right) => left - right),
    }))
    .toSorted(
      (left, right) => left.pathShape.localeCompare(right.pathShape) || left.method.localeCompare(right.method),
    );
}

/**
 * Narrow a captured response to the fields a reduction reads.
 *
 * Here rather than in each atlas because it is the same five fields for all of them — it stood twice,
 * character for character, in two atlases' reductions, which is what `duplicate-windows` is for.
 *
 * @param response the captured response
 * @param onPage the declared href of the page it was observed on
 * @returns the observed call
 */
export function observedCall({ response, onPage }: { response: CapturedResponse; onPage: string }): ObservedCall {
  return {
    body: response.body,
    method: response.method,
    onPage,
    statusCode: response.statusCode,
    url: response.url,
  };
}

/**
 * The first-party calls one capture made, as observed calls against the page that was open.
 *
 * The third thing every console walk did identically — filter to the platform's own origin, then narrow.
 *
 * @param capture the page capture, reduced to the responses field this reads
 * @param origin the platform origin, so a third party's JSON is not filed under it
 * @param onPage the declared href the calls are recorded against
 * @returns the observed calls
 */
export function firstPartyCalls({
  capture,
  origin,
  onPage,
}: {
  capture: { readonly responses: readonly CapturedResponse[] };
  origin: string;
  onPage: string;
}): readonly ObservedCall[] {
  return capture.responses
    .filter((response) => isRecordableResponse({ origin, response }))
    .map((response) => observedCall({ onPage, response }));
}

/**
 * The accumulators a console walk carries while it visits: the rows, the calls, and the three ways a run
 * can be less complete than its row count suggests.
 *
 * Generic over the platform's own page row, because that is the only part that differs — two atlases' walks
 * declared this same seven-field shape character for character, which is what
 * `duplicate-windows` exists to catch.
 */
export interface ConsoleWalkState<TPage> {
  readonly pages: TPage[];
  readonly calls: ObservedCall[];
  /** Hrefs whose capture lost at least one response body. */
  readonly incompletePages: string[];
  /** Hrefs reached but photographed mid-load. */
  readonly unrenderedPages: string[];
  /** Every URL a visit settled on, so a declared list can be checked against evidence. */
  readonly finalUrls: string[];
  artifactsWritten: number;
}

/**
 * An empty walk state.
 *
 * @returns accumulators with nothing in them
 */
export function emptyConsoleWalkState<TPage>(): ConsoleWalkState<TPage> {
  return { artifactsWritten: 0, calls: [], finalUrls: [], incompletePages: [], pages: [], unrenderedPages: [] };
}
