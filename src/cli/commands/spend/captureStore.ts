/**
 * `spend capture --store --last4 <nnnn>` — one settled capture of their card page, calibrated against the snapshot
 * already stored for that card and written beside it (`../../../spend/liveCapture.ts` carries the calibration).
 *
 * What it prints is a count and a path, never a value off the page: `spend read` is where the card is read.
 */
import type { PageCapture } from "../../../browser/pageTransport.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { snapshotFromCapture } from "../../../spend/liveCapture.js";
import { readLatestSnapshots, writeCardSnapshot } from "../../../spend/store.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { SpendDeps } from "./run.js";

/**
 * Store one settled capture as the card's newest snapshot.
 *
 * @param capture what the visit heard
 * @param home the Slopweaver home the card's snapshots live under
 * @param last4 the card's last four digits, as the operator read them
 * @param timeZone the IANA zone the page prints days in
 * @param deps the injected edges, for the streams
 * @param json print the stored path and counts as one JSON document
 * @returns the process exit code
 */
export function storeLiveCapture({
  capture,
  deps,
  home,
  json,
  last4,
  timeZone,
}: {
  capture: PageCapture;
  deps: SpendDeps;
  home: string;
  json: boolean;
  last4: string;
  timeZone: string;
}): number {
  const stored = readLatestSnapshots({ home, last4 });
  if (stored.isErr()) {
    deps.writeDiagnostic(
      `spend capture --store: ${stored.error.message} — a live read calibrates against a stored snapshot, so ` +
        "`spend import` a pasted page of the card once first",
    );
    return EXIT_ERROR;
  }
  const calibration = stored.value[0];
  if (calibration === undefined) {
    deps.writeDiagnostic(`spend capture --store: card ${last4} has no stored snapshot to calibrate against`);
    return EXIT_ERROR;
  }
  const live = snapshotFromCapture({
    calibration,
    capturedAt: capture.observedAt,
    responses: capture.responses,
    timeZone,
  });
  if (live.isErr()) {
    deps.writeDiagnostic(`spend capture --store: ${live.error.message}`);
    return EXIT_ERROR;
  }
  const { rowsOnCard, rowsRead, snapshot } = live.value;
  const written = writeCardSnapshot({ home, snapshot });
  if (written.isErr()) {
    deps.writeDiagnostic(`spend capture --store: ${written.error.message}`);
    return EXIT_ERROR;
  }
  if (json) {
    deps.writeOut(
      safeJsonStringify({
        label: "spend capture --store",
        space: 2,
        value: { asOf: snapshot.asOf, path: written.value, rowsOnCard, rowsRead },
      }),
    );
    return EXIT_OK;
  }
  deps.writeOut(
    `spend capture --store: card ${last4} as of ${snapshot.asOf} — ${String(rowsRead)} row(s) read of ` +
      `${String(rowsOnCard)} the card holds → ${written.value}. \`slopweaver spend read --card ${last4}\` reads it`,
  );
  return EXIT_OK;
}
