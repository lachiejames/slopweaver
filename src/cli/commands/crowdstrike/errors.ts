/**
 * The typed failures the `crowdstrike` verbs author themselves: a flag given a value it does not accept, a
 * reset nobody confirmed, a fleet export that cannot be joined, and a console walk that cannot start or has
 * no denominator.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. A list another
 * module already produced — the flag tokeniser's refusals, a credential or token read, a sitemap parse —
 * is not re-authored here: it rides as `reasons`, and its `message` puts one reason per line, so a caller
 * printing `message` writes exactly the lines the list used to print.
 */
import type { RealChromeError } from "../../../browser/errors.js";

/** The flag tokeniser refused the tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface CrowdstrikeFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface CrowdstrikeInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** `crowdstrike reset` was run without `--confirm archive`, so nothing may be archived. */
export interface CrowdstrikeConfirmationMissingError {
  readonly code: "CONFIRMATION_MISSING";
  readonly message: string;
}

/** The fleet export named by `--fleet` could not be read or parsed as JSON. */
export interface CrowdstrikeFleetUnreadableError {
  readonly code: "FLEET_UNREADABLE";
  readonly message: string;
  readonly path: string;
  /** What the read or the parse reported. */
  readonly cause: string;
}

/** The fleet export parsed, and is neither a list of devices nor an object carrying one. */
export interface CrowdstrikeFleetNotAListError {
  readonly code: "FLEET_NOT_A_LIST";
  readonly message: string;
  readonly path: string;
}

