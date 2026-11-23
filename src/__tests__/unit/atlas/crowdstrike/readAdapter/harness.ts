/*
 * What the CrowdStrike read-seam test files share: the fixture's instants and its one failed and one blocked kind,
 * the throwaway state homes each case publishes into (removed after every case by the `afterEach` that
 * `useScratchHomes()` registers), and the real publish path (`assembleCrowdstrikeKindFile` then
 * `publishCrowdstrikeAtlas`) that writes one generation into a home passed explicitly. It moved here when
 * `readAdapter.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import { unwrap } from "#lib/result.js";
import type { CrowdstrikeEntity, CrowdstrikeKindFile } from "../../../../../atlas/crowdstrike/entities.js";
import { assembleCrowdstrikeKindFile, initialCrowdstrikeManifest } from "../../../../../atlas/crowdstrike/kindFiles.js";
import { CROWDSTRIKE_KINDS, type CrowdstrikeKind } from "../../../../../atlas/crowdstrike/model.js";
import { crowdstrikeAtlasPaths, publishCrowdstrikeAtlas } from "../../../../../atlas/crowdstrike/store.js";
import { ENTITIES, SEEN } from "./entities.js";

export const AT = "2026-10-12T00:00:00.000Z";

/**
 * A distinct success instant per kind, from the kind's place in the declared list, so a read of the wrong
 * kind's status shows as the wrong instant. No clock is read.
 *
 * @returns the kind's own success instant, its minute the kind's declared index
 */
export function successAtOf({ kind }: { kind: CrowdstrikeKind }): string {
  return `2026-10-02T00:${String(CROWDSTRIKE_KINDS.indexOf(kind)).padStart(2, "0")}:00.000Z`;
}

/** The one kind whose latest attempt failed, after it had already succeeded once. */
export const FAILED_KIND = "vulnerability" satisfies CrowdstrikeKind;

/** When that failed attempt ran. */
const FAILED_ATTEMPT_AT = "2026-10-11T00:00:00.000Z";

/** The one kind the manifest records as permission-blocked. */
export const BLOCKED_KIND = "detection" satisfies CrowdstrikeKind;

/** The permission boundary stamped on {@link BLOCKED_KIND}. */
export const PERMISSION_BLOCK = {
  at: "2026-10-10T00:00:00.000Z",
  detail: "the API client may not read alerts",
  unblockedBy: "the Alerts: Read scope on the API client",
};

const homes: string[] = [];

/**
 * A throwaway state home this file owns and removes.
 *
 * @returns the new home's absolute path, recorded for the registered cleanup
 */
export function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-crowdstrike-read-"));
  homes.push(home);
  return home;
}

/** Register the `afterEach` that removes every scratch home minted since the last case. Call it once per test file. */
export function useScratchHomes(): void {
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
}

/**
 * The entities the fixture publishes for one kind: the declared one, then copies with their own ids, one more
 * in all than the kind's place in the declared list, so every kind's published count differs.
 *
 * @returns the declared entity first, then its suffixed copies
 */
export function entitiesFor({ kind }: { kind: CrowdstrikeKind }): readonly CrowdstrikeEntity[] {
  const declared = ENTITIES[kind];
  return Array.from({ length: CROWDSTRIKE_KINDS.indexOf(kind) + 1 }, (_, index): CrowdstrikeEntity => {
    if (index === 0) {
      return declared;
    }
    const suffix = `-${String(index + 1)}`;
    return { ...declared, id: `${declared.id}${suffix}`, providerId: `${declared.providerId}${suffix}` };
  });
}

/**
 * Whether a kind is read off the console rather than the API.
 *
 * @returns true for the two console kinds, false for every API kind
 */
export function isConsoleKind({ kind }: { kind: CrowdstrikeKind }): boolean {
  return kind === "console-page" || kind === "console-request";
}

/**
 * The coverage cell one kind's file carries, its reason and scope naming the kind, so a view that reads
 * another kind's coverage shows the wrong one. A console cell keeps its own surface rather than taking the
 * adapter's API fallback.
 */
function coverageFor({ kind }: { kind: CrowdstrikeKind }): CrowdstrikeKindFile["coverage"][number] {
  if (isConsoleKind({ kind })) {
    return {
      artifacts: [],
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: `98 of 553 declared ${kind} routes rendered`,
      role: "authoritative",
      scope: `${kind} scope`,
      state: "unavailable",
      surface: "falcon-console",
      unblockedBy: "license the missing modules",
      visibilityScope: "one Falcon tenant",
    };
  }
  return {
    artifacts: [],
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason: `every ${kind} page was read`,
    role: "authoritative",
    scope: `${kind} scope`,
    state: "synced",
    surface: "falcon-api",
    unblockedBy: null,
    visibilityScope: "one Falcon tenant",
  };
}

/** The open gap one kind's file carries, its id, reason and scope naming the kind for the same reason. */
function gapFor({ kind }: { kind: CrowdstrikeKind }): CrowdstrikeKindFile["gaps"][number] {
  return {
    condition: "scope-refused",
    fields: ["lastLoginAt"],
    firstDetectedAt: SEEN,
    id: `gap-${kind}`,
    kind,
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason: `the client may not read every ${kind} field`,
    scope: `${kind} scope`,
    status: "open",
    surfaces: ["falcon-api"],
  };
}

/** Assemble one kind's real file around its entities, its own coverage cell and its own gap. */
function fileFor({ kind }: { kind: CrowdstrikeKind }): CrowdstrikeKindFile {
  return unwrap(
    assembleCrowdstrikeKindFile({
      at: AT,
      coverage: [coverageFor({ kind })],
      entities: [...entitiesFor({ kind })],
      gaps: [gapFor({ kind })],
      kind,
    }),
  );
}

/** The latest attempt the fixture records for one kind: a success at its own instant, or the one failure. */
function attemptOf({ kind }: { kind: CrowdstrikeKind }): { at: string; outcome: "ok" | "failed"; reasons: string[] } {
  if (kind === FAILED_KIND) {
    return { at: FAILED_ATTEMPT_AT, outcome: "failed", reasons: ["HTTP 503"] };
  }
  return { at: successAtOf({ kind }), outcome: "ok", reasons: [] };
}

/**
 * Publish a generation giving every kind its own history: a success at a distinct instant, one kind whose
 * latest attempt failed after succeeding, one kind blocked by permission, and one kind holding two entities.
 */
export function publishClean({ home }: { home: string }): void {
  const initial = initialCrowdstrikeManifest({ updatedAt: AT });
  const kinds = { ...initial.kinds };
  const files: Partial<Record<CrowdstrikeKind, CrowdstrikeKindFile>> = {};
  for (const kind of CROWDSTRIKE_KINDS) {
    files[kind] = fileFor({ kind });
    kinds[kind] = {
      ...initial.kinds[kind],
      lastAttempt: attemptOf({ kind }),
      lastSuccessAt: successAtOf({ kind }),
    };
  }
  kinds[BLOCKED_KIND] = { ...kinds[BLOCKED_KIND], permissionBlocked: PERMISSION_BLOCK };
  unwrap(
    publishCrowdstrikeAtlas({
      derivedFrom: null,
      files,
      manifest: { ...initial, kinds },
      paths: crowdstrikeAtlasPaths({ home }),
    }),
  );
}
