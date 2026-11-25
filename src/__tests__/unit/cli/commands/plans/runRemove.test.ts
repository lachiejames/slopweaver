/**
 * `plans remove`, `unpin`, `clear-lapse` and `set-email`, driven through the real run function: a missing selector is
 * refused before the register is touched, each command line becomes exactly one mutation, and — over the real
 * store-backed port with an in-memory row — a removed alias comes back only at its own store.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { plansUsage } from "../../../../../cli/commands/plans/plansUsage.js";
import { type PlansDeps, plansDepsOver, runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";
import { fakeCodexSync, fresh, NOW, recordingDeps } from "./plansRunFixtures.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("plans remove and its siblings — the command line", () => {
  it("refuses a missing --plan with the usage line, before any register read or write", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex"],
      verb: "remove",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics).toStrictEqual(["--plan is required", plansUsage({ verb: "remove" })]);
    expect(recording.homes).toStrictEqual([]);
    expect(recording.mutations).toStrictEqual([]);
  });

  it("asks for one remove stamped with the clock, in the requested home, and says the store stays", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--plan", "codex-ambient", "--home", "/h"],
      verb: "remove",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      { alias: "codex-ambient", kind: "remove", provider: "codex", removedAtIso: NOW },
    ]);
    expect(recording.homes).toStrictEqual(["/h"]);
    expect(recording.out[0]).toBe(
      "plans: removed codex/codex-ambient from the register; its store and sign-in stay on disk, and a seat " +
        "already running on it keeps running — 1 destination(s) now registered",
    );
  });

  it("maps unpin, clear-lapse and set-email to one mutation each", async () => {
    const recording = fresh();
    const where = ["--provider", "claude", "--plan", "plan-five"];
    await runPlansVerb({ deps: recordingDeps({ recording }), rest: where, verb: "unpin" });
    await runPlansVerb({ deps: recordingDeps({ recording }), rest: where, verb: "clear-lapse" });
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: [...where, "--email", "owner@example.com"],
      verb: "set-email",
    });

    expect(recording.mutations).toStrictEqual([
      { alias: "plan-five", kind: "unpin", provider: "claude" },
      { alias: "plan-five", kind: "clear-lapse", provider: "claude" },
      { alias: "plan-five", email: "owner@example.com", kind: "set-email", provider: "claude" },
    ]);
  });

  it("refuses set-email with no --email", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-five"],
      verb: "set-email",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics).toStrictEqual(["--email is required", plansUsage({ verb: "set-email" })]);
  });
});

describe("plans remove, then add — over the store-backed port", () => {
  it("removes one row, refuses its alias at another store, and restores it at its own", async () => {
    const home = mkdtempSync(join(tmpdir(), "plans-remove-"));
    homes.push(home);
    writeFileSync(
      stateHomePaths({ home }).plansJson,
      JSON.stringify({
        rows: [
          { alias: "codex-ambient", provider: "codex", storeDir: join(home, "codex") },
          { alias: "codex-one", provider: "codex", storeDir: join(home, "codex-one") },
        ],
        version: 1,
      }),
      "utf8",
    );
    const port = memoryPlanRegisterPort();
    const errors: string[] = [];
    const deps: PlansDeps = {
      ...plansDepsOver({ port }),
      // A Codex add installs into its home after publishing; faked, so this case writes no real cache root.
      syncCodexPluginHome: fakeCodexSync(),
      writeDiagnostic: (line) => {
        errors.push(line);
      },
    };
    const verb = async ({ args, name }: { args: readonly string[]; name: string }): Promise<number> =>
      runPlansVerb({ deps, rest: [...args, "--home", home], verb: name });

    expect(await verb({ args: ["--provider", "codex", "--plan", "codex-ambient"], name: "remove" })).toBe(EXIT_OK);
    const afterRemove = unwrap(await port.read({ home }));
    expect(afterRemove.plans.map((plan) => plan.alias)).toStrictEqual(["codex-one"]);

    const elsewhere = ["--provider", "codex", "--plan", "codex-ambient", "--store-dir", join(home, "other")];
    expect(await verb({ args: elsewhere, name: "add" })).toBe(EXIT_ERROR);
    expect(errors[0]).toContain(
      `so a different store takes a new alias — or re-add \`codex-ambient\` at ${join(home, "codex")}`,
    );

    const ownStore = ["--provider", "codex", "--plan", "codex-ambient", "--store-dir", join(home, "codex")];
    expect(await verb({ args: ownStore, name: "add" })).toBe(EXIT_OK);
    const restored = unwrap(await port.read({ home }));
    expect(restored.plans.map((plan) => plan.alias)).toStrictEqual(["codex-one", "codex-ambient"]);
    expect(Object.keys(restored.document)).not.toContain("removed");
  });
});
