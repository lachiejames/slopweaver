/**
 * The monitor backtest transport — one Datadog monitor edit page, one relay lease, the marked panel's PNG
 * plus what the page said about it.
 *
 * A sibling of `evidenceCapture.ts` rather than a use of it, for the reason `datadogMonitorBacktestSnippet.ts`
 * gives: that arm's classification rests on clicking nothing, and this one has to move the backtest's time
 * picker. What it shares is everything underneath — `relaySession.ts`'s lease, origin binding, profile pin
 * and owned-tab cleanup, and the rule that a caller names a declared OPERATION, never code.
 *
 * Everything that DECIDES is elsewhere and pure: {@link monitorBacktestFromOutput} here turns the snippet's
 * JSON into a typed observation field by field, and `datadog/shot/monitorShot.ts` judges that observation.
 * This module only runs the operation and reads one file.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { CssRect } from "../visualEvidence/observation.js";

import {
  type BrowserTransportError,
  BrowserTransportErrors,
  SNIPPET_REPORTED_FAILURE_BECAUSE,
} from "./pageTransport.js";
import { isOnLeaseOrigin, type RelayLease } from "./relayLease.js";
import { runHeldOperation } from "./relayRun.js";
import { openScratch, openSession, type PlaywrightCliDeps, readSnippetOutput, releaseSession } from "./relaySession.js";

/**
 * How the wait for a settled panel ended. Only `ready` is ever photographed.
 * @internal a field type of {@link MonitorBacktestObservation}
 */
export type BacktestReadiness = "ready" | "timeout" | "unsupported" | "no-picker" | "window-unset";

const READINESS_VALUES: readonly BacktestReadiness[] = ["ready", "timeout", "unsupported", "no-picker", "window-unset"];

/**
 * The last marking pass, as the page reported it — the Node-side mirror of `panelScript.ts`'s result.
 * @internal a field type of {@link MonitorBacktestObservation}
 */
export interface BacktestPanelRead {
  readonly panelText: string | null;
  readonly marked: boolean;
  readonly alertBoxed: boolean;
  readonly pickerValue: string | null;
  readonly unmet: readonly string[];
}

/**
 * Where the marked region sat when the shutter fired: its viewport rectangle and the frame's size and paint
 * scale, which is what the crop is computed from.
 * @internal a field type of {@link MonitorBacktestObservation}
 */
export interface BacktestPanelFrame {
  readonly rect: CssRect;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
}

/** What one backtest capture saw, and the VIEWPORT PNG when the panel settled and was photographed. */
export interface MonitorBacktestObservation {
  readonly finalUrl: string;
  /** The region's geometry read just before the shutter, or `null` when it could not be read. */
  readonly frame: BacktestPanelFrame | null;
  /** The same, read just after; a capture whose two readings differ photographed a page that moved. */
  readonly frameAfter: BacktestPanelFrame | null;
  /** The page's title, or `null` when the snippet did not report one. */
  readonly title: string | null;
  readonly readiness: BacktestReadiness;
  /** The last marking pass, or `null` when the wait ended before one ran. */
  readonly reading: BacktestPanelRead | null;
  /** Every evaluation-preview call the page made over the chosen window, on the lease's origins only. */
  readonly previewUrls: readonly string[];
  /** Why the picker could not be put on the window, or `null`. */
  readonly windowError: string | null;
  readonly screenshotError: string | null;
  readonly polls: number;
  readonly elapsedMs: number;
  readonly png: Uint8Array | null;
}

/**
 * Capture one monitor's backtest panel once, then let go of the relay.
 *
 * The lease is WAITED for, as `evidenceCapture.ts` waits: a capture is one page, and another run holding the
 * relay for a minute is not a reason to fail it.
 *
 * @param deps the consent token, the profile pin, the scratch directory, the clock, and the home, platform
 *   and origins the machine-wide relay lease is taken with
 * @param url the monitor's edit page
 * @param readinessTimeoutMs how long the picker and the panel may take once the page has loaded
 * @returns the observation, or why the owner's browser produced none
 */
export async function captureMonitorBacktest({
  deps,
  url,
  readinessTimeoutMs,
}: {
  deps: PlaywrightCliDeps;
  url: string;
  readinessTimeoutMs: number;
}): Promise<Result<MonitorBacktestObservation, BrowserTransportError>> {
  const scratch = openScratch();
  const session = openSession();
  const screenshotPath = join(deps.scratchDir, `monitor-backtest-${String(Date.now())}.png`);
  try {
    const ran = await runHeldOperation({
      deps,
      operation: { kind: "datadog-monitor-backtest", readinessTimeoutMs, screenshotPath, url },
      scratch,
      session,
    });
    if (ran.isErr()) {
      return err(ran.error);
    }
    const observed = monitorBacktestFromOutput({ lease: ran.value.lease, stdout: ran.value.stdout, url });
    if (observed.isErr()) {
      return err(observed.error);
    }
    return ok({
      ...observed.value.observation,
      png: observed.value.screenshotWritten ? readPng({ screenshotPath }) : null,
    });
  } finally {
    rmSync(screenshotPath, { force: true });
    releaseSession({ deps, scratch, session });
  }
}

/** The PNG the snippet wrote, or `null` when it is not there to read. */
function readPng({ screenshotPath }: { screenshotPath: string }): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(screenshotPath));
  } catch {
    return null;
  }
}

/** A string field, or `null`. */
function stringOrNull({ value }: { value: unknown }): string | null {
  return typeof value === "string" ? value : null;
}

