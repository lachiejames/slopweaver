/**
 * The corpus source lists derived from the integration registry: each equals the list it replaced, in order, and a
 * fixture integration with only a manifest appears in every one of them.
 */
import { describe, expect, it } from "vitest";

import { CONNECT_USAGE } from "../../../cli/commands/connect/connectUsage.js";
import type { TokenedSource as RefreshTokenedSource } from "../../../cli/commands/refresh/core.js";
import type { ConnectSource as HomeConnectSource, ConnectTarget as HomeConnectTarget } from "../../../connect/types.js";
import {
  ALL_CORPUS_SOURCES,
  BRONZE_SOURCES,
  CONNECT_SOURCES,
  CONNECT_TARGETS,
  CORPUS_SOURCES,
  type ConnectSource,
  type ConnectTarget,
  type CorpusSource,
  corpusSourcesOf,
  FETCHABLE_SOURCES,
  TOKENED_SOURCES,
  type TokenedSource,
} from "../../../integrations/corpusSources.js";
import type { IntegrationManifest } from "../../../integrations/manifest.js";
import { integrations, type RegisteredIntegration, registeredIntegrations } from "../../../integrations/registry.js";
import type { ProviderReadSource } from "../../../live/providerRead.js";
import { ONBOARD_SOURCES } from "../../../onboard/sources.js";

/** The literal union `src/corpus/types.ts` spelled by hand before it was derived. */
type HandKeptCorpusSource =
  | "github"
  | "slack"
  | "linear"
  | "notion"
  | "gold"
  | "self"
  | "gmail"
  | "calendar"
  | "fathom"
  | "chatgpt"
  | "outlook-calendar"
  | "outlook";
/** The literal unions `connect/types.ts`, `refresh/core.ts` and `live/providerRead.ts` spelled by hand. */
type HandKeptConnectSource = "github" | "slack" | "linear" | "notion" | "gmail" | "outlook";
type HandKeptConnectTarget = HandKeptConnectSource | "datadog";
type HandKeptTokenedSource = "slack" | "linear" | "notion";
type HandKeptProviderReadSource = "github" | "linear" | "notion";

/** `true` only when `A` and `B` are the same type; `false` when either has a member the other lacks. */
type SameType<A, B> = [A, B] extends [B, A] ? true : false;

/** The ids of the manifests the shared `<provider> read` reader serves. */
type SharedRead<M> = M extends { readonly id: infer I; readonly sharedRead: true } ? I : never;

/**
 * A manifest-only fixture integration that ingests, is swept, has a preflight and is token-gated, as a brand-new
 * org-shared one would arrive.
 */
const SWEPT_FIXTURE = {
  corpus: {
    allSourcesSweep: true,
    alwaysPrivate: false,
    containerScoped: true,
    identityRoster: true,
    missingTokenHint: "set ACME_API_KEY",
    ordinal: 12,
    progressPhase: true,
    resyncDemand: true,
    upfrontTokenGate: true,
  },
  features: {
    connect: async () => (await import("../../../connect/github.js")).classifyGithub,
    ingest: async () => (await import("../../../corpus/github/fetch.js")).collectSearchHits,
    read: async () => (await import("../../../live/github/read.js")).parseGithubReadAddress,
  },
  id: "acme",
  name: "Acme",
  sharedRead: true,
} as const satisfies IntegrationManifest;

/** The same, private, with no preflight and no up-front token gate: reached by naming it. */
const PRIVATE_FIXTURE = {
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: false,
    identityRoster: false,
    ordinal: 12,
    progressPhase: false,
    resyncDemand: false,
    upfrontTokenGate: false,
  },
  features: { ingest: async () => (await import("../../../corpus/github/fetch.js")).collectSearchHits },
  id: "acme",
  name: "Acme",
} as const satisfies IntegrationManifest;

/** A live connector with a preflight and no corpus row; `aaa` sorts it before every real connect-only one. */
const CONNECT_ONLY_FIXTURE = {
  features: { connect: async () => (await import("../../../connect/datadog.js")).classifyDatadog },
  id: "aaa-acme",
  name: "Acme Live",
} as const satisfies IntegrationManifest;

