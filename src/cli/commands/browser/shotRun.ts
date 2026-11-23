/**
 * `slopweaver browser shot` — the effectful shell for the relay capture verb.
 *
 * Every decision is in `./shotCore.ts`. This file resolves the state home, borrows the atlas kit's own
 * attach (`atlas/kit/walkTransport.ts`, so the consent token, the profile pin and the machine-wide relay
 * lease are resolved exactly once in the tree), drives ONE visit, writes the bytes, and releases.
 *
 * ## The lease is the URL's own origin, and that is the whole grant
 *
 * A walk declares the origins its atlas may touch. This verb has no atlas, so it declares the single origin
 * of the address it was given: a page that redirects anywhere else returns `off-lease-origin` rather than a
 * picture, which is what stops a shot of a staging app coming back as a photograph of its identity
 * provider's sign-in form. Narrower than any walk's lease by construction — a shot cannot reach a second
 * address at any price, because it never makes a second visit.
 *
 * ## It holds the machine's one relay lease, so it queues behind a walk rather than corrupting one
 *
 * `browser/relayLease.ts` carries the measurement of four walks driving one tab at once. A shot
 * asked for while an atlas walk is running is refused with `relay-unavailable` naming the holder, which is
 * the honest answer and takes about a second — never a second client navigating the walk's own tab.
 *
 * ## This file is the RAW profile; the default lives next door
 *
 * The default `browser shot` waits for a closed target, crops to it
 * and annotates — `./shotEvidenceRun.ts`. What remains here is `--raw`: the flat-settle, whole-page
 * diagnostic shape, whose output is named as carrying no record.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import type { PageCapture } from "../../../browser/pageTransport.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  type BrowserShotOptions,
  classifyShotTarget,
  outcomeOf,
  renderShotReport,
  SHOT_LEASE_PLATFORM,
  type ShotReport,
} from "./shotCore.js";
import { takeEvidenceShot } from "./shotEvidenceRun.js";

/**
 * Write the bytes a capture came back with, and report what landed.
 *
 * The parent directory is created rather than required, because the caller of this verb is usually a
 * composer writing into a turn's own directory that does not exist yet — and failing on that would report a
 * capture problem for a filesystem one.
 *
 * @param capture what the page visit produced
 * @param out where the picture belongs
 * @returns the report to print
 */
function fileCapture({ capture, out }: { capture: PageCapture; out: string }): ShotReport {
  const described = {
    finalUrl: capture.finalUrl,
    statusCode: capture.statusCode,
    title: capture.title,
    url: capture.requestedUrl,
  };
  if (capture.screenshotPng === null) {
    return {
      ...described,
      because: "the page was reached and described, but the browser returned no picture for it",
      bytes: null,
      evidence: null,
      outcome: "reached-not-photographed",
      path: null,
    };
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, capture.screenshotPng);
  return {
    ...described,
    because: null,
    bytes: capture.screenshotPng.byteLength,
    evidence: null,
    outcome: "photographed",
    path: out,
  };
}

/**
 * Take one RAW picture through the relay: navigate, sleep, photograph the whole page.
 *
 * @param options the validated invocation
 * @param home the state home the consent token, the recorded profile and the relay lease live under
 * @param profiles the door the recorded work profile is read through, for the pin
 * @param settleMs how long to sleep after load
 * @returns the report to print
 */
async function takeRawShot({
  options,
  home,
  profiles,
  settleMs,
}: {
  options: BrowserShotOptions;
  home: string;
  profiles: RecordedProfilePort;
  settleMs: number;
}): Promise<ShotReport> {
  const nothing = {
    bytes: null,
    evidence: null,
    finalUrl: null,
    path: null,
    statusCode: null,
    title: null,
    url: options.url,
  };
  const directory = mkdtempSync(join(tmpdir(), "slopweaver-shot-"));
  try {
    const transport = await attachWalkTransport({
      directory,
      home,
      origins: [new URL(options.url).origin],
      platform: SHOT_LEASE_PLATFORM,
      profiles,
    });
    if (transport.isErr()) {
      return { ...nothing, because: transport.error.join("; "), outcome: "relay-unavailable" };
    }
    const visited = await transport.value.visit({ photograph: true, settleMs, url: options.url });
    await transport.value.release();
    if (visited.isErr()) {
      return { ...nothing, because: visited.error.message, outcome: outcomeOf({ error: visited.error }) };
    }
    return fileCapture({ capture: visited.value, out: options.out });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * The report for a shot whose `--out` a checkout could carry, or nothing when it may be written.
 *
 * Asked before anything is opened.
 *
 * @param options the validated invocation
 * @param home the state home, which is allowed
 * @param cwd the directory a relative `--out` resolves against
 * @param env the environment, read only for the hatch
 * @returns the refusal report, or undefined when the shot may proceed
 */
export function shotPlacementRefusal({
  options,
  home,
  cwd,
  env,
}: {
  options: BrowserShotOptions;
  home: string;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}): ShotReport | undefined {
  const placement = refuseProofOutputInTree({ cwd, env, home, output: options.out });
  if (placement.isOk()) {
    return undefined;
  }
  return {
    because: placement.error.join("\n  "),
    bytes: null,
    evidence: null,
    finalUrl: null,
    outcome: "output-in-checkout",
    path: null,
    statusCode: null,
    title: null,
    url: options.url,
  };
}

/**
 * Run `browser shot`.
 *
 * @param options the validated invocation
 * @param home the state home to drive against
 * @param profiles the door the recorded work profile is read through, for the pin
 * @returns the process exit code
 */
export async function runBrowserShot({
  options,
  home,
  profiles,
}: {
  options: BrowserShotOptions;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<number> {
  const allowed = classifyShotTarget({ url: options.url });
  if (allowed.isErr()) {
    const report: ShotReport = {
      because: allowed.error.message,
      bytes: null,
      evidence: null,
      finalUrl: null,
      outcome: "doored-provider",
      path: null,
      statusCode: null,
      title: null,
      url: options.url,
    };
    reportShot({ json: options.json, report });
    return EXIT_ERROR;
  }
  const misplaced = shotPlacementRefusal({ cwd: process.cwd(), env: process.env, home, options });
  if (misplaced !== undefined) {
    reportShot({ json: options.json, report: misplaced });
    return EXIT_ERROR;
  }
  const report =
    options.mode.kind === "raw"
      ? await takeRawShot({ home, options, profiles, settleMs: options.mode.settleMs })
      : await takeEvidenceShot({ home, mode: options.mode, options, profiles });
  reportShot({ json: options.json, report });
  return report.outcome === "photographed" || report.outcome === "captured" ? EXIT_OK : EXIT_ERROR;
}

/**
 * Print one report, as prose or as JSON.
 *
 * @param report what the attempt produced
 * @param json whether machine-readable output was asked for
 */
function reportShot({ report, json }: { report: ShotReport; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return;
  }
  for (const line of renderShotReport({ report })) {
    logger.out({ line });
  }
}
