/*
 * What the Slack send-reservation test files share: the key, instant and window every case reserves under, the
 * per-case throwaway home that `useSendReservationHome()` mints in a `beforeEach` and removes in the `afterEach` it
 * registers, the Slack SDK's platform-error shape, and the readers and seed for KEY's one slot file beneath that
 * home. A filesystem round-trip into one `mkdtempSync` directory, nothing else. They moved here when
 * `sendReservation.test.ts` was split by behaviour.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { stateHomePaths } from "../../../../../stateHome.js";

export const KEY = "a".repeat(64);
export const NOW = "2026-07-26T12:00:00.000Z";
export const WINDOW = 24;

/** The case's throwaway state home; a live binding, assigned before each case and read only inside one. */
export let home: string;

/**
 * Register the hooks that give every case its own throwaway home, and remove it after. Call it once, at the top of
 * a test file whose cases read {@link home}.
 */
export function useSendReservationHome(): void {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-send-reservation-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });
}

/**
 * The shape the Slack SDK throws for an `ok: false` answer, read structurally by the classifier.
 *
 * @returns an Error carrying the SDK's platform-error code and its `ok: false` data
 */
export function platformError({ error }: { error: string }): Error {
  return Object.assign(new Error(`An API error occurred: ${error}`), {
    code: "slack_webapi_platform_error",
    data: { error, ok: false },
  });
}

/**
 * The slot file for KEY.
 *
 * @returns the absolute path of KEY's slot file under the case's home
 */
export function slotPath(): string {
  return join(stateHomePaths({ home }).ledgers, "slack-sends", KEY);
}

/**
 * Every name in the slot directory, so a staging file left behind is visible.
 *
 * @returns the slot directory's entries, sorted
 */
export function slotNames(): readonly string[] {
  return readdirSync(join(stateHomePaths({ home }).ledgers, "slack-sends")).toSorted();
}

export const AGED = JSON.stringify({ reservedIso: "2026-07-24T12:00:00.000Z" });
export const CONFIRMED = JSON.stringify({ reservedIso: "2026-07-26T11:00:00.000Z", sentTs: "1785000000.000100" });
export const UNCONFIRMED = JSON.stringify({ reservedIso: "2026-07-26T11:00:00.000Z" });

/**
 * KEY's slot record, parsed — a fresh one carries a random claim, so its bytes cannot be asserted whole.
 *
 * @returns the slot file's JSON, read as a plain record
 */
export function slotRecord(): Record<string, unknown> {
  // oxlint-disable-next-line no-unsafe-type-assertion -- moved unchanged from a *.test.ts, where the rule is off; a guard would change the old in-file helper's failure behaviour
  return JSON.parse(readFileSync(slotPath(), "utf8")) as Record<string, unknown>;
}

/** Seed KEY's slot with exact bytes, as an earlier send or a crash would have left them. */
export function seedSlot({ raw }: { raw: string }): void {
  mkdirSync(join(stateHomePaths({ home }).ledgers, "slack-sends"), { recursive: true });
  writeFileSync(slotPath(), raw);
}
