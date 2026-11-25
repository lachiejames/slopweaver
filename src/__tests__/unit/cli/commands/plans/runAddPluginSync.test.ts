/**
 * `plans add --provider codex` installs Slopweaver into the one home it has just registered, AFTER the row is
 * published, through the one-home plugin-sync seam (`cli/commands/plans/codexPluginSyncLive.ts`). The row stays
 * on a failed install, which prints on its own line and exits non-zero; a checkout that may not publish prints
 * `skipped` and exits zero. The seam is a plain fake here, so no case touches a Codex home or a cache root.
 */
import { describe, expect, it } from "vitest";

import { runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { CodexPluginSyncErrors } from "../../../../../codexPlugin/errors.js";
import { err } from "../../../../../lib/result.js";
import { PlanRegisterErrors } from "../../../../../plans/errors.js";
import { fresh, recordingDeps } from "./plansRunFixtures.js";

const CODEX_ADD = ["--provider", "codex", "--plan", "codex-two", "--store-dir", "/x/two", "--home", "/h"];

const INSTALLED_LINE =
  "codex plugin-sync: /x/two refreshed — no install yet; installed at /x/two/plugins/cache/personal/slopweaver/local; " +
  "trusted 2 hook(s)";

describe("plans add installs Slopweaver into the Codex home it registers", () => {
  it("syncs exactly the new home, once, after the register write, and prints the install last", async () => {
    const recording = fresh();
    const code = await runPlansVerb({ deps: recordingDeps({ recording }), rest: CODEX_ADD, verb: "add" });

    expect(code).toBe(EXIT_OK);
    expect(recording.events).toStrictEqual(["write-register", "sync-home"]);
    expect(recording.synced).toStrictEqual([{ codexHome: "/x/two", home: "/h" }]);
    expect(recording.out.at(-1)).toBe(INSTALLED_LINE);
    // The directory and sign-in lines the add always printed are still there, ahead of it.
    expect(recording.out).toContain("plans: created the Codex home /x/two");
    expect(recording.out.join("\n")).toContain("CODEX_HOME=/x/two codex login");
    expect(recording.diagnostics).toStrictEqual([]);
  });

  it("never syncs a Claude add", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-six", "--store-dir", "/s/six"],
      verb: "add",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.synced).toStrictEqual([]);
  });

  it("never syncs a change that is not an add", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--plan", "codex-two", "--reason", "card expired"],
      verb: "pause",
    });

    expect(recording.mutations.map((mutation) => mutation.kind)).toStrictEqual(["pause"]);
    expect(recording.synced).toStrictEqual([]);
  });

  it("never syncs when the register refused the row", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: {
        ...recordingDeps({ recording }),
        writeRegister: async () => err(PlanRegisterErrors.mutationConflict({ conflict: "the register moved" })),
      },
      rest: CODEX_ADD,
      verb: "add",
    });

    expect(code).toBe(EXIT_ERROR);
    expect(recording.synced).toStrictEqual([]);
  });

  // The review's counterexample: the register reports the projection failure only AFTER the row committed.
  it("still installs into the home when the row committed and only its projection failed, exiting non-zero", async () => {
    const recording = fresh();
    const projection = PlanRegisterErrors.projectionWriteFailed({
      cause: new Error("EACCES"),
      committedRevision: 4,
      paths: ["/h/plans.json"],
    });
    const code = await runPlansVerb({
      deps: { ...recordingDeps({ recording }), writeRegister: async () => err(projection) },
      rest: CODEX_ADD,
      verb: "add",
    });

    expect(code).toBe(EXIT_ERROR);
    expect(recording.synced).toStrictEqual([{ codexHome: "/x/two", home: "/h" }]);
    expect(recording.diagnostics).toStrictEqual([`plans: ${projection.message}`, INSTALLED_LINE]);
  });

  it("keeps the published row when the install fails, printing the failure on its own line and exiting non-zero", async () => {
    const recording = fresh();
    const failed = CodexPluginSyncErrors.addFailed({ detail: "exit 1" });
    const code = await runPlansVerb({
      deps: recordingDeps({
        recording,
        sync: { did: "synced", homes: [{ codexHome: "/x/two", did: "failed", error: failed }] },
      }),
      rest: CODEX_ADD,
      verb: "add",
    });

    expect(code).toBe(EXIT_ERROR);
    // One write, the add, and no compensating remove: the row stands.
    expect(recording.mutations.map((mutation) => mutation.kind)).toStrictEqual(["add"]);
    expect(recording.diagnostics).toStrictEqual([
      "codex plugin-sync: /x/two FAILED [ADD_FAILED] — codex plugin add failed: exit 1",
    ]);
    expect(recording.out.join("\n")).not.toContain("codex plugin-sync:");
    expect(recording.out.join("\n")).toContain("CODEX_HOME=/x/two codex login");
  });

  it("exits zero and says so when this checkout may not publish, installing nothing", async () => {
    const recording = fresh();
    const why = "/w/feature is not a declared main checkout, and only one publishes the Codex install";
    const code = await runPlansVerb({
      deps: recordingDeps({ recording, sync: { did: "skipped", why } }),
      rest: CODEX_ADD,
      verb: "add",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.mutations.map((mutation) => mutation.kind)).toStrictEqual(["add"]);
    expect(recording.out.at(-1)).toBe(`codex plugin-sync: skipped — ${why}`);
  });

  it("keeps stdout one JSON document under --json, sending the install line to diagnostics", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: [...CODEX_ADD, "--json"],
      verb: "add",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.out).toHaveLength(1);
    expect(Object.keys(JSON.parse(recording.out[0]!) as object)).toContain("plans");
    expect(recording.diagnostics).toStrictEqual([INSTALLED_LINE]);
  });
});
