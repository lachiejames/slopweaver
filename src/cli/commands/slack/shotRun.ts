/**
 * `slopweaver slack shot` — the effectful shell for the Slack render-capture verb.
 *
 * Every decision is in `./shotCore.ts`. This file resolves the state home, borrows the atlas kit's own
 * attach (`atlas/kit/walkTransport.ts`, so the consent token, the profile pin and the machine-wide relay
 * lease are resolved exactly once in the tree), drives ONE visit, writes the bytes, and releases.
 *
 * ## It holds the machine's one relay lease, so it queues behind a walk rather than corrupting one
 *
 * `browser/relayLease.ts` carries the measurement of four walks driving one tab at once. A shot
 * asked for while an atlas walk is running is refused with `relay-unavailable` naming the holder, which is
 * the honest answer and takes about a second — never a second client navigating the walk's own tab.
 *
 * ## The transport is released in a `finally`
 *
 * `browser/tabGuard.ts` exists because twelve `transport.release()` call sites stood in this tree and not
 * one of them sat in a `finally`. This one does, so a capture that throws still closes the tab it opened in
 * their window rather than leaving it for them to clear by hand.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import { slackClientRootsFromStructures } from "../../../atlas/slackApi/clientRoots.js";
import type { BrowserPageTransport, BrowserTransportError, PageCapture } from "../../../browser/pageTransport.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { readStructureRows } from "../../../corpus/structures/store.js";
import { logger } from "../../../lib/logger.js";
import { refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import {
  parseSlackShotArgs,
  renderSlackShotReport,
  type SlackShotOptions,
  type SlackShotOutcome,
  type SlackShotReport,
  slackClientUrl,
  slackShotOrigins,
} from "./shotCore.js";
import { SLACK_SHOT_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/**
 * The platform name this verb takes the relay lease under.
 *
 * Named for the verb rather than for Slack, because a refusal on the other side prints it and the reader
 * needs to know a one-off capture is holding the tab, not an atlas walk they could go and look at.
 *
 * @internal
 */
export const SLACK_SHOT_LEASE_PLATFORM = "slack shot";

/**
 * Which named state a transport failure is.
 *
 * @param error the typed transport failure
 * @returns the outcome a composer reports
 */
function outcomeOf({ error }: { error: BrowserTransportError }): SlackShotOutcome {
  if (error.code === "SESSION_LOST") {
    return "session-lost";
  }
  if (error.code === "NAVIGATION_FAILED") {
    return "navigation-failed";
  }
  if (error.code === "OFF_LEASE_ORIGIN") {
    return "off-lease-origin";
  }
  return "relay-unavailable";
}

/**
 * Why a capture that reached the message came back with no picture: the browser's own reason when it gave
 * one, else the plain statement that it returned none.
 *
 * @param capture what the page visit produced
 * @returns the reason the report prints
 */
function noPictureBecause({ capture }: { capture: PageCapture }): string {
  const blocked = capture.screenshotBlockedBecause;
  if (blocked === null) {
    return "the message was reached and described, but the browser returned no picture for it";
  }
  return blocked;
}

/**
 * Write the bytes a capture came back with, and report what landed.
 *
 * The parent directory is created rather than required, because the caller is usually a composer writing
 * into a turn's own directory that does not exist yet — and failing on that would report a capture problem
 * for a filesystem one.
 *
 * @param capture what the page visit produced
 * @param options the validated invocation, for the message identity the report carries
 * @returns the report to print
 */
function fileCapture({ capture, options }: { capture: PageCapture; options: SlackShotOptions }): SlackShotReport {
  const described = {
    channel: options.channel,
    finalUrl: capture.finalUrl,
    messageTs: options.messageTs,
    statusCode: capture.statusCode,
    title: capture.title,
    url: capture.requestedUrl,
  };
  if (capture.screenshotPng === null) {
    return {
      ...described,
      because: noPictureBecause({ capture }),
      bytes: null,
      outcome: "reached-not-photographed",
      path: null,
    };
  }
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, capture.screenshotPng);
  return {
    ...described,
    because: null,
    bytes: capture.screenshotPng.byteLength,
    outcome: "photographed",
    path: options.out,
  };
}

/**
 * Take one picture through the relay.
 *
 * @param options the validated invocation
 * @param home the state home the consent token, the recorded profile and the relay lease live under
 * @param profiles the door the recorded work profile is read through
 * @returns the report to print
 */
