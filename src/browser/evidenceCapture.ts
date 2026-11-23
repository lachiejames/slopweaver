/**
 * The evidence-capture transport — one closed target, one relay lease, one whole-page PNG plus the
 * observations that say whether it is a picture of anything.
 *
 * ## A separate seam, not a widening of `BrowserPageTransport`
 *
 * Every atlas walk is written against `pageTransport.ts`'s two-method contract, and that contract's
 * no-click, no-script, no-page-text sentence is the walk's whole safety argument. This module widens
 * nothing there: it is the same shape `vantaPolicyEditor.ts` took for the Vanta arms — its own interface,
 * the same `relaySession.ts` plumbing underneath, the same lease and the same origin binding. An atlas
 * cannot reach a target observation, and a shot cannot reach a walk's response bodies.
 *
 * ## What comes back is validated field by field
 *
 * `evidenceParse.ts` reads the snippet's JSON with the same distrust `playwrightCli.ts`'s `captureFrom`
 * applies, and a result it cannot vouch for is a refusal here rather than an observation.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import type { EvidenceTarget } from "../visualEvidence/evidenceTarget.js";
import type { EvidenceCaptureResult } from "../visualEvidence/observation.js";

import { parseEvidenceCaptureResult } from "./evidenceParse.js";
import {
  type BrowserTransportError,
  BrowserTransportErrors,
  SNIPPET_REPORTED_FAILURE_BECAUSE,
} from "./pageTransport.js";
import { isOnLeaseOrigin, type RelayLease } from "./relayLease.js";
import { runHeldOperation } from "./relayRun.js";
import { openScratch, openSession, type PlaywrightCliDeps, readSnippetOutput, releaseSession } from "./relaySession.js";

/** What one capture attempt produced: the observations, and the PNG bytes when there are any. */
export interface EvidenceCapture {
  readonly result: EvidenceCaptureResult;
  readonly screenshotPng: Uint8Array | null;
}

/** Capture one target once, then let go. */
export interface BrowserEvidenceTransport {
  capture: (options: {
    url: string;
    target: EvidenceTarget;
    readinessTimeoutMs: number;
  }) => Promise<Result<EvidenceCapture, BrowserTransportError>>;
  release: () => Promise<Result<null, BrowserTransportError>>;
}

/**
 * Build the real evidence transport over the owner's Chrome.
 *
 * @param deps the consent token, the profile pin, the scratch directory, the clock, and the home,
 *   platform and origins the machine-wide relay lease is taken with
 * @returns a transport that captures one target per call
 */
export function createEvidenceCaptureTransport({ deps }: { deps: PlaywrightCliDeps }): BrowserEvidenceTransport {
  const scratch = openScratch();
  const session = openSession();
  return {
    capture: async ({ url, target, readinessTimeoutMs }) => {
      const screenshotPath = join(deps.scratchDir, `evidence-${String(Date.now())}.png`);
      try {
        const ran = await runHeldOperation({
          deps,
          operation: { kind: "page-evidence-capture", readinessTimeoutMs, screenshotPath, target, url },
          scratch,
          session,
        });
        if (ran.isErr()) {
          return err(ran.error);
        }
        return captureFromOutput({ lease: ran.value.lease, screenshotPath, stdout: ran.value.stdout, url });
      } finally {
        rmSync(screenshotPath, { force: true });
      }
    },
    release: async () => {
      releaseSession({ deps, scratch, session });
      return ok(null);
    },
  };
}

/**
 * Turn what the client printed into a capture, refusing anything it cannot vouch for.
 *
 * @param stdout everything the client printed
 * @param url the page that was asked for
 * @param screenshotPath the file the snippet was told to write
 * @param lease the relay lease whose origins bound where the page may settle
 * @returns the capture, or why there is none
 *
 * @internal
 */
export function captureFromOutput({
  stdout,
  url,
  screenshotPath,
  lease,
}: {
  stdout: string;
  url: string;
  screenshotPath: string;
  lease: RelayLease;
}): Result<EvidenceCapture, BrowserTransportError> {
  const output = readSnippetOutput({ stdout });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: `the evidence-capture snippet for ${url} printed nothing this could read, so its result never came back`,
      }),
    );
  }
  if (typeof output["failure"] === "string") {
    return err(
      BrowserTransportErrors.navigationFailed({
        because: SNIPPET_REPORTED_FAILURE_BECAUSE,
        reason: output["failure"],
        url,
      }),
    );
  }
  const finalUrl = typeof output["finalUrl"] === "string" ? output["finalUrl"] : url;
  if (!isOnLeaseOrigin({ lease, url: finalUrl })) {
    rmSync(screenshotPath, { force: true });
    return err(
      BrowserTransportErrors.offLeaseOrigin({
        reason: `the client sent this address somewhere the ${lease.platform} capture was not asked to go`,
        url: finalUrl,
      }),
    );
  }
  const parsed = parseEvidenceCaptureResult({ finalUrl, output });
  if (parsed.isErr()) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: `the evidence-capture snippet's result could not be trusted: ${parsed.error.message}`,
      }),
    );
  }
  let screenshotPng: Uint8Array | null = null;
  if (parsed.value.screenshotWritten) {
    try {
      screenshotPng = new Uint8Array(readFileSync(screenshotPath));
    } catch {
      screenshotPng = null;
    }
  }
  return ok({ result: parsed.value, screenshotPng });
}
