/**
 * The Slack **API** atlas: what the Web API can be asked, what it answers with, and — separately — what the
 * browser client asks that no public surface documents.
 *
 * ## Why this is a second Slack atlas rather than more of the first
 *
 * `src/atlas/slack.ts` maps the WORKSPACE: which conversations exist and how far each has been read. This
 * one maps the **API** itself. They answer different questions and neither substitutes for the other — "is
 * there a channel I have never looked at" is the first; "is there a call that would tell me which threads
 * moved without asking each one" is this one, and no amount of channel coverage can answer it.
 *
 * ## Observed, or absent — never inferred
 *
 * Ported from the Datadog atlas doctrine: a map built by hand is a snapshot of the day somebody typed it,
 * and a name it invents looks exactly as correct as one that works. So every row here carries the SOURCE
 * that produced it ({@link MethodSource}), and a fact nobody observed is `undefined` rather than a plausible
 * default. A tier this atlas does not hold means "no page was read", never "Tier 3".
 *
 * That is why {@link SlackApiAtlas.counts} states the docs figure as a fraction of the method total: a
 * partial docs sweep that reported only what it found would read as complete coverage.
 *
 * ## What is deliberately NOT here
 *
 * No token, cookie, header, request body or response value — from the SDK, from the docs, or from the
 * browser capture the {@link BrowserObservedMethod} rows were built from. The atlas records what the API
 * can do, never what one account did with it. {@link TELEMETRY_PARAM} is the mechanical half of that: the
 * web client stamps every call with a dozen session-identifying `_x_*` parameters, and they are dropped at
 * extraction rather than filtered at render.
 */

/** A published rate-limit tier. `special` is Slack's own word for the per-channel/per-second methods. */
type RateLimitTier = "1" | "2" | "3" | "4" | "special";

/** Which credential a method accepts. `user-only` is load-bearing: `search.*` refuses a bot token. */
type TokenAudience = "bot-and-user" | "user-only" | "unknown";

/** One argument a method accepts, as the SDK declares it. */
export interface MethodParam {
  readonly name: string;
  readonly optional: boolean;
  /** The declared TypeScript type, verbatim — a shape, never a value. */
  readonly type: string;
}

/** One method as the installed SDK declares it: the complete argument and response surface, no guessing. */
export interface SdkMethod {
  /** The dotted API name, e.g. `conversations.replies`. */
  readonly name: string;
  /** The SDK's own one-line description, or `""` when it declares none. */
  readonly description: string;
  readonly argsType: string | undefined;
  readonly params: readonly MethodParam[];
  readonly responseType: string | undefined;
  /** Top-level response fields. */
  readonly responseFields: readonly MethodParam[];
  /** One level down: field name → the names inside it, so `messages[].reply_count` is visible. */
  readonly responseNested: Readonly<Record<string, readonly string[]>>;
}

/**
 * What a method's own documentation page says. Every field is optional because this table holds only pages
 * that were actually fetched — see the header on why a missing tier is not a default one.
 */
export interface DocsFacts {
  readonly name: string;
  readonly tier: RateLimitTier | undefined;
  readonly audience: TokenAudience;
  readonly botScopes: readonly string[];
  readonly userScopes: readonly string[];
  /** The `limit`/`count` default the page states, when it states one. */
  readonly limitDefault: number | undefined;
  /** The `limit`/`count` ceiling the page states, when it states one. */
  readonly limitMax: number | undefined;
  readonly pagination: "cursor" | "page" | "cursor-or-page" | "none" | "unknown";
  /** ISO date the page was read. A docs fact decays; the date is how a reader judges it. */
  readonly observedOn: string;
  /** Anything the page says that changes how the method is CALLED, not merely what it returns. */
  readonly note: string | undefined;
}

/**
 * A method the first-party web client calls, as seen on the wire.
 *
 * These matter for the reason the Datadog atlas keeps `listed` rows: they reveal what data Slack HOLDS.
 * A parameter here that no public page documents is a question worth asking of the public surface — the
 * answer may be that it works, and finding that out is what {@link BrowserObservedMethod.publicSurface}
 * exists to make checkable rather than assumed.
 */
export interface BrowserObservedMethod {
  readonly name: string;
  /** `true` when the installed SDK also declares this name — so it is reachable with an ordinary token. */
  readonly publicSurface: boolean;
  /** Parameters observed on the wire that the SDK does NOT declare. Session telemetry already removed. */
  readonly undocumentedParams: readonly string[];
  /**
   * Response field PATHS observed, one entry per distinct path, capped at {@link BROWSER_PATH_CAP}. Names
   * only; no value was retained, and any path segment that was itself a value — a message timestamp used as
   * a map key — is redacted to `<ts>`.
   */
  readonly responsePaths: readonly string[];
  /**
   * How many distinct paths were observed before the cap. Stated rather than implied: the per-org
   * feature-flag dictionaries among these responses carry more paths than the cap keeps, and a truncated
   * list that did not say so would read as the whole shape.
   */
  readonly responsePathsTotal: number;
}

/** How much of each input actually landed — a coverage statement, not a summary. */
export interface AtlasCounts {
  readonly methods: number;
  readonly params: number;
  readonly responseFields: number;
  /** Of {@link AtlasCounts.methods}, how many carry a docs row. The denominator is the point. */
  readonly withDocs: number;
  readonly browserObserved: number;
  /** Browser-observed names the SDK does not declare — the undocumented surface. */
  readonly browserOnly: number;
}

/** One generation of the atlas. */
export interface SlackApiAtlas {
  /** The `@slack/web-api` version the typings were read from, so a stale generation announces itself. */
  readonly sdkVersion: string;
  readonly builtAtIso: string;
  readonly methods: readonly SdkMethod[];
  readonly docs: readonly DocsFacts[];
  readonly browser: readonly BrowserObservedMethod[];
  readonly counts: AtlasCounts;
}

/**
 * Session-identifying parameters the web client stamps on every call. Dropped at extraction: they identify
 * the capture, not the API, and one of them is the token.
 */
export const TELEMETRY_PARAM = /^(?:_x_|fp$|slack_route$|token$)/;

/**
 * The most response paths one browser-observed row retains. A cap rather than the whole shape because the
 * largest observed responses are feature-flag and preference dictionaries — paths of per-org configuration
 * whose number tracks the workspace's own settings and says nothing about what the API can do.
 * {@link BrowserObservedMethod.responsePathsTotal} keeps the omission visible.
 */
export const BROWSER_PATH_CAP = 100;
