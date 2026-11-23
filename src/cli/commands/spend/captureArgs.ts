/**
 * `spend capture`'s argv, and the typed ways it is refused before anything opens.
 *
 * The URL is checked here, before the relay is attached, so a page off their Airwallex console never reaches their
 * browser at all. No refusal echoes the URL it was given: a card page's address carries card and account ids.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, parseFlagTail } from "../../optionParsers.js";

/** The one origin a capture may address — their Airwallex web console. */
export const AIRWALLEX_ORIGIN = "https://www.airwallex.com";

/** `spend capture`'s flags. */
const SPEND_CAPTURE_FLAGS = { boolean: ["discover", "json", "store"], value: ["home", "last4", "url"] } as const;

/** What a capture does with the page once it settles: report its shape, or store the card as a snapshot. */
type CaptureMode = { readonly kind: "discover" } | { readonly kind: "store"; readonly last4: string };

/** A parsed `spend capture` invocation. */
interface SpendCaptureOptions {
  readonly url: string;
  readonly mode: CaptureMode;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A flag the parser refused — unknown, repeated, or missing its value. */
interface CaptureFlagsInvalidError {
  readonly code: "CAPTURE_FLAGS_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** No `--url` was given. */
interface CaptureUrlMissingError {
  readonly code: "CAPTURE_URL_MISSING";
  readonly message: string;
}

/** `--url` is not an absolute URL. */
interface CaptureUrlNotAbsoluteError {
  readonly code: "CAPTURE_URL_NOT_ABSOLUTE";
  readonly message: string;
}

/** `--url` is on another origin than their Airwallex console. */
interface CaptureUrlOffOriginError {
  readonly code: "CAPTURE_URL_OFF_ORIGIN";
  readonly message: string;
  readonly origin: string;
}

/** Neither `--discover` nor `--store`, or both, was passed — a capture does exactly one. */
interface CaptureModeInvalidError {
  readonly code: "CAPTURE_MODE_INVALID";
  readonly message: string;
}

/** `--store` without a four-digit `--last4`, or `--last4` without `--store`. */
interface CaptureLast4InvalidError {
  readonly code: "CAPTURE_LAST4_INVALID";
  readonly message: string;
}

/** Every way `spend capture`'s argv is refused. */
type SpendCaptureArgsError =
  | CaptureFlagsInvalidError
  | CaptureUrlMissingError
  | CaptureUrlNotAbsoluteError
  | CaptureUrlOffOriginError
  | CaptureModeInvalidError
  | CaptureLast4InvalidError;

/**
 * A flag parser's message with every argument VALUE the caller passed replaced by `<argument>`.
 *
 * The parser quotes a stray positional whole (`unexpected argument: <it>`), and the stray positional is most
 * often the card page itself, passed without `--url` — card and account ids in its path and query. A value is
 * a token that is not a flag, or what follows `=` in one; the longest is masked first, so a value that
 * contains another is never half-masked.
 *
 * @param problem one line the flag parser produced
 * @param rest the argv tail the parser was given
 * @returns the line with no value from `rest` left in it
 */
function maskArgumentValues({ problem, rest }: { problem: string; rest: readonly string[] }): string {
  const values = rest
    .flatMap((token) => {
      if (!token.startsWith("-")) {
        return [token];
      }
      const equals = token.indexOf("=");
      if (equals === -1) {
        return [];
      }
      return [token.slice(equals + 1)];
    })
    .filter((value) => value.length > 0)
    .toSorted((left, right) => right.length - left.length);
  let masked = problem;
  for (const value of values) {
    masked = masked.split(value).join("<argument>");
  }
  return masked;
}

/** Build one typed `spend capture` argv refusal. */
const SpendCaptureArgsErrors = {
  flagsInvalid: ({
    problems,
    rest,
  }: {
    problems: readonly string[];
    rest: readonly string[];
  }): CaptureFlagsInvalidError => {
    const masked = problems.map((problem) => maskArgumentValues({ problem, rest }));
    return { code: "CAPTURE_FLAGS_INVALID", message: masked.join("\n"), problems: masked };
  },
  last4Invalid: (): CaptureLast4InvalidError => ({
    code: "CAPTURE_LAST4_INVALID",
    message:
      "--store needs --last4 <nnnn>, the card's last four digits as they read them, and --last4 means nothing without --store",
  }),
  modeInvalid: (): CaptureModeInvalidError => ({
    code: "CAPTURE_MODE_INVALID",
    message:
      "pass exactly one of --discover (the backend's shape, stores nothing) or --store --last4 <nnnn> (the card)",
  }),
  urlMissing: (): CaptureUrlMissingError => ({
    code: "CAPTURE_URL_MISSING",
    message: "--url <card page> is required — the Airwallex cardholder page for the card, as they open it",
  }),
  urlNotAbsolute: (): CaptureUrlNotAbsoluteError => ({
    code: "CAPTURE_URL_NOT_ABSOLUTE",
    message: `--url must be an absolute ${AIRWALLEX_ORIGIN} address`,
  }),
  urlOffOrigin: ({ origin }: { origin: string }): CaptureUrlOffOriginError => ({
    code: "CAPTURE_URL_OFF_ORIGIN",
    message: `--url must be on ${AIRWALLEX_ORIGIN} — the only origin a capture may address, got ${origin}`,
    origin,
  }),
} as const;

/**
 * Parse `spend capture`'s argv tail.
 *
 * @param rest the argv after the verb
 * @returns the resolved options, or the typed refusal
 */
export function parseSpendCaptureArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<SpendCaptureOptions, SpendCaptureArgsError> {
  const parsed = parseFlagTail({ rest, spec: SPEND_CAPTURE_FLAGS });
  if (parsed.isErr()) {
    return err(SpendCaptureArgsErrors.flagsInvalid({ problems: parsed.error, rest }));
  }
  const url = flagValue({ name: "url", parsed: parsed.value });
  if (url === null) {
    return err(SpendCaptureArgsErrors.urlMissing());
  }
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return err(SpendCaptureArgsErrors.urlNotAbsolute());
  }
  if (origin !== AIRWALLEX_ORIGIN) {
    return err(SpendCaptureArgsErrors.urlOffOrigin({ origin }));
  }
  const mode = modeOf({
    discover: parsed.value.flags.has("discover"),
    last4: flagValue({ name: "last4", parsed: parsed.value }),
    store: parsed.value.flags.has("store"),
  });
  if (mode.isErr()) {
    return err(mode.error);
  }
  let home: string | undefined;
  const homeFlag = flagValue({ name: "home", parsed: parsed.value });
  if (homeFlag !== null) {
    home = homeFlag;
  }
  return ok({ home, json: parsed.value.flags.has("json"), mode: mode.value, url });
}

/**
 * The one thing a capture does, from its switches.
 *
 * @param discover whether `--discover` was passed
 * @param store whether `--store` was passed
 * @param last4 the `--last4` value, or null when absent
 * @returns the mode, or the typed refusal
 */
function modeOf({
  discover,
  last4,
  store,
}: {
  discover: boolean;
  last4: string | null;
  store: boolean;
}): Result<CaptureMode, SpendCaptureArgsError> {
  if (discover === store) {
    return err(SpendCaptureArgsErrors.modeInvalid());
  }
  if (discover) {
    if (last4 !== null) {
      return err(SpendCaptureArgsErrors.last4Invalid());
    }
    return ok({ kind: "discover" });
  }
  if (last4 === null || !/^\d{4}$/.test(last4)) {
    return err(SpendCaptureArgsErrors.last4Invalid());
  }
  return ok({ kind: "store", last4 });
}