/** The stored CrowdStrike credential could not be resolved; `reasons` is the resolver's own list. */
export interface CrowdstrikeCredentialsUnresolvedError {
  readonly code: "CREDENTIALS_UNRESOLVED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The credential's API host pairs with no Falcon console origin this atlas knows. */
export interface CrowdstrikeOriginUnpairedError {
  readonly code: "ORIGIN_UNPAIRED";
  readonly message: string;
  readonly apiHost: string;
}

/** The browser extension's consent token could not be read; `reasons` is the reader's own list. */
export interface CrowdstrikeExtensionTokenUnreadError {
  readonly code: "EXTENSION_TOKEN_UNREAD";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Which Chrome profile the walk drives could not be resolved; `cause` is the pin's own error. */
export interface CrowdstrikeChromePinUnresolvedError {
  readonly code: "CHROME_PIN_UNRESOLVED";
  readonly message: string;
  readonly cause: RealChromeError;
}

/** The visit to the console's own sitemap failed, so the walk has no denominator. */
export interface CrowdstrikeSitemapUnreadError {
  readonly code: "SITEMAP_UNREAD";
  readonly message: string;
  /** What the browser transport reported. */
  readonly cause: string;
}

/**
 * The visit answered and carried no sitemap body. `message` is both lines the verb prints — what is missing,
 * then `hint`, the likely cause and what to do about it.
 */
export interface CrowdstrikeSitemapAbsentError {
  readonly code: "SITEMAP_ABSENT";
  readonly message: string;
  readonly path: string;
  readonly hint: string;
}

/** The sitemap body arrived and is not a sitemap; `reasons` is the sitemap parser's own list. */
export interface CrowdstrikeSitemapInvalidError {
  readonly code: "SITEMAP_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The first line a missing sitemap body prints — what is missing, before the hint saying why. */
function sitemapAbsentLead({ path }: { path: string }): string {
  return `the console returned no ${path} body, so the walk has no denominator`;
}

/** Every failure the `crowdstrike` verb directory authors. */
export type CrowdstrikeVerbError =
  | CrowdstrikeFlagsInvalidError
  | CrowdstrikeInvalidFlagValueError
  | CrowdstrikeConfirmationMissingError
  | CrowdstrikeFleetUnreadableError
  | CrowdstrikeFleetNotAListError
  | CrowdstrikeCredentialsUnresolvedError
  | CrowdstrikeOriginUnpairedError
  | CrowdstrikeExtensionTokenUnreadError
  | CrowdstrikeChromePinUnresolvedError
  | CrowdstrikeSitemapUnreadError
  | CrowdstrikeSitemapAbsentError
  | CrowdstrikeSitemapInvalidError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const CrowdstrikeVerbErrors = {
  chromePinUnresolved: ({ cause }: { cause: RealChromeError }): CrowdstrikeChromePinUnresolvedError => ({
    cause,
    code: "CHROME_PIN_UNRESOLVED",
    message: cause.message,
  }),
  confirmationMissing: (): CrowdstrikeConfirmationMissingError => ({
    code: "CONFIRMATION_MISSING",
    message:
      "crowdstrike reset requires --confirm archive — this archives the current generation and installs a fresh, empty one",
  }),
  credentialsUnresolved: ({ reasons }: { reasons: readonly string[] }): CrowdstrikeCredentialsUnresolvedError => ({
    code: "CREDENTIALS_UNRESOLVED",
    message: reasons.join("\n"),
    reasons,
  }),
  extensionTokenUnread: ({ reasons }: { reasons: readonly string[] }): CrowdstrikeExtensionTokenUnreadError => ({
    code: "EXTENSION_TOKEN_UNREAD",
    message: reasons.join("\n"),
    reasons,
  }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): CrowdstrikeFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("\n"),
    reasons,
  }),
  fleetNotAList: ({ path }: { path: string }): CrowdstrikeFleetNotAListError => ({
    code: "FLEET_NOT_A_LIST",
    message: `${path} is not a list of devices, nor an object carrying a "devices" list`,
    path,
  }),
  fleetUnreadable: ({ path, cause }: { path: string; cause: string }): CrowdstrikeFleetUnreadableError => ({
    cause,
    code: "FLEET_UNREADABLE",
    message: `cannot read the fleet export at ${path}: ${cause}`,
    path,
  }),
  limitNotPositive: ({ got }: { got: string }): CrowdstrikeInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--limit",
    got,
    message: `--limit takes a positive whole number of routes, not ${got}`,
  }),
  originUnpaired: ({ apiHost }: { apiHost: string }): CrowdstrikeOriginUnpairedError => ({
    apiHost,
    code: "ORIGIN_UNPAIRED",
    message: `no Falcon console origin pairs with ${apiHost}`,
  }),
  sitemapAbsent: ({ path }: { path: string }): CrowdstrikeSitemapAbsentError => {
    const hint = "this usually means the browser session is signed out — open the Falcon console in Chrome and sign in";
    return { code: "SITEMAP_ABSENT", hint, message: `${sitemapAbsentLead({ path })}\n${hint}`, path };
  },
  sitemapInvalid: ({ reasons }: { reasons: readonly string[] }): CrowdstrikeSitemapInvalidError => ({
    code: "SITEMAP_INVALID",
    message: reasons.join("\n"),
    reasons,
  }),
  sitemapUnread: ({ cause }: { cause: string }): CrowdstrikeSitemapUnreadError => ({
    cause,
    code: "SITEMAP_UNREAD",
    message: `could not read the console's own sitemap: ${cause}`,
  }),
} as const;

/**
 * The lines one failure prints, one log record each, exactly as the verb printed them before it had a type:
 * a list another module produced as that list, a missing sitemap as what is missing then its hint, and
 * every other failure as its one message. `message` stays the joined form, for a caller that displays one.
 *
 * @returns the lines, in order
 */
export function crowdstrikeVerbErrorLines({ error }: { error: CrowdstrikeVerbError }): readonly string[] {
  if (
    error.code === "FLAGS_INVALID" ||
    error.code === "CREDENTIALS_UNRESOLVED" ||
    error.code === "EXTENSION_TOKEN_UNREAD" ||
    error.code === "SITEMAP_INVALID"
  ) {
    return error.reasons;
  }
  if (error.code === "SITEMAP_ABSENT") {
    return [sitemapAbsentLead({ path: error.path }), error.hint];
  }
  return [error.message];
}
