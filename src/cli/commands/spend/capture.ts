/**
 * `slopweaver spend capture --url <card page> (--discover | --store --last4 <nnnn>)` — visit their Airwallex card
 * page in their own signed-in Chrome. `--discover` reports what the console's backend answered, as SHAPE: each
 * response's method, path and status, and its body's field paths with their types
 * (`../../../spend/captureShape.ts`), and writes nothing. `--store` maps the card's limits and transactions into
 * a snapshot under the home (`./captureStore.ts`), which `spend read` then reads.
 *
 * ## Why this is a read, by construction
 *
 * It rides the relay page transport every atlas walk rides (`../../../atlas/kit/walkTransport.ts`): the fixed
 * snippet navigates, settles and observes the first-party JSON the page itself fetched. No click, no typed
 * text, no request replay, no page script, and no header, cookie or storage crosses — so no Airwallex bearer
 * is lifted and nothing is sent that the page would not have sent on their own visit. It asks for no
 * screenshot: a card page can render card details, and a data read needs no picture. The relay lease binds
 * the visit to `https://www.airwallex.com`, and a page that settles elsewhere (a sign-in redirect) is a typed
 * refusal rather than an empty report. The read is a browser read, read-only, under
 * their session, never an API key, never a write.
 */
import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import type { BrowserPageTransport, BrowserTransportError, PageCapture } from "../../../browser/pageTransport.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { discoveryLines, responseShapeOf } from "../../../spend/captureShape.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { AIRWALLEX_ORIGIN, parseSpendCaptureArgs } from "./captureArgs.js";
import { storeLiveCapture } from "./captureStore.js";
import type { SpendDeps } from "./run.js";
import { SPEND_CAPTURE_USAGE } from "./usage.js";

/**
 * How long the page is observed after load. The card page is a single-page app that fetches its limits and
 * transactions after first paint, so the settle has to outlast those calls.
 */
const SETTLE_MS = 8_000;

/** Every `spend capture` flag NAME. */
export const SPEND_CAPTURE_FLAG_NAMES: readonly string[] = [
  "--discover",
  "--home",
  "--json",
  "--last4",
  "--store",
  "--url",
];

/** The effects `spend capture` adds to the noun's shared edges. */
export interface SpendCaptureDeps extends SpendDeps {
  /** Attach the relay transport for one visit, bound to the Airwallex origin. */
  readonly attach: (args: { home: string }) => Promise<Result<BrowserPageTransport>>;
  /** The IANA zone the card page prints its days in — their machine's own. */
  readonly timeZone: () => string;
}

/**
 * Run `spend capture` against injected edges.
 *
 * @param rest the argv tail after `spend capture`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSpendCapture({
  deps,
  rest,
}: {
  deps: SpendCaptureDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SPEND_CAPTURE_USAGE);
    return EXIT_OK;
  }
  const options = parseSpendCaptureArgs({ rest });
  if (options.isErr()) {
    deps.writeDiagnostic(options.error.message);
    deps.writeDiagnostic(SPEND_CAPTURE_USAGE);
    return EXIT_USAGE;
  }
  const { json, mode, url } = options.value;
  const home = captureHome({ deps, home: options.value.home });
  const transport = await deps.attach({ home });
  if (transport.isErr()) {
    for (const line of transport.error) {
      deps.writeDiagnostic(`spend capture: ${line}`);
    }
    return EXIT_ERROR;
  }
  const visited = await transport.value.visit({ photograph: false, settleMs: SETTLE_MS, url });
  await transport.value.release();
  if (visited.isErr()) {
    deps.writeDiagnostic(`spend capture: ${visitFailureLine({ error: visited.error })}`);
    return EXIT_ERROR;
  }
  const settled = settledElsewhere({ finalUrl: visited.value.finalUrl, requestedUrl: url });
  if (settled !== null) {
    deps.writeDiagnostic(`spend capture: ${settled}`);
    return EXIT_ERROR;
  }
  if (mode.kind === "store") {
    return storeLiveCapture({ capture: visited.value, deps, home, json, last4: mode.last4, timeZone: deps.timeZone() });
  }
  writeDiscoveryReport({ capture: visited.value, deps, json });
  return EXIT_OK;
}

/**
 * The home a capture resolves its relay token, pin and lease under.
 *
 * @param home the `--home` flag, when one was passed
 * @param deps the injected edges, for the default home
 * @returns the flag, or the default home when none was passed
 */
