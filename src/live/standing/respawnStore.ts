/**
 * The one record that bridges a loop respawn's two phases — booted, then confirmed.
 *
 * `session respawn loop` boots the successor and stops there: it cannot see the successor arm, because
 * `listen arm` refuses while the predecessor's arm is live, and the predecessor is the session that has to
 * disarm (`docs/listener-supervision.md` — the listener is that session's own child). So the boot writes this
 * record — whose arm was standing, which slug and tree the successor was booted into — and `--confirm`, run by
 * whoever can see the successor armed (the successor itself, the supervisor's tick, a hand-run gate), reads it
 * back and judges the live arm against it. The `respawned` event is published on confirmation and never on
 * boot; a boot that is never confirmed leaves this record standing, which is the honest state.
 *
 * Failures are plain messages: no caller branches on WHY the record could not be read, only prints it.
 */
import { readFileSync, rmSync } from "node:fs";

import { z } from "zod";

import { formatIngestError } from "../../lib/ingestError.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";

/** Owner-only, matching `live/listener` — this names a pid and a worktree path. */
const DIR_MODE = 0o700;

const PendingLoopRespawnSchema = z.object({
  bootedAtIso: z.string().min(1),
  bootId: z.string().min(1).optional(),
  confirmedArmId: z.string().min(1).optional(),
  confirmedAtIso: z.string().min(1).optional(),
  predecessorArmId: z.string().min(1).optional(),
  successor: z.string().min(1),
  successorTree: z.string().min(1),
});

/**
 * A loop respawn that has been booted, and — once `confirmedArmId` is set — confirmed by its successor's own arm.
 * `bootId` is minted once per boot, so two boots equal on instant, slug and tree are still two; it is optional because a record written before it existed must still parse.
 *
 * @internal
 */
export type PendingLoopRespawn = z.infer<typeof PendingLoopRespawnSchema>;

/**
 * Read the pending loop respawn, if one stands.
 *
 * @param home the resolved state home
 * @returns the record, `undefined` when none has been written, or the reason it could not be trusted
 */
export function readPendingLoopRespawn({ home }: { readonly home: string }): Result<PendingLoopRespawn | undefined> {
  const path = stateHomePaths({ home }).live.standing.respawnPendingJson;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error["code"] : undefined;
    if (code === "ENOENT") {
      return ok(undefined);
    }
    return err([`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err([`${path} is not JSON — refusing to guess which respawn is pending`]);
  }
  const decoded = PendingLoopRespawnSchema.safeParse(parsed);
  if (!decoded.success) {
    return err([
      `${path} does not describe a pending respawn: ${decoded.error.issues.map((i) => i.message).join("; ")}`,
    ]);
  }
  return ok(decoded.data);
}

/**
 * Remove the pending loop respawn, so no earlier boot's record — confirmed or not — survives a boot that could
 * not record its own. An absent record is already the cleared state, not a failure.
 *
 * @param home the resolved state home
 * @returns nothing, or the reason the record could not be removed
 */
export function clearPendingLoopRespawn({ home }: { readonly home: string }): Result<void> {
  const path = stateHomePaths({ home }).live.standing.respawnPendingJson;
  const remove = (): void => {
    rmSync(path, { force: true });
  };
  return safeFs({ execute: remove, operation: "clearPendingLoopRespawn", path }).mapErr((error) => [
    formatIngestError({ error }),
  ]);
}

/**
 * Write the pending loop respawn, replacing whatever stood before.
 *
 * @param home the resolved state home
 * @param pending the record to persist
 * @returns nothing, or the reason the write failed
 */
export function writePendingLoopRespawn({
  home,
  pending,
}: {
  readonly home: string;
  readonly pending: PendingLoopRespawn;
}): Result<void> {
  const path = stateHomePaths({ home }).live.standing.respawnPendingJson;
  try {
    writeFileAtomic({ contents: `${JSON.stringify(pending, null, 2)}\n`, dirMode: DIR_MODE, path });
  } catch (error: unknown) {
    return err([`could not write ${path}: ${error instanceof Error ? error.message : String(error)}`]);
  }
  return ok(undefined);
}
