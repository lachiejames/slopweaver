/**
 * What a Codex reset claim records about the store either side of the consume: every window as the live read
 * reported it, whether that read put the store at its limit, and the resets it still held. The PURE half — a
 * live read in, a journal-ready reading out.
 *
 * ## Why both sides are journalled
 *
 * The owner believes a reset starts a fresh seven-day
 * week, but the fleet has no record of one. The intent row carries the reading
 * BEFORE the consume and the outcome row the reading AFTER, so the first claim answers it from the journal alone:
 * a weekly `resetAtIso` that moved about seven days out is a restarted week, one that did not move is a refill of
 * the same week. The credit state is carried too, because `nothingToReset` at the 99% bar
 * (`./resetConsume.ts` § Only at a limit) is only harmless if the held count did not fall.
 *
 * ## The limit is the routing bar, read once
 *
 * {@link storeAtLimit} is `./routingCapacity.ts`'s `codexNearCapWindows` over every gauge: at or past the register's
 * `pauseAtPercent` (99 by default, `../plans/thresholds.ts`) on a window whose reset is still ahead. That is the
 * number routing pauses a store at, so it is the only limit a store the fleet drives can actually reach; a separate
 * 100% gate here never opened (the owner's rule is to take a store up to 99 percent, then do the reset).
 */
import { z } from "zod";

import type { CodexThresholds } from "../plans/thresholds.js";

import type { CodexAccountLive } from "./accountLiveParse.js";
import type { CodexWindowLabel } from "./gauge.js";
import type { CodexResetCredit } from "./resetCreditsParse.js";
import { codexNearCapWindows } from "./routingCapacity.js";

/**
 * One window exactly as the live read reported it, with the bucket and slot it came from.
 *
 * @internal -- the element of {@link CodexResetReading.windows}, which is what every caller reads.
 */
export interface CodexResetWindowEvidence {
  /** The metered bucket (`codex` for the ordinary allowance), absent when the provider named none. */
  readonly limitId?: string;
  readonly slot: "primary" | "secondary";
  readonly label: CodexWindowLabel;
  readonly usedPercent: number;
  /** When the window reopens, absent when the read carried no reset instant. */
  readonly resetAtIso?: string;
  /** The window's width, absent when the read reported a percentage and no width. */
  readonly windowMinutes?: number;
}

/** One store's state as a claim journals it — before the consume on the intent, after it on the outcome. */
export interface CodexResetReading {
  readonly readAtIso: string;
  /** Whether {@link storeAtLimit} held for this read — judged when it was taken, never re-derived later. */
  readonly atLimit: boolean;
  /**
   * The register's pause bar `atLimit` was judged against, so a reader times the cap off the bar the claim used —
   * the owner may move it later (`plans set-thresholds`), and the reading must still say what was true then.
   */
  readonly pauseAtPercent: number;
  readonly windows: readonly CodexResetWindowEvidence[];
  readonly resetCreditsAvailable: number;
  /** Each held reset the provider itemised, absent when it sent the count alone. */
  readonly resetCreditsListed?: readonly CodexResetCredit[];
}

/** The journal's wire shape for a {@link CodexResetReading}, shared by both rows that carry one. */
export const resetReadingWire = z.object({
  atLimit: z.boolean(),
  pauseAtPercent: z.number(),
  readAtIso: z.string().min(1),
  resetCreditsAvailable: z.number(),
  resetCreditsListed: z
    .array(
      z.object({
        expiresAtIso: z.string().optional(),
        id: z.string(),
        status: z.string(),
        title: z.string().optional(),
      }),
    )
    .optional(),
  windows: z.array(
    z.object({
      label: z.enum(["five-hour", "weekly", "other"]),
      limitId: z.string().optional(),
      resetAtIso: z.string().optional(),
      slot: z.enum(["primary", "secondary"]),
      usedPercent: z.number(),
      windowMinutes: z.number().optional(),
    }),
  ),
});

