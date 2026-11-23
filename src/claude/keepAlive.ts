/**
 * Which credential stores are due a refresh, so none of them dies of neglect.
 *
 * ## The hole this closes, measured
 *
 * An idle store dies on its own. Two of three went `401 access token has expired` from nothing but the
 * ordinary access-token lifetime, because nothing ran under them to refresh. That sits UNDERNEATH rotation
 * rather than inside it: a perfect trigger still lands the fleet on a store whose credential quietly
 * expired overnight, and the owner discovers it as an outage.
 *
 * ## The primitive is not the obvious command
 *
 * `claude auth status` does NOT refresh. It reads the credential and makes no API call, and the keychain
 * item's modification date does not move — measured, having tried it first and watched it fail. And the CLI
 * refreshes a token only inside its last {@link CLI_REFRESH_WINDOW_MINUTES} minutes, so ANY command run
 * earlier leaves the store as it was: `claude doctor` on an 8/3-hour schedule exited 0 and refreshed almost
 * nothing (MEASURED, `keepAliveTouch.ts`). So the touch reads the store's own expiry first
 * ({@link touchVerdict}), runs the proven refresh primitive (`storeRefresh.ts`, which starts no model and so is
 * legal under the no-headless rule) only inside that window, and counts it only when the expiry moved forward.
 * The wrong command looks exactly as correct as the right one until you read the expiry.
 *
 * ## Why the interval is well inside the lifetime
 *
 * A store is touched at a fraction of the access-token lifetime, not at the edge of it. A machine asleep,
 * a laptop lid closed, a session that overran — any of these can swallow one cycle, and a schedule with no
 * slack turns a single missed tick into a dead plan. Two misses in a row should still be survivable.
 */
import { isRecord } from "../lib/parsers.js";
import type { ClaudeAccount } from "./contracts.js";
import type { StoreLife } from "./credentialRepair.js";

/**
 * The measured access-token lifetime, in hours.
 *
 * MEASURED on one machine: a keychain item carried an `expiresAt` exactly eight hours after the
 * time it was written. Reproduce by reading the item and comparing its modification date
 * to the `expiresAt` inside it.
 */
export const ACCESS_TOKEN_LIFETIME_HOURS = 8;

/**
 * How often a store is touched, as a fraction of the token lifetime. A third means two consecutive misses
 * are still survivable, which a schedule at the edge of the lifetime would not be.
 */
const TOUCH_FRACTION = 3;

/** The interval between touches, in hours. */
export const KEEP_ALIVE_INTERVAL_HOURS = ACCESS_TOKEN_LIFETIME_HOURS / TOUCH_FRACTION;

/**
 * One store's last-touched record.
 *
 * @internal — an argument to {@link storesDueForTouch}; the caller reads these from the state file.
 */
export interface StoreTouch {
  readonly alias: string;
  /** When this store was last refreshed, ISO-8601. Absent when it has never been touched. */
  readonly lastTouchedIso?: string;
}

/**
 * Which stores are due a refresh now.
 *
 * A store that has NEVER been touched is always due: there is no evidence it is alive, and the cost of a
 * needless refresh is one API call while the cost of skipping a dead one is an outage.
 *
 * @param accounts every configured plan
 * @param touches what is known about when each was last refreshed
 * @param nowIso the current instant, ISO-8601 — injected, never read from a hidden clock
 * @returns the aliases due a touch, in configured order
 */
