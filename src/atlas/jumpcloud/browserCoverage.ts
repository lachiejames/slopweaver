/**
 * The coverage cells a JumpCloud console walk writes: `page` graded against the DECLARED denominator, and
 * `method` as discovery only. A cell that falls short carries the previous walk's success forward.
 */
import { failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import { walkTally } from "../kit/walkPublish.js";

import { JUMPCLOUD_CONSOLE_PAGES } from "./browserPages.js";
import { JUMPCLOUD_CONSOLE_CHANNEL as CHANNEL, JUMPCLOUD_CONSOLE_SURFACE } from "./browserProjection.js";
import type { JumpcloudConsoleWalkResult, JumpcloudPageObservation } from "./browserWalk.js";
import {
  JUMPCLOUD_CONSOLE_VISIBILITY_SCOPE,
  type JumpcloudConsoleCoverageCell,
  type JumpcloudConsoleKindFile,
} from "./consoleModel.js";

/** A console coverage cell for a look that succeeded. */
function succeededCell({
  role,
  scope,
  reason,
  at,
}: {
  role: "corroborating" | "discovery";
  scope: string;
  reason: string;
  at: string;
}): JumpcloudConsoleCoverageCell {
  const cell = succeededCoverageCell({
    artifacts: [],
    at,
    reason,
    role,
    scope,
    state: "synced",
    surface: JUMPCLOUD_CONSOLE_SURFACE,
    visibilityScope: JUMPCLOUD_CONSOLE_VISIBILITY_SCOPE,
  });
  return {
    ...cell,
    artifacts: [...cell.artifacts],
    channel: CHANNEL,
    visibilityScope: JUMPCLOUD_CONSOLE_VISIBILITY_SCOPE,
  };
}

/** The console's own cell from the last walk, or null on the first. */
function previousConsoleCell({ stored }: { stored: JumpcloudConsoleKindFile }): JumpcloudConsoleCoverageCell | null {
  const previous = stored.coverage.find((cell) => cell.surface === JUMPCLOUD_CONSOLE_SURFACE);
  if (previous === undefined) {
    return null;
  }
  return previous;
}

/** A console coverage cell for a look that fell short, carrying the prior success forward. */
function failedCell({
  stored,
  role,
  scope,
  reason,
  unblockedBy,
}: {
  stored: JumpcloudConsoleKindFile;
  role: "corroborating" | "discovery";
  scope: string;
  reason: string;
  unblockedBy: string;
}): JumpcloudConsoleCoverageCell {
  const cell = failedCoverageCell({
    previous: previousConsoleCell({ stored }),
    reason,
    role,
    scope,
    state: "deferred",
    surface: JUMPCLOUD_CONSOLE_SURFACE,
    unblockedBy,
    visibilityScope: JUMPCLOUD_CONSOLE_VISIBILITY_SCOPE,
  });
  return {
    ...cell,
    artifacts: [...cell.artifacts],
    channel: CHANNEL,
    visibilityScope: JUMPCLOUD_CONSOLE_VISIBILITY_SCOPE,
  };
}

/**
 * The one coverage cell a walk writes for the `page` kind, graded against the DECLARED denominator.
 *
 * @returns `synced` only when every declared page was reached AND photographed, else `deferred` with the fraction
 *
 * @internal
 */
export function pageCoverageCell({
  pages,
  at,
  stored,
}: {
  pages: readonly JumpcloudPageObservation[];
  at: string;
  stored: JumpcloudConsoleKindFile;
}): JumpcloudConsoleCoverageCell {
  const { reached, photographed } = walkTally({ pages });
  // The DECLARED constant, never `pages.length` — see `refuseUndeclaredWalk`.
  const declaredCount = JUMPCLOUD_CONSOLE_PAGES.length;
  const reason =
    `${String(reached)} of ${String(declaredCount)} declared page(s) reached, ` +
    `${String(photographed)} of those also photographed`;
  if (reached === declaredCount && photographed === declaredCount) {
    return succeededCell({ at, reason, role: "corroborating", scope: "declared-pages" });
  }
  return failedCell({
    reason,
    role: "corroborating",
    scope: "declared-pages",
    stored,
    unblockedBy: "each unheld page carries its own gap naming what stopped it",
  });
}

/**
 * The coverage cell the observed operations earn — discovery only.
 *
 * @returns `synced` unless the administrator session was lost mid-walk, which defers it with the sign-in step
 *
 * @internal
 */
export function methodCoverageCell({
  walk,
  operationCount,
  at,
  stored,
}: {
  walk: JumpcloudConsoleWalkResult;
  operationCount: number;
  at: string;
  stored: JumpcloudConsoleKindFile;
}): JumpcloudConsoleCoverageCell {
  const { reached } = walkTally({ pages: walk.pages });
  const reason = `${String(operationCount)} distinct first-party operation(s) observed across ${String(reached)} reached page(s)`;
  if (walk.sessionLost) {
    return failedCell({
      reason: `${reason} — the walk stopped early because the administrator session was lost`,
      role: "discovery",
      scope: "operations-on-declared-pages",
      stored,
      unblockedBy: "sign in to the JumpCloud admin console in your own Chrome and run the walk again",
    });
  }
  return succeededCell({ at, reason, role: "discovery", scope: "operations-on-declared-pages" });
}
