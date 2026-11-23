/**
 * The settings apply's send loop, called directly over the in-memory fake: each step is sent and confirmed in order,
 * a stop names what landed and GitHub's own words, and a step that would reach a repository no longer the one
 * planned is never sent.
 */
import { describe, expect, it } from "vitest";

import { applyRepoManifestSteps } from "../../../../../cli/commands/github/repoManifestApply.js";
import type { RepoManifestStep } from "../../../../../cli/commands/github/repoManifestPlan.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { manifestFake } from "../../../../githubRepoManifestFake.js";
import { manifestWorld } from "../../../../githubRepoManifestWorld.js";

const ADDRESS = { owner: "acme", repo: "widget" };

const STEPS: readonly RepoManifestStep[] = [
  { description: "A widget for acme", kind: "description" },
  { kind: "topics", topics: ["cli", "widgets"] },
  { enabled: true, kind: "dependabot-alerts" },
];

describe("applyRepoManifestSteps", () => {
  it("sends every step in order and reports each landed, naming what still waits", async () => {
    const world = manifestWorld();

    const outcome = unwrap(
      await applyRepoManifestSteps({
        address: ADDRESS,
        api: manifestFake({ world }),
        fullName: "acme/widget",
        id: 101,
        steps: STEPS,
        waiting: ["secret-scanning"],
      }),
    );

    expect(world.sent).toStrictEqual(["description", "topics", "dependabot-alerts"]);
    expect(outcome).toStrictEqual({
      fields: {
        landed: ["set the description", "set the topics", "turn Dependabot alerts on"],
        waiting: ["secret-scanning"],
      },
      line: "the settings manifest is applied to acme/widget; still waiting for public: secret-scanning",
    });
  });

  it("stops at a refused send, naming what landed before it and GitHub's words", async () => {
    const world = manifestWorld({ refused: "topics" });

    const error = unwrapErr(
      await applyRepoManifestSteps({
        address: ADDRESS,
        api: manifestFake({ world }),
        fullName: "acme/widget",
        id: 101,
        steps: STEPS,
        waiting: [],
      }),
    );

    expect(world.sent).toStrictEqual(["description", "topics"]);
    expect(error.code).toBe("WRITE_UNCONFIRMED");
    expect(error.message).toContain('stopped at "set the topics" (confirmed: set the description)');
    expect(error.message).toContain("GitHub said: send: ");
  });

  it("stops at a step whose read-back answered and does not show it, though every call answered", async () => {
    const world = manifestWorld({ ignored: "topics" });

    const error = unwrapErr(
      await applyRepoManifestSteps({
        address: ADDRESS,
        api: manifestFake({ world }),
        fullName: "acme/widget",
        id: 101,
        steps: STEPS,
        waiting: [],
      }),
    );

    expect(world.sent).toStrictEqual(["description", "topics"]);
    expect(error.message).toBe(
      'the settings apply on acme/widget stopped at "set the topics" (confirmed: set the description). Nothing is ' +
        "rolled back; preview again for a fresh digest over what is there now, never re-send the old approval",
    );
  });

  it("sends nothing to a repository whose id is no longer the one planned", async () => {
    const world = manifestWorld();

    const error = unwrapErr(
      await applyRepoManifestSteps({
        address: ADDRESS,
        api: manifestFake({ world }),
        fullName: "acme/widget",
        id: 7,
        steps: STEPS,
        waiting: [],
      }),
    );

    expect(world.sent).toStrictEqual([]);
    expect(error.message).toContain("before send: acme/widget is now repository id 101, not the planned 7");
  });

  it("reports an empty plan as applied without sending anything", async () => {
    const world = manifestWorld();

    const outcome = unwrap(
      await applyRepoManifestSteps({
        address: ADDRESS,
        api: manifestFake({ world }),
        fullName: "acme/widget",
        id: 101,
        steps: [],
        waiting: [],
      }),
    );

    expect(world.sent).toStrictEqual([]);
    expect(outcome.line).toBe("the settings manifest is applied to acme/widget");
  });
});
