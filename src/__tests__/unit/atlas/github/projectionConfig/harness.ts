/*
 * The shared context and provenance expectation for the GitHub CONFIGURATION projection tests in this directory.
 * Every deciding field carries a value no other field, row or document carries, so a projection reading the wrong
 * key, the wrong nested object or the wrong one of two documents produces a visibly wrong value rather than a
 * coincidentally right one. Pure; nothing here touches the filesystem.
 */
import { githubEntityId } from "../../../../../atlas/github/identity.js";
import type { GithubKind, GithubScopeLevel } from "../../../../../atlas/github/model.js";
import type { ProjectionContext } from "../../../../../atlas/github/projectionBase.js";

/** The one projection context every configuration case is projected under. */
export const CONTEXT: ProjectionContext = {
  at: "2026-10-01T01:02:03.000Z",
  source: {
    endpoint: "/config-endpoint/orgs/acme-config",
    observedAt: "2026-10-02T04:05:06.000Z",
    surface: "rest-live",
  },
};

/**
 * The provenance and scope fields every configuration entity carries, spelled out for one expectation.
 *
 * @returns the expected id, scope, first-seen time, state and source block for that entity.
 */
export function scopedFields({
  kind,
  scopeLevel,
  scopeRef,
  providerId,
  deepLink,
  deepLinkStatus,
}: {
  kind: GithubKind;
  scopeLevel: GithubScopeLevel;
  scopeRef: string;
  providerId: string;
  deepLink: string | null;
  deepLinkStatus: "unavailable" | "provider-provided";
}): Record<string, unknown> {
  return {
    firstSeenAt: "2026-10-01T01:02:03.000Z",
    id: githubEntityId({ kind, providerId, scopeRef }),
    providerId,
    scopeLevel,
    scopeRef,
    source: {
      artifacts: [],
      deepLink,
      deepLinkStatus,
      endpoint: "/config-endpoint/orgs/acme-config",
      observedAt: "2026-10-02T04:05:06.000Z",
      surface: "rest-live",
    },
    state: "observed",
  };
}
