/**
 * What state Google Application Default Credentials are in on this machine, read so a seat can WAIT on the owner
 * signing in instead of running the sign-in itself.
 *
 * ## Why a seat never runs the sign-in
 *
 * `gcloud auth application-default login` opens a browser tab AND a localhost redirect listener in the shell that
 * ran it. A review seat that ran it from its own Bash tool and moved on left the owner to
 * find the tab later, sign in, and land the redirect on a broken page because nothing was listening any
 * more. So the listener belongs in THE OWNER'S terminal, carried there by a floating note, and
 * the seat waits on the one thing the owner's sign-in changes: the credential file, and whether Google accepts it.
 *
 * ## The classification is structural, and why
 *
 * Checked against google-auth-library 11.1.0 and gaxios 7.3.1 as installed:
 *
 * - **absent** — no credential anywhere in the chain: a plain `Error` whose message starts with
 *   {@link NO_ADC_FOUND_PREFIX} (`googleauth.js`'s `NO_ADC_FOUND`, not exported from the package index).
 * - **reauth** — the refresh token was refused: a `GaxiosError` whose `response.data.error` is `invalid_grant`.
 *   Workspace session control answers `error_subtype: invalid_rapt` (measured on this machine), and
 *   `oauth2client.js` then REWRITES the error's message to the JSON body, so the message is never what to match on.
 * - **failed** — anything else: a network error (a `GaxiosError` with no `response`), another HTTP status, an
 *   unreadable `GOOGLE_APPLICATION_CREDENTIALS` file, a non-Error throw. A sign-in fixes none of those.
 *
 * More than one copy of google-auth-library is installed (top level, and under `@googleapis/sheets`), so nothing
 * here uses `instanceof`: the shape is read, never the class.
 *
 * Pure: no SDK import, no filesystem. `adcProbe.ts` is the edge that performs the read.
 *
 * ## Why this is not under `src/live/google/`
 *
 * That tree is the Workspace doors' shared OAuth — Gmail, Drive, Calendar — whose rail forbids constructing a
 * `GoogleAuth` at all (`unit/live/google/actsOnlyAsTheBoundAccount.test.ts`), because those doors hold the owner's own
 * refresh token and nothing else. The application default is a different credential, gcloud's, read here only to
 * learn whether Google accepts it: no subject, no scope a door holds, no data read. So it sits outside the doors.
 */
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

/** The stable head of google-auth-library's no-credential message (`GoogleAuthExceptionMessages.NO_ADC_FOUND`). */
const NO_ADC_FOUND_PREFIX = "Could not load the default credentials";

/** The file `gcloud auth application-default login` writes, under the gcloud config directory. */
const ADC_FILE_NAME = "application_default_credentials.json";

/** The one command that mints the credential — run in THE OWNER'S terminal, never a seat's. */
export const ADC_SIGNIN_COMMAND = "gcloud auth application-default login";

/** How long a detail carried out of a provider error may be, so one error body cannot fill a screen. */
const DETAIL_CAP = 200;

/** What one read found: a working credential, none, one Google refused, or a failure a sign-in cannot fix. */
export type AdcState = "valid" | "absent" | "reauth" | "failed";

/**
 * Which file the SDK's chain resolves to. `env` is `GOOGLE_APPLICATION_CREDENTIALS`, which a gcloud sign-in never
 * rewrites; `well-known` is the gcloud config directory's file, which it does.
 */
export interface AdcSource {
  readonly kind: "env" | "well-known";
  readonly path: string;
}

/** One read of the credential. `detail` never carries a token. */
export interface AdcReading {
  readonly state: AdcState;
  readonly source: AdcSource;
  readonly detail: string;
  /** Google's `error_subtype` on a refused refresh — `invalid_rapt` is session control. */
  readonly subtype?: string;
}

/** What a wait remembers between reads, so an unchanged file is not re-probed over the network every step. */
export interface AdcProbeMemo {
  /** The credential file's `mtimeMs:size`, or `missing`. */
  readonly fingerprint: string;
  readonly probedAtMs: number;
  readonly reading: AdcReading;
}

/** The classification of a failed token read — everything {@link AdcReading} has except where it came from. */
export interface AdcFailure {
  readonly state: Exclude<AdcState, "valid">;
  readonly detail: string;
  readonly subtype?: string;
}

/**
 * A non-empty, trimmed environment value, or `undefined`.
 *
 * @param value the raw variable
 * @returns the trimmed value when it carries anything
 */
function present({ value }: { value: string | undefined }): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

/**
 * Cut a provider string to {@link DETAIL_CAP} characters.
 *
 * @param text the string to cut
 * @returns the string, ending in an ellipsis when it was cut
 */
function capped({ text }: { text: string }): string {
  return text.length <= DETAIL_CAP ? text : `${text.slice(0, DETAIL_CAP - 1)}…`;
}

