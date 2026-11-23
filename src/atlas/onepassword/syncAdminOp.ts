/**
 * The `admin-cli` channel's shared `op` primitives: one surface call turned into an attempt, a single-call
 * kind, and the per-parent walk.
 *
 * Split from `syncAdminChannel.ts`, which keeps the roster order, the progress lines and every kind-specific
 * walk; both halves of that roster call into these. A leaf: it imports nothing back from the channel, and no
 * type had to move with it.
 */
import { err, ok, type Result } from "../../lib/result.js";

import type { OnepasswordRequiredSurfaceName } from "./inventory.js";
import type { OnepasswordEntity, OnepasswordKind, OnepasswordKindFile } from "./model.js";
import { classifyOpFailure } from "./opCli.js";
import {
  failedAttempt,
  foldOnepasswordKind,
  kindResult,
  type OnepasswordSurfaceAttempt,
  type OnepasswordSyncKindOutcome,
  type OpSurfaceRunner,
  projectionGaps,
  projectOnepasswordRows,
  succeededAttempt,
} from "./syncCore.js";

/**
 * One `op` surface call, turned into an attempt whichever way it went.
 *
 * @returns the succeeded or failed attempt
 */
export function attemptOp({
  run,
  kind,
  surface,
  scope,
  id,
  stored,
  at,
}: {
  run: OpSurfaceRunner;
  kind: OnepasswordKind;
  surface: OnepasswordRequiredSurfaceName;
  scope: string;
  id: string | null;
  stored: OnepasswordKindFile;
  at: string;
}): OnepasswordSurfaceAttempt {
  const attempted = run({ id, surface });
  if (attempted.isOk()) {
    return succeededAttempt({ at, channel: "admin-cli", rows: attempted.value.rows, scope, surface });
  }
  const reason = attempted.error.join("; ");
  return failedAttempt({
    at,
    channel: "admin-cli",
    condition: classifyOpFailure({ stderr: reason }),
    kind,
    reason,
    scope,
    stored,
    surface,
  });
}

/**
 * Sync one single-call kind: `user`, `group`.
 *
 * @returns the projected entities and folded kind result, or why the fold refused
 */
export function syncSimpleKind({
  run,
  kind,
  surface,
  stored,
  project,
  at,
}: {
  run: OpSurfaceRunner;
  kind: OnepasswordKind;
  surface: OnepasswordRequiredSurfaceName;
  stored: OnepasswordKindFile;
  project: (input: { raw: unknown }) => Result<OnepasswordEntity>;
  at: string;
}): Result<{
  result: OnepasswordSyncKindOutcome & { file: OnepasswordKindFile };
  entities: readonly OnepasswordEntity[];
}> {
  const attempt = attemptOp({ at, id: null, kind, run, scope: surface, stored, surface });
  const projected = projectOnepasswordRows({ project, rows: attempt.rows });
  const fold = foldOnepasswordKind({
    at,
    attempts: [attempt],
    channel: "admin-cli",
    extraGaps: projectionGaps({ at, kind, reasons: projected.reasons, scope: surface }),
    observed: projected.entities,
    stored,
  });
  if (fold.isErr()) {
    return err(fold.error);
  }
  return ok({ entities: projected.entities, result: kindResult({ fold: fold.value, kind }) });
}

/**
 * Sync a per-parent kind: one call per parent id, and every one of them must succeed to be complete.
 *
 * @returns every attempt, projected entity and projection-refusal reason
 */
export function syncPerParentKind({
  run,
  kind,
  surface,
  parentIds,
  stored,
  project,
  at,
}: {
  run: OpSurfaceRunner;
  kind: OnepasswordKind;
  surface: OnepasswordRequiredSurfaceName;
  parentIds: readonly string[];
  stored: OnepasswordKindFile;
  project: (input: { raw: unknown; parentId: string }) => Result<OnepasswordEntity>;
  at: string;
}): {
  attempts: readonly OnepasswordSurfaceAttempt[];
  entities: readonly OnepasswordEntity[];
  reasons: readonly string[];
} {
  const attempts: OnepasswordSurfaceAttempt[] = [];
  const entities: OnepasswordEntity[] = [];
  const reasons: string[] = [];
  for (const parentId of parentIds) {
    const attempt = attemptOp({ at, id: parentId, kind, run, scope: `${surface}:${parentId}`, stored, surface });
    attempts.push(attempt);
    const projected = projectOnepasswordRows({
      project: ({ raw }) => project({ parentId, raw }),
      rows: attempt.rows,
    });
    entities.push(...projected.entities);
    reasons.push(...projected.reasons);
  }
  return { attempts, entities, reasons };
}
