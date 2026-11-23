/*
 * What the GitHub read-seam test files share: the fixture's instants and its one failed and one blocked kind, the
 * throwaway state homes each case publishes into (removed after every case by the `afterEach` that
 * `useScratchHomes()` registers), and the real publish path (`assembleGithubKindFile` then `publishGithubAtlas`)
 * that writes one generation into a home passed explicitly. Every declared kind is published, because the
 * adapter's scope decision (`scopeRef` where the entity carries one, `github` where it does not) is made per entity
 * shape and only a full set shows no kind falls on the wrong side of it. It moved here when `readAdapter.test.ts`
 * was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import { unwrap } from "#lib/result.js";
import {
  assembleGithubKindFile,
  type GithubEntity,
  type GithubKindFile,
  initialGithubManifest,
} from "../../../../../atlas/github/kindFiles.js";
import { GITHUB_KINDS, type GithubKind } from "../../../../../atlas/github/model.js";
import { githubAtlasPaths, publishGithubAtlas } from "../../../../../atlas/github/store.js";
import { ENTITIES, SEEN, surfaceFor } from "./entities.js";

export const AT = "2026-10-12T00:00:00.000Z";

/**
 * A distinct success instant per kind, from the kind's place in the declared list, so a read of the wrong
 * kind's status shows as the wrong instant. No clock is read.
 *
 * @returns the kind's own success instant, its minute the kind's declared index
 */
export function successAtOf({ kind }: { kind: GithubKind }): string {
  return `2026-10-02T00:${String(GITHUB_KINDS.indexOf(kind)).padStart(2, "0")}:00.000Z`;
}

/** The one kind whose latest attempt failed, after it had already succeeded once. */
export const FAILED_KIND = "ruleset" satisfies GithubKind;

/** When that failed attempt ran. */
const FAILED_ATTEMPT_AT = "2026-10-11T00:00:00.000Z";

/** The one kind the manifest records as permission-blocked. */
export const BLOCKED_KIND = "secret-name" satisfies GithubKind;

/** The permission boundary stamped on {@link BLOCKED_KIND}. */
export const PERMISSION_BLOCK = {
  at: "2026-10-10T00:00:00.000Z",
  detail: "the token may not list organization secrets",
  unblockedBy: "the admin:org scope on the token",
};

const homes: string[] = [];

/**
 * A throwaway state home this file owns and removes.
 *
 * @returns the new home's absolute path, recorded for the registered cleanup
 */
export function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-github-read-"));
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
export function entitiesFor({ kind }: { kind: GithubKind }): readonly GithubEntity[] {
  const declared = ENTITIES[kind];
  return Array.from({ length: GITHUB_KINDS.indexOf(kind) + 1 }, (_, index): GithubEntity => {
    if (index === 0) {
      return declared;
    }
    const suffix = `-${String(index + 1)}`;
    return { ...declared, id: `${declared.id}${suffix}`, providerId: `${declared.providerId}${suffix}` };
  });
}

/**
 * Whether a kind is read by the driven browser, whose coverage cell reports the walk's frontier.
 *
 * @returns true for the two `github-web` kinds, false for every REST kind
 */
export function isWebKind({ kind }: { kind: GithubKind }): boolean {
  return surfaceFor({ kind }) === "github-web";
}

/**
 * The coverage cell one kind's file carries, its reason and scope naming the kind, so a view that reads
 * another kind's coverage shows the wrong one. Each cell names its kind's own surface, so a browser cell
 * keeps `github-web` rather than taking the adapter's `rest-live` fallback.
 */
function coverageFor({ kind }: { kind: GithubKind }): GithubKindFile["coverage"][number] {
  if (isWebKind({ kind })) {
    return {
      artifacts: [],
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: `the ${kind} walk stopped at its frontier`,
      role: "authoritative",
      scope: `${kind} scope`,
      state: "unavailable",
      surface: "github-web",
      unblockedBy: "widen the walk frontier",
      visibilityScope: "GitHub's published description",
    };
  }
  return {
    artifacts: [],
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason: `every ${kind} was read`,
    role: "authoritative",
    scope: `${kind} scope`,
    state: "synced",
    surface: surfaceFor({ kind }),
    unblockedBy: null,
    visibilityScope: "GitHub's published description",
  };
}

/** The open gap one kind's file carries, its id, reason and scope naming the kind for the same reason. */
function gapFor({ kind }: { kind: GithubKind }): GithubKindFile["gaps"][number] {
  return {
    condition: "admin-page-unreachable",
    fields: [],
    firstDetectedAt: SEEN,
    id: `gap-${kind}`,
    kind,
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason: `one ${kind} redirected`,
    scope: `${kind} scope`,
    status: "open",
    surfaces: [surfaceFor({ kind })],
  };
}

/** Assemble one kind's real file around its entities, its own coverage cell and its own gap. */
function fileFor({ kind }: { kind: GithubKind }): GithubKindFile {
  return unwrap(
    assembleGithubKindFile({
      at: AT,
      coverage: [coverageFor({ kind })],
      entities: [...entitiesFor({ kind })],
      gaps: [gapFor({ kind })],
      kind,
    }),
  );
}

/** The latest attempt the fixture records for one kind: a success at its own instant, or the one failure. */
function attemptOf({ kind }: { kind: GithubKind }): { at: string; outcome: "ok" | "failed"; reasons: string[] } {
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
  const initial = initialGithubManifest({ updatedAt: AT });
  const kinds = { ...initial.kinds };
  const files: Partial<Record<GithubKind, GithubKindFile>> = {};
  for (const kind of GITHUB_KINDS) {
    files[kind] = fileFor({ kind });
    kinds[kind] = {
      ...initial.kinds[kind],
      lastAttempt: attemptOf({ kind }),
      lastSuccessAt: successAtOf({ kind }),
    };
  }
  kinds[BLOCKED_KIND] = { ...kinds[BLOCKED_KIND], permissionBlocked: PERMISSION_BLOCK };
  unwrap(
    publishGithubAtlas({
      derivedFrom: null,
      files,
      manifest: { ...initial, kinds },
      paths: githubAtlasPaths({ home }),
    }),
  );
}
