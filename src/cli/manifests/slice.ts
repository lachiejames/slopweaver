/**
 * Lazy manifest for the `slice` noun — capture a pinned subset of a source, and verify nothing was lost.
 *
 * Two verbs, and the split is the trust model rather than convenience. `capture` WRITES a manifest under
 * `$SLOPWEAVER_HOME/slices`; `verify` writes nothing at all and only reads, so it can be run by anyone, at
 * any time, including in CI, without a thought about what it might change.
 *
 * Neither writes bronze. `refresh` remains the only writer, so `verify` proves that an unchanged re-ingest
 * WOULD write nothing rather than proving it by writing.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

/** Meta shared by the bare noun and `verify` — the read-only half, and the default because it is safe. */
const verifyMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver slice verify --name self-daily",
  parseRejectIsIoFree: true,
  summary:
    "Check a pinned slice end to end and exit non-zero if anything was lost without saying so (read-only, no tokens)",
  usage: "usage: slopweaver slice verify --name <slice> [--check] [--json] [--home <dir>]",
} as const;

/** Meta for `capture` — the half that writes, and only ever to its own manifest under the state home. */
const captureMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver slice capture --name self-daily --root /dev/notes --sentinel 'SENTINEL-ONE::what did we decide'",
  parseRejectIsIoFree: true,
  summary: "Pin a named subset of a source — its content digest, its declines and its sentinels",
  usage:
    "usage: slopweaver slice capture --name <slice> --root <dir>... [--sentinel '<text>::<query>']... [--home <dir>]",
} as const;

/** Lazy loader for the read-only verify handler. */
const loadVerify = () => import("../commands/slice/verify.js").then((m) => m.sliceVerifyCommand);

/** Lazy loader for the capture handler. */
const loadCapture = () => import("../commands/slice/capture.js").then((m) => m.sliceCaptureCommand);

/** The `slice` noun's verbs. The bare noun verifies, because the safe half should be the one you get by default. */
export const sliceManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadVerify, meta: verifyMeta }),
  capture: lazy({ load: loadCapture, meta: captureMeta }),
  verify: lazy({ load: loadVerify, meta: verifyMeta }),
};