function captureHome({ deps, home }: { deps: SpendCaptureDeps; home: string | undefined }): string {
  if (home !== undefined) {
    return home;
  }
  return deps.defaultHome();
}

/**
 * Print one settled capture as the discovery report — shapes only, never a value.
 *
 * @param capture what the visit heard
 * @param deps the injected edges, for stdout
 * @param json print one machine-readable document instead of the lines
 */
function writeDiscoveryReport({
  capture,
  deps,
  json,
}: {
  capture: PageCapture;
  deps: SpendCaptureDeps;
  json: boolean;
}): void {
  const shapes = capture.responses.map((response) => responseShapeOf({ response }));
  const { bodyFailed, bodySucceeded, eligible, seen } = capture.responseAccounting;
  if (json) {
    deps.writeOut(
      safeJsonStringify({
        label: "spend capture",
        space: 2,
        value: {
          accounting: capture.responseAccounting,
          responses: shapes,
          settledOn: pathOnly({ url: capture.finalUrl }),
        },
      }),
    );
    return;
  }
  deps.writeOut(
    `spend capture --discover: settled on ${pathOnly({ url: capture.finalUrl })}; ${String(seen)} response(s) seen, ` +
      `${String(eligible)} JSON on ${AIRWALLEX_ORIGIN}, ${String(bodySucceeded)} read, ${String(bodyFailed)} unreadable`,
  );
  deps.writeOut(discoveryLines({ shapes }).join("\n"));
}

/**
 * A failed visit as one line that carries no address.
 *
 * The transport's own `message` interpolates the URL, query and all, and for a navigation failure a quoted
 * Playwright error besides; `pageTransport.ts` says a consumer prints `because` instead. So this prints the
 * code and that sentence, and for the other codes a sentence of its own.
 *
 * @param error the typed transport failure
 * @returns the diagnostic line
 */
export function visitFailureLine({ error }: { error: BrowserTransportError }): string {
  switch (error.code) {
    case "NAVIGATION_FAILED":
      return `${error.code} — ${error.because}`;
    case "OFF_LEASE_ORIGIN":
      return `${error.code} — the page left ${AIRWALLEX_ORIGIN}, so nothing it heard is kept`;
    case "SESSION_LOST":
      return `${error.code} — the browser relay dropped mid-visit; run it again`;
    case "TRANSPORT_UNAVAILABLE":
      return `${error.code} — their Chrome could not be reached through the browser relay`;
    default: {
      const unhandled: never = error;
      return String(unhandled);
    }
  }
}

/**
 * Why a visit that settled on a different page than the one asked for is not a capture of the card, or null
 * when it settled where it was sent.
 *
 * A signed-out Chrome is redirected to `/app/login`, which still answers JSON (sign-up configuration, the
 * manifest), so reporting it would read as "the card page's backend carries nothing". MEASURED on
 * the first run: 175 responses seen, five bodies read, none of them the card. Repro: `slopweaver spend capture
 * --url <card page> --discover` with Airwallex signed out of the work profile.
 *
 * @param requestedUrl the card page asked for
 * @param finalUrl where the browser settled
 * @returns the refusal line, or null
 */
export function settledElsewhere({
  requestedUrl,
  finalUrl,
}: {
  requestedUrl: string;
  finalUrl: string;
}): string | null {
  const settled = pathOnly({ url: finalUrl });
  if (settled === pathOnly({ url: requestedUrl })) {
    return null;
  }
  if (settled.includes("login")) {
    return (
      `the card page redirected to ${settled}: Airwallex is signed out in their work Chrome, so nothing was read. ` +
      "They sign in there once, then run this again"
    );
  }
  return `the card page settled on ${settled} instead of the page asked for, so nothing was read as the card`;
}

/**
 * A URL's path alone, so a report never carries its query.
 *
 * @param url an absolute URL
 * @returns its path, or `(unparseable)` when it is not one
 */
function pathOnly({ url }: { url: string }): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "(unparseable)";
  }
}

/**
 * The production relay attach, bound to the Airwallex origin and the capture scratch under the home.
 *
 * @param home the Slopweaver home the token, pin and lease resolve under
 * @param profiles the door the recorded work profile is read through
 * @returns the transport, or why their browser cannot be reached
 */
export async function attachAirwallexTransport({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<Result<BrowserPageTransport>> {
  return attachWalkTransport({
    directory: stateHomePaths({ home }).spendCapture,
    home,
    origins: [AIRWALLEX_ORIGIN],
    platform: "airwallex",
    profiles,
  });
}
