/**
 * The `codex` noun's manifest in `cli/manifests/codex.ts`: pins the verb set (there is deliberately no bare-noun row)
 * and each verb's six classification fields. `reset` is the one door-routed `external-write`, and the rest read or
 * write local state — `route` and `status` because they file what the app-server answered; `quota` because `clear`
 * deletes the cached record; `hooks` since `--trust` has Codex write its own config. `burn`, `gauge`, `hooks`,
 * `plugin-sync`, `route`, `rules-context`, `signin`, `status`, `usage` and `watch` act on a bare run, so none is
 * dry-parse safe. Usage strings are inline, and `hooks`' flags are checked against the real parser by
 * `../helpTruth.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { codexManifest } from "../../../../cli/manifests/codex.js";
import { classificationsOf } from "./_classification.js";

describe("codexManifest", () => {
  it("declares exactly these verbs, with no bare-noun row", () => {
    expect(Object.keys(codexManifest).toSorted()).toEqual([
      "burn",
      "gauge",
      "hooks",
      "plan",
      "plan-fallback",
      "plugin-sync",
      "quota",
      "reset",
      "review",
      "review-fallback",
      "route",
      "rules-context",
      "signin",
      "status",
      "supersede",
      "usage",
      "watch",
    ]);
  });

  it("classifies each verb by its own effect, door and diagnostic fields", () => {
    expect(classificationsOf({ manifest: codexManifest })).toEqual({
      burn: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      gauge: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      hooks: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      plan: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "plan-fallback": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "plugin-sync": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      quota: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      reset: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      review: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "review-fallback": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      route: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "rules-context": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      signin: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      status: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      supersede: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      usage: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      watch: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
