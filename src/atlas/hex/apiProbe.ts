/**
 * What an UNAUTHENTICATED request can establish about the Hex API, and the two controls that make it mean
 * anything.
 *
 * ## The method, and why it works here at all
 *
 * `app.hex.tech` answers an unauthenticated request to a MOUNTED `/api/v1` noun with `401 Unauthorized`,
 * and one to a noun it does not have with a `404` carrying its own JSON envelope. Those are different
 * answers, so an anonymous request discriminates: it establishes that a noun EXISTS without establishing
 * anything at all about what is behind it.
 *
 * MEASURED over {@link HEX_PROBE_CENSUS}: 13 of 74 candidate nouns are mounted. Reproduce the
 * whole census, controls included, with:
 *
 * ```bash
 * yarn tsx tools/probeHexApiSurface.ts --verify
 * ```
 *
 * ## Two controls, and the second is the interesting one
 *
 * {@link HEX_ABSENCE_CONTROL} is the ordinary one: an invented top-level noun must answer 404, or a `401`
 * anywhere else carries no information and the whole census is void.
 *
 * {@link HEX_DEPTH_CONTROL} is the one that bounds the claim, and it FAILS to discriminate on purpose. An
 * invented path NESTED under a mounted noun — `/api/v1/projects/zzzsynthetic/zzzsynthetic` — answers `401`,
 * exactly as a real one does, because the router authenticates the whole `/v1/projects` subtree before it
 * ever routes within it. **So this census is noun-level and can never be more.** Stating that is the point:
 * without it a reader would take the method for a path-level inventory and read every 401 as a discovered
 * endpoint, which would manufacture a surface out of the authentication order.
 *
 * ## What a mounted noun is worth, and what it is not
 *
 * It is `discovery` evidence and never more. A 401 says Hex routes that noun; it says nothing about which
 * methods it accepts, what it returns, or whether an ordinary API token may ask for it. The one finding it
 * produces that nothing else here does is a noun the published document declares NO path under at all —
 * `docs/atlas-intent/02-both-surfaces.md`'s divergence, arrived at from the API side rather than from the browser.
 */

/**
 * Where the Hex API answers. A probe settling anywhere else has not been measured.
 *
 * @internal
 */
export const HEX_API_ORIGIN = "https://app.hex.tech";

/** The path prefix every probed noun hangs off. */
export const HEX_API_PREFIX = "/api/v1";

/**
 * What one unauthenticated answer establishes.
 *
 * @internal
 */
export const HEX_PROBE_EVIDENCE = ["mounted-401", "absent-404", "undiscriminating"] as const;

/** The class one unauthenticated answer falls into. */
export type HexProbeEvidence = (typeof HEX_PROBE_EVIDENCE)[number];

/** One probed noun and what the measurement found. */
export interface HexProbeRow {
  /** What the unauthenticated request established. */
  readonly evidence: HexProbeEvidence;
  /** The path segment probed, directly under {@link HEX_API_PREFIX}. */
  readonly noun: string;
}

/**
 * The invented noun that must answer 404, or the census means nothing.
 *
 * Deliberately obvious rather than random: a reader re-running the probe must be able to see at a glance
 * that no request in this file could ever reach a real resource.
 *
 * @internal
 */
export const HEX_ABSENCE_CONTROL = "zzzsynthetic";

/**
 * The invented NESTED path that answers 401 anyway — the control that bounds this method's claim.
 *
 * See this file's header. It is recorded as a row rather than as a comment because a bound nobody can
 * re-measure is a bound that quietly stops being true.
 *
 * @internal
 */
export const HEX_DEPTH_CONTROL = "projects/zzzsynthetic/zzzsynthetic";

/**
 * Every noun probed, with what the measurement found.
 *
 * The candidates are the eleven the published document declares plus every noun the product's own
 * vocabulary suggests — read off Hex's documentation navigation and its web client's route table — so the
 * denominator is a list somebody can check rather than a set of lucky guesses. A noun that answers 404 is
 * as much a result as one that answers 401: it is this atlas saying it looked.
 */
