/**
 * The browser directory's typed failures outside its narrower domains — an evidence capture's result that cannot
 * be trusted, the owner's Playwright extension token, and the machine's one relay lease.
 *
 * Actions keep `BrowserActionError` (`./actionErrors.ts`), the page transport keeps `BrowserTransportError`
 * (`./pageTransport.ts`) and the local Chrome profile keeps `RealChromeError` (`./errors.ts`); this union
 * absorbs none of them. A list of problems — every evidence field that could not be trusted, a refusal and the
 * line saying what to do about it — rides as `reasons`, and `browserErrorLines` prints it one line each, as the
 * `readonly string[]` it replaced did.
 */

/** One field of an evidence-capture result that cannot be trusted; `at` is where it sat in the output. */
export interface BrowserEvidenceFieldInvalidError {
  readonly code: "EVIDENCE_FIELD_INVALID";
  readonly message: string;
  readonly at: string;
}

/** Every field of an evidence-capture result that could not be trusted, one per entry of `reasons`. */
export interface BrowserEvidenceRefusedError {
  readonly code: "EVIDENCE_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The Playwright extension token is readable by someone other than the owner, or holds nothing. */
export interface BrowserExtensionTokenRefusedError {
  readonly code: "EXTENSION_TOKEN_REFUSED";
  readonly message: string;
  readonly path: string;
  readonly problem: "not-owner-only" | "empty";
}

/** The Playwright extension token could not be read; `reasons` is why and who writes it. */
export interface BrowserExtensionTokenUnreadableError {
  readonly code: "EXTENSION_TOKEN_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
  readonly reasons: readonly string[];
}

/** A walk declared an origin a relay lease cannot bind to, or declared none. */
export interface BrowserRelayOriginInvalidError {
  readonly code: "RELAY_ORIGIN_INVALID";
  readonly message: string;
  readonly origin: string | undefined;
}

/** Another walk holds the relay lease; `reasons` is the refusal and when to retry. */
export interface BrowserRelayHeldError {
  readonly code: "RELAY_HELD";
  readonly message: string;
  readonly platform: string;
  readonly reasons: readonly string[];
}

/** This process already holds the relay lease, so waiting for it could only ever time out. */
export interface BrowserRelayHeldByThisProcessError {
  readonly code: "RELAY_HELD_BY_THIS_PROCESS";
  readonly message: string;
  readonly platform: string;
}

/** Every failure this union covers. */
export type BrowserError =
  | BrowserEvidenceFieldInvalidError
  | BrowserEvidenceRefusedError
  | BrowserExtensionTokenRefusedError
  | BrowserExtensionTokenUnreadableError
  | BrowserRelayOriginInvalidError
  | BrowserRelayHeldError
  | BrowserRelayHeldByThisProcessError;

/** One evidence field refusal. */
function fieldInvalid({ at, message }: { at: string; message: string }): BrowserEvidenceFieldInvalidError {
  return { at, code: "EVIDENCE_FIELD_INVALID", message };
}

/** A token refusal naming the file. */
function tokenRefused({
  path,
  problem,
  message,
}: {
  path: string;
  problem: BrowserExtensionTokenRefusedError["problem"];
  message: string;
}): BrowserExtensionTokenRefusedError {
  return { code: "EXTENSION_TOKEN_REFUSED", message, path, problem };
}

/** How to raise one, so the real code and a test build each the same way. */
export const BrowserErrors = {
  evidenceContextInvalid: ({ at, key }: { at: string; key: string }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at: `${at}.${key}`, message: `${at}.${key} is neither a context control nor null` }),
  evidenceContextRectMissing: ({ at, key }: { at: string; key: string }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at: `${at}.${key}.rect`, message: `${at}.${key}.rect is null on a present control` }),
  evidenceCountsInvalid: ({ at }: { at: string }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at, message: `${at} counts must be non-negative integers` }),
  evidenceNotANumber: ({ at, key }: { at: string; key: string }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at: `${at}.${key}`, message: `${at}.${key} is not a finite number` }),
  evidenceNotAnObject: ({ at }: { at: string }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at, message: `${at} is not an object` }),
  evidenceRectEmpty: ({
    at,
    key,
    width,
    height,
  }: {
    at: string;
    key: string;
    width: number;
    height: number;
  }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at: `${at}.${key}`, message: `${at}.${key} has no area (${String(width)}x${String(height)})` }),
  evidenceRectInvalid: ({ at, key }: { at: string; key: string }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at: `${at}.${key}`, message: `${at}.${key} is neither a rectangle nor null` }),
  evidenceRefused: ({ reasons }: { reasons: readonly string[] }): BrowserEvidenceRefusedError => ({
    code: "EVIDENCE_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  evidenceSummaryInvalid: ({ at }: { at: string }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at: `${at}.summary`, message: `${at}.summary is neither a summary nor null` }),
  evidenceSummaryRectMissing: ({ at }: { at: string }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at: `${at}.summary.rect`, message: `${at}.summary.rect is null on a present summary` }),
  evidenceVisibilityInvalid: ({
    at,
    key,
    value,
  }: {
    at: string;
    key: string;
    value: unknown;
  }): BrowserEvidenceFieldInvalidError =>
    fieldInvalid({ at: `${at}.${key}`, message: `${at}.${key} is '${String(value)}', not a visibility` }),
  extensionTokenEmpty: ({ path }: { path: string }): BrowserExtensionTokenRefusedError =>
    tokenRefused({ message: `the Playwright extension token is empty: ${path}`, path, problem: "empty" }),
  extensionTokenNotOwnerOnly: ({ path }: { path: string }): BrowserExtensionTokenRefusedError =>
    tokenRefused({
      message: `the Playwright extension token must be owner-only (mode 0600 or stricter): ${path}`,
      path,
      problem: "not-owner-only",
    }),
  extensionTokenUnreadable: ({
    path,
    detail,
  }: {
    path: string;
    detail: string;
  }): BrowserExtensionTokenUnreadableError => {
    const reasons = [
      `could not read the Playwright extension token at ${path}: ${detail}`,
      "the browser walk needs it; it is written once, by the owner, from the extension's own connect dialog",
    ];
    return { code: "EXTENSION_TOKEN_UNREADABLE", detail, message: reasons.join("; "), path, reasons };
  },
  relayHeld: ({ platform, detail }: { platform: string; detail: string }): BrowserRelayHeldError => {
    const reasons = [
      `another browser walk is driving the owner's Chrome, so the ${platform} walk may not start: ${detail}`,
      "the relay's shared context is one tab — run this walk again once the other one has finished",
    ];
    return { code: "RELAY_HELD", message: reasons.join("; "), platform, reasons };
  },
  relayHeldByThisProcess: ({ platform }: { platform: string }): BrowserRelayHeldByThisProcessError => ({
    code: "RELAY_HELD_BY_THIS_PROCESS",
    message:
      `this process already holds the owner's Chrome relay, so the ${platform} walk may not take it a second ` +
      "time — release the first transport before starting another",
    platform,
  }),
  relayWaitTimedOut: ({
    platform,
    detail,
    waitedSeconds,
  }: {
    platform: string;
    detail: string;
    waitedSeconds: number;
  }): BrowserRelayHeldError => {
    const reasons = [
      `another browser walk is driving the owner's Chrome, and the ${platform} walk waited ${String(waitedSeconds)}s for it without it coming free: ${detail}`,
      "the relay's shared context is one tab — run this walk again once the other one has finished",
    ];
    return { code: "RELAY_HELD", message: reasons.join("; "), platform, reasons };
  },
  relayOriginNotAbsolute: ({ origin }: { origin: string }): BrowserRelayOriginInvalidError => ({
    code: "RELAY_ORIGIN_INVALID",
    message: `"${origin}" is not an absolute URL, so it cannot bind a relay lease`,
    origin,
  }),
  relayOriginNotBare: ({
    origin,
    bareOrigin,
  }: {
    origin: string;
    bareOrigin: string;
  }): BrowserRelayOriginInvalidError => ({
    code: "RELAY_ORIGIN_INVALID",
    message: `"${origin}" is not a bare origin — a relay lease binds to an origin such as "${bareOrigin}", never to a path`,
    origin,
  }),
  relayOriginsEmpty: ({ platform }: { platform: string }): BrowserRelayOriginInvalidError => ({
    code: "RELAY_ORIGIN_INVALID",
    message: `the ${platform} walk declared no origin, so there is nothing a relay lease could bind it to`,
    origin: undefined,
  }),
} as const;

/**
 * The lines a {@link BrowserError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function browserErrorLines({ error }: { error: BrowserError }): readonly string[] {
  if (error.code === "EVIDENCE_REFUSED" || error.code === "EXTENSION_TOKEN_UNREADABLE" || error.code === "RELAY_HELD") {
    return error.reasons;
  }
  return [error.message];
}
