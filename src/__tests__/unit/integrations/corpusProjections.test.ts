/**
 * The progress-phase sources, `store load`'s sources and refresh's missing-token hints, derived from the integration
 * registry: each equals what it replaced, and a fixture integration with only a manifest appears in each.
 */
import { describe, expect, it } from "vitest";

import { missingTokenDiagnostics } from "../../../cli/commands/refresh/core.js";
import { LOAD_SOURCES } from "../../../cli/commands/store/loadCore.js";
import {
  corpusProjectionsOf,
  missingTokenHintFor,
  PROGRESS_PHASE_SOURCES,
} from "../../../integrations/corpusProjections.js";
import { TOKENED_SOURCES, type TokenedSource } from "../../../integrations/corpusSources.js";
import type { IntegrationManifest } from "../../../integrations/manifest.js";
import { registeredIntegrations } from "../../../integrations/registry.js";
import { phaseSource } from "../../../lib/progressSnapshot.js";

/**
 * The hint refresh built by hand before it was declared per manifest — kept here verbatim as the witness the
 * declared hints are checked against.
 */
function handKeptTokenHint({ source }: { source: TokenedSource }): string {
  if (source === "slack") {
    return "set SLACK_USER_TOKEN (or SLACK_BOT_TOKEN) or $SLOPWEAVER_HOME/secrets/slack-user-token";
  }
  return `set ${source.toUpperCase()}_TOKEN or $SLOPWEAVER_HOME/secrets/${source}-token`;
}

/** A manifest-only fixture integration that reports prefixed progress and is token-gated under its own spelling. */
const FIXTURE = {
  corpus: {
    allSourcesSweep: true,
    alwaysPrivate: false,
    containerScoped: true,
    identityRoster: true,
    missingTokenHint: "set ACME_API_KEY or $SLOPWEAVER_HOME/secrets/acme-api-key",
    ordinal: 10,
    progressPhase: true,
    resyncDemand: true,
    upfrontTokenGate: true,
  },
  features: { ingest: async () => (await import("../../../corpus/github/fetch.js")).collectSearchHits },
  id: "acme",
  name: "Acme",
} as const satisfies IntegrationManifest;

/** The same, reporting no prefixed progress and with no up-front token gate. */
const QUIET_FIXTURE = {
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: false,
    identityRoster: false,
    ordinal: 10,
    progressPhase: false,
    resyncDemand: false,
    upfrontTokenGate: false,
  },
  features: { ingest: async () => (await import("../../../corpus/github/fetch.js")).collectSearchHits },
  id: "acme",
  name: "Acme",
} as const satisfies IntegrationManifest;

describe("the corpus projections derived from the registry", () => {
  it("each equals the hand-kept value it replaced, in the same order", () => {
    expect(PROGRESS_PHASE_SOURCES).toEqual(["github", "slack", "linear", "notion", "gmail"]);
    expect(LOAD_SOURCES).toEqual(["github", "slack", "linear", "notion"]);
  });

  it("every token-gated source's declared hint is the string refresh built by hand", () => {
    expect(TOKENED_SOURCES.length).toBeGreaterThan(0);
    expect(TOKENED_SOURCES.map((source) => missingTokenHintFor({ source }))).toEqual(
      TOKENED_SOURCES.map((source) => handKeptTokenHint({ source })),
    );
  });

  it("refresh's missing-token refusal prints the declared hint, Slack naming both env vars", () => {
    expect(
      missingTokenDiagnostics({ selectedSources: ["github", "slack", "linear"], tokens: { linear: "x" } }),
    ).toEqual([
      "refresh: slack requested but no token " +
        "(set SLACK_USER_TOKEN (or SLACK_BOT_TOKEN) or $SLOPWEAVER_HOME/secrets/slack-user-token)",
    ]);
  });

  it("a phase names its source only for a progress-phase source", () => {
    expect(phaseSource({ phase: "gmail.messages" })).toBe("gmail");
    expect(phaseSource({ phase: "calendar.events" })).toBeUndefined();
  });

  it("a fixture integration with only a manifest appears in the phase list and carries its own hint", () => {
    const derived = corpusProjectionsOf({ manifests: [...registeredIntegrations(), FIXTURE] });
    expect(derived.progressPhases).toEqual([...PROGRESS_PHASE_SOURCES, "acme"]);
    expect(derived.missingTokenHints.get("acme")).toBe("set ACME_API_KEY or $SLOPWEAVER_HOME/secrets/acme-api-key");

    const quiet = corpusProjectionsOf({ manifests: [...registeredIntegrations(), QUIET_FIXTURE] });
    expect(quiet.progressPhases).toEqual(PROGRESS_PHASE_SOURCES);
    expect([...quiet.missingTokenHints.keys()]).toEqual(["slack", "linear", "notion"]);
  });

  it("orders the phase list by ordinal, never by the order the manifests arrive in, and freezes it", () => {
    const reversed = corpusProjectionsOf({ manifests: registeredIntegrations().toReversed() });
    expect(reversed.progressPhases).toEqual(PROGRESS_PHASE_SOURCES);
    expect(Object.isFrozen(PROGRESS_PHASE_SOURCES)).toBe(true);
  });
});
