/*
 * The shared harness for the `automation seat` test files: the recording edges a seat and a seated `run-due` run
 * over, and the two ways a case puts the slot ledger or the failure-hold store into a state before it acts.
 *
 * The two effectful edges of a seat, `register` and `openSession`, are injected as plain recording functions:
 * what is under test is which argv each is handed and what the claims file holds afterwards, and a recording
 * function observes that without writing a board row or opening a workspace. No mocks, per `testing.md`. Homes
 * come from `homeWith` below, removed by `removeHomes`, which each seat test file registers.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "vitest";

import type { RecipeRunDueDeps } from "../../../../../../cli/commands/automation/rowRunners.js";
import type { RecipeSeatDeps } from "../../../../../../cli/commands/automation/seat.js";
import { retireSeatRow } from "../../../../../../cli/commands/automation/seatRetirement.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { ok, type Result, unwrap } from "../../../../../../lib/result.js";
import { placeFailureHold } from "../../../../../../live/automation/failureHoldStore.js";
import { beginSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { UNREACHED_FLEET_CEILING_SEAMS } from "../../../../../fleetCeilingSeamsFake.js";
import { LANDING_PACKET, NOW_ISO, RETRY_NOT_BEFORE_ISO, SEAT_CHECKOUT } from "./fixtures.js";

/**
 * Recording edges for the seat, plus what each was handed.
 *
 * @param checkout what resolving the declared main checkout answers; {@link SEAT_CHECKOUT} unless a case says not
 * @returns the seat's edges, carrying the arrays its output, registrar and session opener record into
 */
export function seatDeps({
  registerExitCode = EXIT_OK,
  spawnExitCode = EXIT_OK,
  checkout = ok(SEAT_CHECKOUT),
}: {
  registerExitCode?: number;
  spawnExitCode?: number;
  checkout?: Result<string>;
} = {}): RecipeSeatDeps & {
  readonly out: string[];
  readonly diag: string[];
  readonly registered: (readonly string[])[];
  readonly opened: (readonly string[])[];
} {
  const out: string[] = [];
  const diag: string[] = [];
  const registered: (readonly string[])[] = [];
  const opened: (readonly string[])[] = [];
  let minted = 0;
  return {
    checkoutFor: () => checkout,
    diag,
    mintId: () => {
      minted += 1;
      return `token-000${String(minted)}-aaaa-bbbb-cccc-dddddddddddd`;
    },
    now: () => NOW_ISO,
    opened,
    openSession: ({ argv }) => {
      opened.push(argv);
      return Promise.resolve(spawnExitCode);
    },
    out,
    processAlive: () => true,
    register: ({ argv }) => {
      registered.push(argv);
      return Promise.resolve(registerExitCode);
    },
    registered,
    // The REAL retirement: this recording registrar writes no row, so a failed spawn finds the slug absent and
    // releases; a case that registers a real row swaps `register` and keeps this.
    retireRow: (args) => retireSeatRow(args),
    writeDiagnostic: (line) => diag.push(line),
    writeOut: (line) => out.push(line),
  };
}

/**
 * Recording edges for `run-due`, trimmed to the legs a seated row uses — the verb dispatch for a `resync` row, the
 * landing read for a `hygiene-sweep` one; `now` moves the clock past a seat.
 *
 * @returns the tick's edges, carrying the arrays its output, dispatcher and landing read record into
 */