/** A non-negative count, or zero. */
function countOf({ value }: { value: unknown }): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** The snippet's `reading`, field by field, or `null` when it is absent or not a record. */
function panelReadOf({ value }: { value: unknown }): BacktestPanelRead | null {
  if (!isRecord(value)) {
    return null;
  }
  const unmet = value["unmet"];
  return {
    alertBoxed: value["alertBoxed"] === true,
    marked: value["marked"] === true,
    panelText: stringOrNull({ value: value["panelText"] }),
    pickerValue: stringOrNull({ value: value["pickerValue"] }),
    unmet: Array.isArray(unmet) ? unmet.filter((entry): entry is string => typeof entry === "string") : [],
  };
}

/** A finite number, or `null`. */
function finiteOrNull({ value }: { value: unknown }): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The snippet's region geometry, refused as a whole (`null`) when any one field is not a finite number. */
function panelFrameOf({ value }: { value: unknown }): BacktestPanelFrame | null {
  if (!isRecord(value) || !isRecord(value["rect"])) {
    return null;
  }
  const rect = value["rect"];
  const fields = {
    devicePixelRatio: finiteOrNull({ value: value["devicePixelRatio"] }),
    height: finiteOrNull({ value: rect["height"] }),
    viewportHeight: finiteOrNull({ value: value["viewportHeight"] }),
    viewportWidth: finiteOrNull({ value: value["viewportWidth"] }),
    width: finiteOrNull({ value: rect["width"] }),
    x: finiteOrNull({ value: rect["x"] }),
    y: finiteOrNull({ value: rect["y"] }),
  };
  const { devicePixelRatio, height, viewportHeight, viewportWidth, width, x, y } = fields;
  if (
    devicePixelRatio === null ||
    height === null ||
    viewportHeight === null ||
    viewportWidth === null ||
    width === null ||
    x === null ||
    y === null
  ) {
    return null;
  }
  return { devicePixelRatio, rect: { height, width, x, y }, viewportHeight, viewportWidth };
}

/** The preview URLs that came back with a status, on the lease's own origins. */
function previewUrlsOf({ value, lease }: { value: unknown; lease: RelayLease }): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => entry["url"])
    .filter((entry): entry is string => typeof entry === "string" && isOnLeaseOrigin({ lease, url: entry }));
}

/** The readiness the snippet reported, or `null` when it is not one this module declares. */
function readinessOf({ value }: { value: unknown }): BacktestReadiness | null {
  const declared = READINESS_VALUES.find((candidate) => candidate === value);
  if (declared === undefined) {
    return null;
  }
  return declared;
}

/**
 * Where the page settled, refused when the snippet did not say or when it is off the lease — which on Datadog
 * is the identity provider's sign-in wall.
 */
function settledUrlOf({
  value,
  url,
  lease,
}: {
  value: unknown;
  url: string;
  lease: RelayLease;
}): Result<string, BrowserTransportError> {
  const finalUrl = stringOrNull({ value });
  if (finalUrl === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: `the monitor backtest snippet for ${url} did not say where the page settled, so where it photographed is unknown`,
      }),
    );
  }
  if (!isOnLeaseOrigin({ lease, url: finalUrl })) {
    return err(
      BrowserTransportErrors.offLeaseOrigin({
        reason: "the monitor page settled outside the Datadog console, which is where its sign-in wall lives",
        url: finalUrl,
      }),
    );
  }
  return ok(finalUrl);
}

/**
 * Turn what the client printed into an observation, refusing anything this module cannot vouch for.
 *
 * Pure, so every refusal is a unit test: no output, a navigation failure the snippet reported itself, a
 * readiness it does not declare, and a page that SETTLED off the lease — which on Datadog is the identity
 * provider's sign-in wall, and is refused rather than photographed.
 *
 * @param stdout everything the client printed
 * @param url the page that was asked for
 * @param lease the relay lease whose origins bound where the page may settle and which previews are kept
 * @returns the observation without its PNG, and whether the snippet says it wrote one
 *
 * @internal
 */
export function monitorBacktestFromOutput({
  stdout,
  url,
  lease,
}: {
  stdout: string;
  url: string;
  lease: RelayLease;
}): Result<
  { readonly observation: Omit<MonitorBacktestObservation, "png">; readonly screenshotWritten: boolean },
  BrowserTransportError
> {
  const output = readSnippetOutput({ stdout });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: `the monitor backtest snippet for ${url} printed nothing this could read, so its result never came back`,
      }),
    );
  }
  const failure = output["failure"];
  if (typeof failure === "string") {
    return err(
      BrowserTransportErrors.navigationFailed({ because: SNIPPET_REPORTED_FAILURE_BECAUSE, reason: failure, url }),
    );
  }
  const settled = settledUrlOf({ lease, url, value: output["finalUrl"] });
  if (settled.isErr()) {
    return err(settled.error);
  }
  const finalUrl = settled.value;
  const readiness = readinessOf({ value: output["readiness"] });
  if (readiness === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: `the monitor backtest snippet reported a readiness this module does not declare: ${JSON.stringify(output["readiness"])}`,
      }),
    );
  }
  return ok({
    observation: {
      elapsedMs: countOf({ value: output["elapsedMs"] }),
      finalUrl,
      frame: panelFrameOf({ value: output["frame"] }),
      frameAfter: panelFrameOf({ value: output["frameAfter"] }),
      polls: countOf({ value: output["polls"] }),
      previewUrls: previewUrlsOf({ lease, value: output["previews"] }),
      readiness,
      reading: panelReadOf({ value: output["reading"] }),
      screenshotError: stringOrNull({ value: output["screenshotError"] }),
      title: stringOrNull({ value: output["title"] }),
      windowError: stringOrNull({ value: output["windowError"] }),
    },
    screenshotWritten: output["screenshotWritten"] === true,
  });
}