/**
 * Whether the store's own live read puts it at its limit: some window at or past routing's pause bar whose reset is
 * still ahead of the read — the only point a free reset is spent at.
 *
 * @param live the store's live state
 * @param thresholds the register's Codex bars, whose `pauseAtPercent` is the limit a claim waits for
 * @returns true when a signed-in read carries such a window
 */
export function storeAtLimit({ live, thresholds }: { live: CodexAccountLive; thresholds: CodexThresholds }): boolean {
  if (live.kind !== "signed-in") {
    return false;
  }
  return live.gauges.some((gauge) => codexNearCapWindows({ gauge, nowIso: live.readAtIso, thresholds }).length > 0);
}

/**
 * The reading a claim journals for one live read, or undefined when the store was not signed in — there is
 * nothing about its windows or resets to record then.
 *
 * @param live the store's live state
 * @param thresholds the register's Codex bars the reading's `atLimit` is judged against
 * @returns the reading, or undefined for a store that answered nothing usable
 */
export function resetReadingOf({
  live,
  thresholds,
}: {
  live: CodexAccountLive;
  thresholds: CodexThresholds;
}): CodexResetReading | undefined {
  if (live.kind !== "signed-in") {
    return undefined;
  }
  const windows = live.gauges.flatMap((gauge) =>
    gauge.windows.map((window): CodexResetWindowEvidence => ({
      label: window.label,
      slot: window.slot,
      usedPercent: window.usedPercent,
      ...(gauge.limitId === undefined ? {} : { limitId: gauge.limitId }),
      ...(window.resetAtIso === undefined ? {} : { resetAtIso: window.resetAtIso }),
      ...(window.windowMinutes === undefined ? {} : { windowMinutes: window.windowMinutes }),
    })),
  );
  return {
    atLimit: storeAtLimit({ live, thresholds }),
    pauseAtPercent: thresholds.pauseAtPercent,
    readAtIso: live.readAtIso,
    resetCreditsAvailable: live.resetCreditsAvailable,
    windows,
    ...(live.resetCreditsListed === undefined ? {} : { resetCreditsListed: live.resetCreditsListed }),
  };
}

/**
 * Rebuild a parsed wire reading under `exactOptionalPropertyTypes`, dropping every optional key Zod left as
 * `undefined` so the value is exactly the shape that was written.
 *
 * @param wire what {@link resetReadingWire} parsed
 * @returns the reading
 */
export function resetReadingFromWire({ wire }: { wire: z.infer<typeof resetReadingWire> }): CodexResetReading {
  const { resetCreditsListed, windows, ...rest } = wire;
  return {
    ...rest,
    windows: windows.map(({ limitId, resetAtIso, windowMinutes, ...window }) => ({
      ...window,
      ...(limitId === undefined ? {} : { limitId }),
      ...(resetAtIso === undefined ? {} : { resetAtIso }),
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
    })),
    ...(resetCreditsListed === undefined
      ? {}
      : {
          resetCreditsListed: resetCreditsListed.map(({ expiresAtIso, title, ...credit }) => ({
            ...credit,
            ...(expiresAtIso === undefined ? {} : { expiresAtIso }),
            ...(title === undefined ? {} : { title }),
          })),
        }),
  };
}

/**
 * The listed AVAILABLE reset that lapses first, so a claim spends the one that would otherwise be lost first —
 * ties broken by id so a re-run names the same one. A credit with no expiry is never preferred over the
 * provider's own pick.
 *
 * @param credits the store's itemised resets, absent when it sent the count alone
 * @returns that credit, or undefined to let the provider pick
 */
export function soonestExpiringAvailableCredit({
  credits,
}: {
  credits: readonly CodexResetCredit[] | undefined;
}): CodexResetCredit | undefined {
  if (credits === undefined) {
    return undefined;
  }
  const dated = credits.filter((credit) => credit.status === "available" && credit.expiresAtIso !== undefined);
  const ordered = dated.toSorted(
    (left, right) => left.expiresAtIso!.localeCompare(right.expiresAtIso!) || left.id.localeCompare(right.id),
  );
  return ordered[0];
}