export function runDueDeps({
  now = NOW_ISO,
  landingExitCode = EXIT_OK,
  landingLines = [LANDING_PACKET],
}: {
  now?: string;
  landingExitCode?: number;
  landingLines?: readonly string[];
} = {}): RecipeRunDueDeps & {
  readonly out: string[];
  readonly dispatched: (readonly string[])[];
  readonly landingReads: (readonly string[])[];
} {
  const out: string[] = [];
  const dispatched: (readonly string[])[] = [];
  const landingReads: (readonly string[])[] = [];
  let minted = 0;
  return {
    checkoutFor: () => ok("/checkouts/slopweaver"),
    dispatched,
    doorEnv: () => ({}),
    landingReads,
    ...UNREACHED_FLEET_CEILING_SEAMS,
    runGithubLandingRead: ({ rest }) => {
      landingReads.push(rest);
      return Promise.resolve({ diagnostics: "", exitCode: landingExitCode, lines: landingLines });
    },
    // No `investigate` row reaches this suite — a resync row is what it seats — so the value only has to
    // exist, and a `D`-prefixed placeholder is what a real install's would be.
    promptChannel: () => "D0PROMPT",
    mintId: () => `run-due-tok-${String((minted += 1))}`,
    now: () => now,
    out,
    processAlive: () => true,
    register: () => Promise.resolve(EXIT_OK),
    runAlertDigestRead: () => Promise.resolve({ diagnostics: "", exitCode: EXIT_OK, lines: [] }),
    runAlertSummaryRead: () => Promise.resolve({ diagnostics: "", exitCode: EXIT_OK, lines: [] }),
    runSlackPost: () => Promise.resolve({ diagnostics: "", exitCode: EXIT_OK, lines: [] }),
    runVerbKeepingDiagnostics: (argv) => {
      dispatched.push(argv);
      return Promise.resolve({ diagnostics: "", exitCode: EXIT_OK });
    },
    writeDiagnostic: () => undefined,
    writeOut: (line) => out.push(line),
  };
}

/**
 * Hold one row on a failure, exactly as a sibling dispatcher's failed firing would.
 *
 * @param home the state home whose failure-hold store takes the hold
 */
export function holdOnDisk({ home, recipeId }: { home: string; recipeId: string }): void {
  const finding = `recipe-failing-${recipeId}-a1`;
  unwrap(placeFailureHold({ finding, home, nowIso: NOW_ISO, reason: "held by the store", recipeId }));
}

/**
 * Take and fail one row's 23:00 firing `attempts` times — the state one chair's seats met on
 * `resync-atlas-github`, and at three the state the ledger calls EXHAUSTED.
 *
 * Every attempt but the last settles with a retry floor already behind the clock, so the next one may be
 * taken; the LAST leaves {@link RETRY_NOT_BEFORE_ISO}, which is still ahead of {@link NOW_ISO}.
 */
export function failFiring({
  home,
  recipeId,
  attempts = 1,
}: {
  home: string;
  recipeId: string;
  attempts?: number;
}): void {
  const slotIso = "2026-09-15T23:00:00.000Z";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const holderToken = `the-failed-token-${String(attempt)}`;
    const isLast = attempt === attempts;
    const taken = unwrap(
      beginSlotAttempt({
        holder: "an-earlier-seat",
        holderPid: null,
        holderToken,
        home,
        leaseExpiresIso: "2026-09-16T00:00:00.000Z",
        nowIso: "2026-09-15T23:01:00.000Z",
        processAlive: () => true,
        recipeId,
        slotIso,
      }),
    );
    expect(taken.kind).toBe("taken");
    unwrap(
      settleSlotAttempt({
        holderToken,
        home,
        nowIso: "2026-09-15T23:02:00.000Z",
        outcome: {
          detail: "exit 1",
          exitCode: 1,
          kind: "failed",
          retryNotBeforeIso: isLast ? RETRY_NOT_BEFORE_ISO : "2026-09-15T22:00:00.000Z",
          settledAtIso: "2026-09-15T23:02:00.000Z",
        },
        recipeId,
        slotIso,
      }),
    );
  }
}

// Every home the seat tests have minted, so each seat test file's `afterEach` can remove them.
const homes: string[] = [];

/**
 * Remove every home minted since the last call; each seat test file registers it with `afterEach`.
 *
 * @returns nothing
 */
export function removeHomes(): void {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
}

/**
 * A home holding the given rows, written as the definition store reads them.
 *
 * @returns the new home's path, removed by {@link removeHomes}
 */
export function homeWith({ rows }: { rows: readonly Record<string, unknown>[] }): string {
  const home = mkdtempSync(join(tmpdir(), "seat-"));
  homes.push(home);
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  rows.forEach((entry) => {
    writeFileSync(join(dir, `${String(entry["recipeId"])}.json`), JSON.stringify(entry), "utf8");
  });
  return home;
}