/**
 * The file the SDK's chain resolves to, mirroring `googleauth.js`'s order for REPORTING only — the SDK stays
 * the authority on whether the credential works.
 *
 * @param env the environment the seat runs in (`GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_CONFIG`, `HOME`)
 * @returns the source, or a refusal when no home directory is set to find the gcloud file under
 */
export function adcSource({ env }: { env: Readonly<Record<string, string | undefined>> }): Result<AdcSource> {
  const explicit = present({ value: env["GOOGLE_APPLICATION_CREDENTIALS"] });
  if (explicit !== undefined) {
    return ok({ kind: "env", path: explicit });
  }
  const config = present({ value: env["CLOUDSDK_CONFIG"] });
  if (config !== undefined) {
    return ok({ kind: "well-known", path: join(config, ADC_FILE_NAME) });
  }
  const userHome = present({ value: env["HOME"] });
  if (userHome === undefined) {
    return err(["HOME is not set, so the gcloud credential file has no directory to be found in"]);
  }
  return ok({ kind: "well-known", path: join(userHome, ".config", "gcloud", ADC_FILE_NAME) });
}

/**
 * The `response.data` of a refused token refresh, read by shape.
 *
 * @param error whatever the token read threw
 * @returns the response body when there is one that is an object
 */
function responseData({ error }: { error: unknown }): Record<string, unknown> | undefined {
  if (!isRecord(error) || !isRecord(error["response"])) {
    return undefined;
  }
  const data = error["response"]["data"];
  return isRecord(data) ? data : undefined;
}

/**
 * Classify what a token read threw.
 *
 * @param error the thrown value, of any shape
 * @returns absent, reauth (with Google's subtype when it named one) or failed, each with a short detail
 */
export function classifyAdcFailure({ error }: { error: unknown }): AdcFailure {
  const data = responseData({ error });
  if (data?.["error"] === "invalid_grant") {
    const description = data["error_description"];
    const subtype = data["error_subtype"];
    const detail = capped({ text: typeof description === "string" ? description : "invalid_grant" });
    return typeof subtype === "string" ? { detail, state: "reauth", subtype } : { detail, state: "reauth" };
  }
  if (!(error instanceof Error)) {
    return { detail: "the token read threw something that is not an Error", state: "failed" };
  }
  if (error.message.startsWith(NO_ADC_FOUND_PREFIX)) {
    return { detail: "no application default credential is on this machine", state: "absent" };
  }
  const code = isRecord(error) ? error["code"] : undefined;
  const coded = typeof code === "string" || typeof code === "number" ? ` (${String(code)})` : "";
  return { detail: capped({ text: `${error.message}${coded}` }), state: "failed" };
}

/**
 * Whether the owner running {@link ADC_SIGNIN_COMMAND} would change this reading. Only a missing or refused credential
 * read from the gcloud file is the owner's to fix: an explicit `GOOGLE_APPLICATION_CREDENTIALS` file is never rewritten
 * by a sign-in, and a network or HTTP failure is not a credential problem at all.
 *
 * @param reading the read to judge
 * @returns true when a sign-in is the fix
 */
export function signInFixes({ reading }: { reading: AdcReading }): boolean {
  return reading.source.kind === "well-known" && (reading.state === "absent" || reading.state === "reauth");
}

/**
 * Whether a wait should spend a network read now, or answer from the last one.
 *
 * A sign-in rewrites the file, so a changed fingerprint is read at once; an unchanged one is re-probed no more
 * than once a `minIntervalMs`, because a credential can also start working without the file changing (a revoked
 * session restored by an admin) and that is the only way to see it.
 *
 * @param memo the last probe, or undefined before the first
 * @param fingerprint the credential file's fingerprint now
 * @param nowMs the current time
 * @param minIntervalMs the least time between two probes of an unchanged file
 * @returns true when the wait must probe
 */
export function shouldProbe({
  memo,
  fingerprint,
  nowMs,
  minIntervalMs,
}: {
  memo: AdcProbeMemo | undefined;
  fingerprint: string;
  nowMs: number;
  minIntervalMs: number;
}): boolean {
  if (memo === undefined || memo.fingerprint !== fingerprint) {
    return true;
  }
  return nowMs - memo.probedAtMs >= minIntervalMs;
}

/**
 * The one line a reading prints.
 *
 * @param reading the read to render
 * @returns `google adc: <state>[ (<subtype>)] — <detail> [<source path>]`
 */
export function readingLine({ reading }: { reading: AdcReading }): string {
  const subtype = reading.subtype === undefined ? "" : ` (${reading.subtype})`;
  return `google adc: ${reading.state}${subtype} — ${reading.detail} [${reading.source.path}]`;
}