export async function takeSlackShot({
  options,
  home,
  profiles,
}: {
  options: SlackShotOptions;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<SlackShotReport> {
  const nothing = {
    bytes: null,
    channel: options.channel,
    finalUrl: null,
    messageTs: options.messageTs,
    path: null,
    statusCode: null,
    title: null,
    url: options.url,
  };
  const roots = slackClientRootsFromStructures({ rows: readStructureRows({ home, source: "slack" }).rows });
  if (roots === null) {
    return {
      ...nothing,
      because:
        "no Slack `org` structure row carries a workspace URL, so there is no client route to open — run " +
        "`slopweaver refresh --source slack` first. The `/archives/` permalink is deliberately NOT used as " +
        "a fallback: it is an interstitial that closes the tab mid-navigation.",
      outcome: "navigation-failed",
    };
  }
  const target = slackClientUrl({
    channel: options.channel,
    workspaceId: roots.clientWorkspaceId,
  });
  const directory = mkdtempSync(join(tmpdir(), "slopweaver-slack-shot-"));
  let transport: BrowserPageTransport | null = null;
  try {
    const attached = await attachWalkTransport({
      directory,
      home,
      origins: slackShotOrigins({ url: options.url }),
      platform: SLACK_SHOT_LEASE_PLATFORM,
      profiles,
    });
    if (attached.isErr()) {
      return { ...nothing, because: attached.error.join("; "), outcome: "relay-unavailable" };
    }
    transport = attached.value;
    const visited = await transport.visit({ photograph: true, settleMs: options.settleMs, url: target });
    if (visited.isErr()) {
      return { ...nothing, because: visited.error.message, outcome: outcomeOf({ error: visited.error }) };
    }
    return fileCapture({ capture: visited.value, options });
  } finally {
    if (transport !== null) {
      await transport.release();
    }
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * Print one report, as prose or as JSON.
 *
 * @param report what the attempt produced
 * @param json whether machine-readable output was asked for
 */
function reportShot({ report, json }: { report: SlackShotReport; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return;
  }
  for (const line of renderSlackShotReport({ report })) {
    logger.out({ line });
  }
}

/**
 * The report for a shot whose `--out` a checkout could carry, or nothing when it may be written.
 *
 * @param options the validated invocation
 * @param home the state home, which is allowed
 * @param cwd the directory a relative `--out` resolves against
 * @param env the environment, read only for the hatch
 * @returns the refusal report, asked before anything is opened, or undefined when the shot may proceed
 */
export function slackShotPlacementRefusal({
  options,
  home,
  cwd,
  env,
}: {
  options: SlackShotOptions;
  home: string;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}): SlackShotReport | undefined {
  const placement = refuseProofOutputInTree({ cwd, env, home, output: options.out });
  if (placement.isOk()) {
    return undefined;
  }
  return {
    because: placement.error.join("\n  "),
    bytes: null,
    channel: options.channel,
    finalUrl: null,
    messageTs: options.messageTs,
    outcome: "output-in-checkout",
    path: null,
    statusCode: null,
    title: null,
    url: options.url,
  };
}

/**
 * Run `slack shot`.
 *
 * @param rest the verb's own argv tail
 * @returns the process exit code
 */
export async function runSlackShot({ rest }: { rest: readonly string[] }): Promise<number> {
  const options = parseSlackShotArgs({ rest });
  if (options.isErr()) {
    for (const problem of slackArgumentErrorLines({ error: options.error })) {
      logger.warn({ msg: problem });
    }
    logger.warn({ msg: SLACK_SHOT_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: options.value.home });
  const misplaced = slackShotPlacementRefusal({ cwd: process.cwd(), env: process.env, home, options: options.value });
  if (misplaced !== undefined) {
    reportShot({ json: options.value.json, report: misplaced });
    return EXIT_ERROR;
  }
  const report = await takeSlackShot({ home, options: options.value, profiles: recordedProfilePort() });
  reportShot({ json: options.value.json, report });
  return report.outcome === "photographed" ? EXIT_OK : EXIT_ERROR;
}

/** `slopweaver slack shot` — photograph one rendered Slack message in the owner's own Chrome. */
export const slackShotCommand = defineCommand({
  run: (argv) => runSlackShot({ rest: argv.slice(VERB_ARG_OFFSET) }),
});