describe("the corpus source lists derived from the registry", () => {
  it("each equals the hand-kept list it replaced, in the same order — pinned, so a renumbered ordinal fails here", () => {
    expect(ALL_CORPUS_SOURCES).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
      "gold",
      "self",
      "gmail",
      "calendar",
      "fathom",
      "chatgpt",
      "outlook-calendar",
      "outlook",
    ]);
    expect(BRONZE_SOURCES).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
      "self",
      "gmail",
      "calendar",
      "fathom",
      "chatgpt",
      "outlook-calendar",
      "outlook",
    ]);
    expect(FETCHABLE_SOURCES).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
      "gmail",
      "calendar",
      "fathom",
      "chatgpt",
      "outlook-calendar",
      "outlook",
    ]);
    expect(CORPUS_SOURCES).toEqual(["github", "slack", "linear", "notion"]);
  });

  it("the CorpusSource type is exactly the union it replaced — checked by the compiler, both directions", () => {
    const exact: SameType<CorpusSource, HandKeptCorpusSource> = true;
    expect(exact).toBe(true);
  });

  it("widened manifests derive every list typed `string`, never `never`, so no type is narrower than its value", () => {
    const widened = corpusSourcesOf({ manifests: integrations() });
    const sound: readonly true[] = [
      true satisfies SameType<(typeof widened.allSourcesSweep)[number], string>,
      true satisfies SameType<(typeof widened.connectable)[number], string>,
      true satisfies SameType<(typeof widened.connectTargets)[number], string>,
      true satisfies SameType<(typeof widened.tokenGated)[number], string>,
    ];
    expect(sound).toEqual([true, true, true, true]);
    expect(widened.allSourcesSweep).toEqual(["github", "slack", "linear", "notion"]);
    expect(widened.connectable).toEqual(CONNECT_SOURCES);
    expect(widened.tokenGated).toEqual(TOKENED_SOURCES);
  });

  it("the connect, token-gate and shared-reader lists each equal the hand-kept one, in order", () => {
    expect(CONNECT_SOURCES).toEqual(["github", "slack", "linear", "notion", "gmail", "outlook"]);
    expect(CONNECT_SOURCES).toEqual(ONBOARD_SOURCES);
    expect(CONNECT_TARGETS).toEqual(["github", "slack", "linear", "notion", "gmail", "outlook", "datadog"]);
    expect(TOKENED_SOURCES).toEqual(["slack", "linear", "notion"]);
  });

  it("connect's usage line names every derived target, in the order the hand-typed line did", () => {
    expect(CONNECT_USAGE).toBe(
      "usage: slopweaver connect <github|slack|linear|notion|gmail|outlook|datadog> --check [--json] " +
        "[--repo owner/repo] [--github-org <org>] [--home <dir>]",
    );
  });

  it("the ConnectSource, ConnectTarget, TokenedSource and ProviderReadSource types are the unions they replaced", () => {
    const exact: readonly true[] = [
      true satisfies SameType<ConnectSource, HandKeptConnectSource>,
      true satisfies SameType<ConnectSource, HomeConnectSource>,
      true satisfies SameType<ConnectTarget, HandKeptConnectTarget>,
      true satisfies SameType<ConnectTarget, HomeConnectTarget>,
      true satisfies SameType<TokenedSource, HandKeptTokenedSource>,
      true satisfies SameType<TokenedSource, RefreshTokenedSource>,
      true satisfies SameType<SharedRead<RegisteredIntegration>, HandKeptProviderReadSource>,
      true satisfies SameType<SharedRead<RegisteredIntegration>, ProviderReadSource>,
      true satisfies SameType<
        SharedRead<RegisteredIntegration | typeof SWEPT_FIXTURE>,
        HandKeptProviderReadSource | "acme"
      >,
    ];
    expect(exact).toEqual([true, true, true, true, true, true, true, true, true]);
  });

  it("the ordinals are 0..n-1 with no gap and no duplicate — what keeps every list's order append-only", () => {
    const ordinals = registeredIntegrations()
      .flatMap((manifest): number[] => ("corpus" in manifest ? [manifest.corpus.ordinal] : []))
      .concat([4, 5])
      .toSorted((left, right) => left - right);
    expect(ordinals).toEqual(ALL_CORPUS_SOURCES.map((_, index) => index));
  });

  it("a manifest declares corpus metadata exactly when it declares ingest", () => {
    const manifests = integrations();
    expect(manifests.length).toBeGreaterThan(0);
    const mismatched = manifests
      .filter((manifest) => (manifest.corpus === undefined) !== (manifest.features.ingest === undefined))
      .map((manifest) => manifest.id);
    expect(mismatched).toEqual([]);
  });

  it("a fixture integration with only a manifest appears last in every list, and in the sweep only when swept", () => {
    const swept = corpusSourcesOf({ manifests: [...registeredIntegrations(), SWEPT_FIXTURE] });
    expect(swept.all).toEqual([...ALL_CORPUS_SOURCES, "acme"]);
    expect(swept.bronze).toEqual([...BRONZE_SOURCES, "acme"]);
    expect(swept.fetchable).toEqual([...FETCHABLE_SOURCES, "acme"]);
    expect(swept.allSourcesSweep).toEqual([...CORPUS_SOURCES, "acme"]);
    expect(swept.connectable).toEqual([...CONNECT_SOURCES, "acme"]);
    expect(swept.connectTargets).toEqual([...CONNECT_SOURCES, "acme", "datadog"]);
    expect(swept.tokenGated).toEqual([...TOKENED_SOURCES, "acme"]);

    const named = corpusSourcesOf({ manifests: [...registeredIntegrations(), PRIVATE_FIXTURE] });
    expect(named.fetchable).toEqual([...FETCHABLE_SOURCES, "acme"]);
    expect(named.allSourcesSweep).toEqual(CORPUS_SOURCES);
    expect(named.connectable).toEqual(CONNECT_SOURCES);
    expect(named.connectTargets).toEqual(CONNECT_TARGETS);
    expect(named.tokenGated).toEqual(TOKENED_SOURCES);
  });

  it("a connect-only fixture joins the connect targets after the corpus ones, by id, and no other list", () => {
    const live = corpusSourcesOf({ manifests: [...registeredIntegrations(), CONNECT_ONLY_FIXTURE] });
    expect(live.connectTargets).toEqual([...CONNECT_SOURCES, "aaa-acme", "datadog"]);
    expect([live.all, live.connectable, live.fetchable, live.tokenGated]).toEqual([
      ALL_CORPUS_SOURCES,
      CONNECT_SOURCES,
      FETCHABLE_SOURCES,
      TOKENED_SOURCES,
    ]);
  });

  it("orders by ordinal, never by the order the manifests arrive in", () => {
    const reversed = corpusSourcesOf({ manifests: registeredIntegrations().toReversed() });
    expect(reversed.all).toEqual(ALL_CORPUS_SOURCES);
    expect(reversed.connectTargets).toEqual(CONNECT_TARGETS);
    expect(reversed.tokenGated).toEqual(TOKENED_SOURCES);
  });

  it("every list is frozen, so one reader cannot change another's answer", () => {
    expect(
      [
        ALL_CORPUS_SOURCES,
        BRONZE_SOURCES,
        FETCHABLE_SOURCES,
        CORPUS_SOURCES,
        CONNECT_SOURCES,
        CONNECT_TARGETS,
        TOKENED_SOURCES,
      ].map(Object.isFrozen),
    ).toEqual([true, true, true, true, true, true, true]);
    expect(() => {
      Reflect.apply(Array.prototype.splice, CORPUS_SOURCES, [0, 1]);
    }).toThrow(TypeError);
    expect(CORPUS_SOURCES).toEqual(["github", "slack", "linear", "notion"]);
  });

  it("refuses to derive an empty list", () => {
    expect(() => corpusSourcesOf({ manifests: [] })).toThrow(
      "CORPUS_SOURCES derived empty: no manifest qualifies for it",
    );
  });
});