export const HEX_PROBE_CENSUS: readonly HexProbeRow[] = [
  { evidence: "mounted-401", noun: "cells" },
  { evidence: "mounted-401", noun: "collections" },
  { evidence: "mounted-401", noun: "context" },
  { evidence: "mounted-401", noun: "data-connections" },
  { evidence: "mounted-401", noun: "embedding" },
  { evidence: "mounted-401", noun: "groups" },
  { evidence: "mounted-401", noun: "guides" },
  { evidence: "mounted-401", noun: "projects" },
  { evidence: "mounted-401", noun: "semantic-models" },
  { evidence: "mounted-401", noun: "semantic-projects" },
  { evidence: "mounted-401", noun: "suggestions" },
  { evidence: "mounted-401", noun: "threads" },
  { evidence: "mounted-401", noun: "users" },
  { evidence: "absent-404", noun: "admin" },
  { evidence: "absent-404", noun: "agents" },
  { evidence: "absent-404", noun: "api-keys" },
  { evidence: "absent-404", noun: "apps" },
  { evidence: "absent-404", noun: "archive" },
  { evidence: "absent-404", noun: "audit-logs" },
  { evidence: "absent-404", noun: "billing" },
  { evidence: "absent-404", noun: "categories" },
  { evidence: "absent-404", noun: "charts" },
  { evidence: "absent-404", noun: "comments" },
  { evidence: "absent-404", noun: "components" },
  { evidence: "absent-404", noun: "connections" },
  { evidence: "absent-404", noun: "credits" },
  { evidence: "absent-404", noun: "dashboards" },
  { evidence: "absent-404", noun: "datasets" },
  { evidence: "absent-404", noun: "docs" },
  { evidence: "absent-404", noun: "environments" },
  { evidence: "absent-404", noun: "evals" },
  { evidence: "absent-404", noun: "events" },
  { evidence: "absent-404", noun: "exports" },
  { evidence: "absent-404", noun: "files" },
  { evidence: "absent-404", noun: "folders" },
  { evidence: "absent-404", noun: "graphql" },
  { evidence: "absent-404", noun: "health" },
  { evidence: "absent-404", noun: "images" },
  { evidence: "absent-404", noun: "integrations" },
  { evidence: "absent-404", noun: "invites" },
  { evidence: "absent-404", noun: "kernels" },
  { evidence: "absent-404", noun: "magics" },
  { evidence: "absent-404", noun: "mcp" },
  { evidence: "absent-404", noun: "me" },
  { evidence: "absent-404", noun: "notifications" },
  { evidence: "absent-404", noun: "openapi" },
  { evidence: "absent-404", noun: "orgs" },
  { evidence: "absent-404", noun: "organizations" },
  { evidence: "absent-404", noun: "packages" },
  { evidence: "absent-404", noun: "permissions" },
  { evidence: "absent-404", noun: "reports" },
  { evidence: "absent-404", noun: "reviews" },
  { evidence: "absent-404", noun: "roles" },
  { evidence: "absent-404", noun: "runs" },
  { evidence: "absent-404", noun: "schedules" },
  { evidence: "absent-404", noun: "search" },
  { evidence: "absent-404", noun: "secrets" },
  { evidence: "absent-404", noun: "sessions" },
  { evidence: "absent-404", noun: "shares" },
  { evidence: "absent-404", noun: "slack" },
  { evidence: "absent-404", noun: "statuses" },
  { evidence: "absent-404", noun: "status" },
  { evidence: "absent-404", noun: "tables" },
  { evidence: "absent-404", noun: "tasks" },
  { evidence: "absent-404", noun: "teams" },
  { evidence: "absent-404", noun: "tokens" },
  { evidence: "absent-404", noun: "topics" },
  { evidence: "absent-404", noun: "trpc" },
  { evidence: "absent-404", noun: "uploads" },
  { evidence: "absent-404", noun: "variables" },
  { evidence: "absent-404", noun: "version" },
  { evidence: "absent-404", noun: "warehouses" },
  { evidence: "absent-404", noun: "webhooks" },
  { evidence: "absent-404", noun: "workspaces" },
];

/**
 * Which class one unauthenticated status falls into.
 *
 * @param status the HTTP status the anonymous request came back with
 * @returns the evidence class it establishes
 */
export function hexProbeEvidenceFor({ status }: { status: number }): HexProbeEvidence {
  if (status === 404) {
    return "absent-404";
  }
  if (status === 401) {
    return "mounted-401";
  }
  return "undiscriminating";
}

/**
 * Every noun the census found mounted, sorted.
 *
 * @returns the mounted nouns
 */
export function hexMountedNouns(): readonly string[] {
  return HEX_PROBE_CENSUS.filter((row) => row.evidence === "mounted-401")
    .map((row) => row.noun)
    .toSorted();
}
