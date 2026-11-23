/**
 * The effects `handover backfill-rulings` runs on: reading the state again before each append, the one write
 * path, and the clock.
 *
 * One small module so `./rulingBackfill.ts` stays testable without a filesystem, and so the production wiring
 * is visible in one place rather than assembled at the call site.
 *
 * **The manifest is read ONCE.** Each re-read acquires the board and the journals fresh and re-attaches the
 * manifest already parsed, so the denominator a run is working to cannot change under it — a manifest edited
 * mid-run would otherwise silently authorise a different set of writes than the one that was planned.
 */

import { applyRowEvent } from "./rowEvent.js";
import { readRulingAuditInput } from "./rulingAuditStore.js";
import type { RulingAuditInput } from "./rulingAuditTypes.js";
import type { RulingBackfillDeps } from "./rulingBackfillTypes.js";

/**
 * The production dependencies, bound to one home.
 *
 * @param input the state as first acquired, whose manifest every re-read carries forward
 * @returns the reader, the write seam and the clock the writer runs on
 */
export function rulingBackfillDeps({ input }: { input: RulingAuditInput }): RulingBackfillDeps {
  return {
    append: applyRowEvent,
    readCurrentInput: (): RulingAuditInput => ({
      ...readRulingAuditInput({
        handoverDir: input.handoverDir,
        manifestPath: undefined,
        runsDir: input.runsDir,
      }),
      manifest: input.manifest,
      manifestPath: input.manifestPath,
    }),
    recordingInstant: (): string => new Date().toISOString(),
  };
}