export function storesDueForTouch({
  accounts,
  nowIso,
  touches,
}: {
  accounts: readonly ClaudeAccount[];
  nowIso: string;
  touches: readonly StoreTouch[];
}): readonly string[] {
  const dueBefore = new Date(Date.parse(nowIso) - KEEP_ALIVE_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();
  return accounts
    .filter((account) => {
      const touch = touches.find((entry) => entry.alias === account.alias);
      return touch?.lastTouchedIso === undefined || touch.lastTouchedIso <= dueBefore;
    })
    .map((account) => account.alias);
}

/**
 * How close to its access expiry a store must be before the CLI's own refresh will act on it, in minutes.
 *
 * Claude Code refreshes a token only inside its last five minutes (`probeRepair.ts` § The residue), so a
 * refresh command run against a store with more life than this left exits cleanly and writes nothing. That
 * is how this loop can record a touch for a store the provider refuses about an hour later.
 */
export const CLI_REFRESH_WINDOW_MINUTES = 5;

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/** Why a due store is not refreshed this tick, beyond simply having life left. */
export type TouchHoldReason =
  | "unreadable-store"
  | "no-credential"
  | "unknown-access-expiry"
  | "no-refresh-token"
  | "unknown-refresh-expiry"
  | "refresh-expired"
  | "invalid-now";

/** What one due store's own credential says the touch should do. */
export type TouchVerdict =
  /** The token is inside the CLI's refresh window or past it, behind a live grant: run one refresh. */
  | { readonly kind: "refresh" }
  /** The token has more life than the window, so a refresh would write nothing: run nothing, record nothing. */
  | { readonly kind: "live"; readonly expiresAtIso: string }
  /** Nothing a refresh command can repair, or nothing readable enough to judge: run nothing, say why. */
  | { readonly kind: "hold"; readonly reason: TouchHoldReason };

/**
 * Whether a store due a touch should have its refresh run now, judged on its own credential's metadata.
 *
 * A touch is worth running only when the CLI will actually refresh, so the token's own expiry decides, never
 * the interval since the last touch. The grant checks mirror the on-demand repair's (`credentialRepair.ts`):
 * a refresh is only ever presented against a refresh grant known to be live.
 *
 * @param life the store's metadata, read immediately before this decision
 * @param nowIso the instant to judge against, read after `life`
 * @returns refresh, live with the expiry it still has, or hold with the reason
 */
export function touchVerdict({ life, nowIso }: { life: StoreLife; nowIso: string }): TouchVerdict {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) {
    return { kind: "hold", reason: "invalid-now" };
  }
  if (life.unreadable === true) {
    return { kind: "hold", reason: "unreadable-store" };
  }
  if (!life.hasCredential) {
    return { kind: "hold", reason: "no-credential" };
  }
  const expiresAtIso = life.expiresAtIso;
  const expiresMs = expiresAtIso === undefined ? Number.NaN : Date.parse(expiresAtIso);
  if (expiresAtIso === undefined || !Number.isFinite(expiresMs)) {
    return { kind: "hold", reason: "unknown-access-expiry" };
  }
  if (expiresMs - nowMs > CLI_REFRESH_WINDOW_MINUTES * MS_PER_MINUTE) {
    return { expiresAtIso, kind: "live" };
  }
  return grantVerdict({ life, nowMs });
}

/**
 * Whether a store whose token is due has a live refresh grant to present.
 *
 * @param life the store's metadata
 * @param nowMs the instant to judge against, in epoch milliseconds
 * @returns refresh, or hold naming what is missing
 */
function grantVerdict({ life, nowMs }: { life: StoreLife; nowMs: number }): TouchVerdict {
  if (!life.hasRefreshToken) {
    return { kind: "hold", reason: "no-refresh-token" };
  }
  const refreshMs = life.refreshExpiresAtIso === undefined ? Number.NaN : Date.parse(life.refreshExpiresAtIso);
  if (!Number.isFinite(refreshMs)) {
    return { kind: "hold", reason: "unknown-refresh-expiry" };
  }
  if (refreshMs <= nowMs) {
    return { kind: "hold", reason: "refresh-expired" };
  }
  return { kind: "refresh" };
}

/**
 * Read the stored touch records, tolerating anything unrecognisable.
 *
 * Deliberately tolerant, for the same reason `rotationState.ts` is: a corrupt file means this code forgot
 * when it last refreshed a store, and the repair is one needless `doctor` call per store. Refusing to parse
 * would instead stop the loop that keeps every credential alive, which is the outage this module exists to
 * prevent.
 *
 * @param value the decoded contents of the touch file, or undefined when there is none
 * @returns every usable record, empty when nothing was stored
 */
export function parseStoreTouches({ value }: { value: unknown }): readonly StoreTouch[] {
  if (!isRecord(value) || !Array.isArray(value["touches"])) {
    return [];
  }
  return value["touches"].flatMap((entry): readonly StoreTouch[] => {
    if (!isRecord(entry) || typeof entry["alias"] !== "string") {
      return [];
    }
    const lastTouchedIso = entry["lastTouchedIso"];
    if (typeof lastTouchedIso !== "string") {
      return [{ alias: entry["alias"] }];
    }
    return [{ alias: entry["alias"], lastTouchedIso }];
  });
}

/**
 * Record that one store was just refreshed, replacing any record already standing for it.
 *
 * @param alias the store that was touched
 * @param nowIso when it was touched, ISO-8601 — injected, never read from a hidden clock
 * @param touches what was known before
 * @returns the records with this store's entry replaced
 */
export function recordStoreTouch({
  alias,
  nowIso,
  touches,
}: {
  alias: string;
  nowIso: string;
  touches: readonly StoreTouch[];
}): readonly StoreTouch[] {
  return [...touches.filter((entry) => entry.alias !== alias), { alias, lastTouchedIso: nowIso }];
}
