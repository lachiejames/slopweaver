/**
 * `desktop e2e`'s walk leg: one test instance with its own saved state, the fixture page its published-page step
 * opens — published into the store and taken back out — and the cleanup of both whatever the walk did. The steps themselves are `./e2eDriver.ts`; the run that
 * follows the walk with the call leg is `./e2eRun.ts`.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import type { DesktopE2eError } from "../../../desktop/e2eErrors.js";
import {
  type PublishedE2ePageFixture,
  publishE2ePageFixture,
  removeE2ePageFixtureFromStore,
} from "../../../desktop/e2ePageFixtureStore.js";
import type { E2eStep } from "../../../desktop/e2ePlan.js";
import type { E2eStepResult } from "../../../desktop/e2eReport.js";
import type { E2eWorkContext } from "../../../desktop/e2eWorkContext.js";
import type { OnCallHoldError } from "../../../desktop/onCallHold.js";
import { slopweaverHome } from "../../../homeDir.js";
import { driveE2e, type E2eWalk } from "./e2eDriver.js";

/** What one walk is asked for, and where it reports. */
interface WalkSpec {
  /** The bundle the test instance launches. */
  readonly app: string;
  /** Whether the instance draws its own Slopweaver Test menu bar icon. */
  readonly menuBar: boolean;
  /** The work context the console is put in before the first step; `undefined` leaves it as it opened. */
  readonly context: E2eWorkContext | undefined;
  /** How long each step waits to settle before it is photographed (`--settle-cap`). */
  readonly settleCapMs: number;
  /** The walk's steps; none when the run asked only for calls. */
  readonly steps: readonly E2eStep[];
  /** The checkout whose console the instance reads. */
  readonly checkout: string;
  /** Whether the owner is on a call now, read before the launch and each step. */
  readonly onCall: () => OnCallHoldError | undefined;
  /** Where the photographs go. */
  readonly out: string;
  /** Each step's line as it finishes. */
  readonly progress: (options: { readonly result: E2eStepResult }) => void;
}

/**
 * The walk, when it has steps: one test instance, its own saved state removed whatever happens.
 *
 * @param spec what the walk is asked for, and where it reports
 * @returns each step's result and any mid-walk hold, none when the run asked only for calls, or why the walk could
 *   not start
 */
export async function walkLeg(spec: WalkSpec): Promise<Result<E2eWalk, DesktopE2eError | OnCallHoldError>> {
  if (spec.steps.length === 0) {
    return ok({ held: undefined, results: [] });
  }
  const published = await publishPageFixture({ steps: spec.steps });
  if (published.isErr()) {
    return err(published.error);
  }
  const publishedPage = published.value;
  let walked: Result<E2eWalk, DesktopE2eError | OnCallHoldError>;
  try {
    walked = await walkInstance({ publishedPage, spec });
  } catch (error) {
    // The throw is what gets reported; the fixture still goes, and a failure to remove it is said beside it.
    if (publishedPage !== undefined) {
      const retired = await retirePageFixture({ fixture: publishedPage });
      if (retired.isErr()) {
        logger.error({ msg: retired.error.message });
      }
    }
    throw error;
  }
  if (publishedPage === undefined) {
    return walked;
  }
  const retired = await retirePageFixture({ fixture: publishedPage });
  return retired.andThen(() => walked);
}

/**
 * One test instance walked, its own saved state removed whatever happens.
 *
 * @param spec what the walk is asked for, and where it reports
 * @param publishedPage the fixture page the published-page step opens
 * @returns each step's result and any mid-walk hold, or why the walk could not start
 */
async function walkInstance({
  spec,
  publishedPage,
}: {
  spec: WalkSpec;
  publishedPage: PublishedE2ePageFixture | undefined;
}): Promise<Result<E2eWalk, DesktopE2eError | OnCallHoldError>> {
  const userData = mkdtempSync(join(tmpdir(), "sw-desktop-e2e-"));
  try {
    return await driveE2e({
      app: spec.app,
      checkout: spec.checkout,
      context: spec.context,
      menuBar: spec.menuBar,
      onCall: spec.onCall,
      out: spec.out,
      progress: spec.progress,
      publishedPage,
      settleCapMs: spec.settleCapMs,
      steps: spec.steps,
      userData,
    });
  } finally {
    rmSync(userData, { force: true, recursive: true });
  }
}

/**
 * Publish the fixture page the published-page step opens, when the run takes that step, through the real publisher
 * into the AMBIENT state home's store, never `--home`: the instance reads the console already running, and that
 * console serves the pages of the home it was started under.
 *
 * @param steps the walk's steps
 * @returns the fixture published, `undefined` when the step is not taken, or why it could not be published
 */
async function publishPageFixture({
  steps,
}: {
  steps: readonly E2eStep[];
}): Promise<Result<PublishedE2ePageFixture | undefined, DesktopE2eError>> {
  if (!steps.some((step) => step.kind === "published-page")) {
    return ok(undefined);
  }
  return publishE2ePageFixture({ home: slopweaverHome(), nonce: randomUUID(), nowIso: new Date().toISOString() });
}

/**
 * Take the walk's fixture page out of the store, its only copy, after the instance has stopped.
 *
 * @param fixture the page the walk published
 * @returns nothing, or why the store still holds it
 */
async function retirePageFixture({
  fixture,
}: {
  fixture: PublishedE2ePageFixture;
}): Promise<Result<void, DesktopE2eError>> {
  return removeE2ePageFixtureFromStore({ fixture, home: slopweaverHome() });
}
