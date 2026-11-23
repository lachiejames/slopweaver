/**
 * `plans add` over a real symlink and the store-backed port with an in-memory row: a second row over one store
 * directory is refused, and an add whose alias check went stale before its write — the race a Codex review built,
 * a symlinked add committing in between — refuses at the write instead of landing past a user-set limit.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type PlansDeps,
  plansDepsOver,
  productionPlansDeps,
  runPlansVerb,
} from "../../../../../cli/commands/plans/run.js";
import { aliasedStore, type ResolveStore } from "../../../../../cli/commands/plans/storeAlias.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import type { PlanRegisterPort } from "../../../../../plans/port.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";
import { fresh, NOW, recordingDeps, row, snapshotOf } from "./plansRunFixtures.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home whose register holds one unrelated row, a real Codex home, and a symlink naming that same directory. */
function aliasedHome(): { home: string; link: string; real: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "plans-alias-")));
  homes.push(home);
  const real = join(home, "codex-real");
  const link = join(home, "codex-link");
  mkdirSync(real);
  symlinkSync(real, link);
  writeFileSync(
    stateHomePaths({ home }).plansJson,
    JSON.stringify({
      rows: [{ alias: "codex-one", provider: "codex", storeDir: join(home, "codex-one") }],
      version: 1,
    }),
    "utf8",
  );
  return { home, link, real };
}

/** The production seams over `port`, with diagnostics captured and any seam `over` names replaced. */
function depsOver({
  errors,
  over = {},
  port,
}: {
  errors: string[];
  over?: Partial<PlansDeps>;
  port: PlanRegisterPort;
}): PlansDeps {
  return {
    ...plansDepsOver({ port }),
    writeDiagnostic: (line) => {
      errors.push(line);
    },
    ...over,
  };
}

describe("aliasedStore", () => {
  const plans = [
    row({ alias: "low", provider: "codex", storeDir: "/s/real" }),
    row({ alias: "plan-one", provider: "claude", storeDir: "/s/claude" }),
  ];
  const resolved: Readonly<Record<string, string>> = {
    "/s/claude": "/d/shared",
    "/s/link": "/d/real",
    "/s/real": "/d/real",
    "/s/shared": "/d/shared",
  };
  const resolve: ResolveStore = ({ storeDir }) => resolved[storeDir];

  it("names the registered row of the same provider whose store is the same directory", () => {
    const added = row({ alias: "high", provider: "codex", storeDir: "/s/link" });
    expect(aliasedStore({ added, plans, resolve })!.alias).toBe("low");
  });

  it("names nothing for a store that resolves nowhere, the add's own alias, or another provider's row", () => {
    const absent = row({ alias: "high", provider: "codex", storeDir: "/s/absent" });
    const sameAlias = row({ alias: "low", provider: "codex", storeDir: "/s/link" });
    const otherProvider = row({ alias: "high", provider: "codex", storeDir: "/s/shared" });
    expect(aliasedStore({ added: absent, plans, resolve })).toBe(undefined);
    expect(aliasedStore({ added: sameAlias, plans, resolve })).toBe(undefined);
    expect(aliasedStore({ added: otherProvider, plans, resolve })).toBe(undefined);
  });
});

describe("plans add pins its write to the revision its alias check judged", () => {
  it("passes the read snapshot's revision to the write", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ read: snapshotOf({ plans: [], revision: 7 }), recording }),
      rest: ["--provider", "codex", "--plan", "high", "--store-dir", "/s/new"],
      verb: "add",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.judged).toStrictEqual([7]);
  });
});

describe("productionPlansDeps.resolveStore over a real temp directory", () => {
  it("answers one identity for every spelling of a directory, another for a different one, and nothing when absent", () => {
    const { home, link, real } = aliasedHome();
    const other = join(home, "codex-other");
    mkdirSync(other);
    const { resolveStore } = productionPlansDeps();
    const { dev, ino } = statSync(real);
    expect(resolveStore({ storeDir: real })).toBe(`${String(dev)}:${String(ino)}`);
    expect(resolveStore({ storeDir: link })).toBe(`${String(dev)}:${String(ino)}`);
    expect(resolveStore({ storeDir: other })).not.toBe(resolveStore({ storeDir: real }));
    expect(resolveStore({ storeDir: join(home, "absent") })).toBe(undefined);
  });
});

describe("plans add over one store directory spelled two ways", () => {
  it("refuses the symlinked spelling of a store another row already names, writing nothing", async () => {
    const { home, link, real } = aliasedHome();
    const port = memoryPlanRegisterPort();
    const errors: string[] = [];
    const deps = depsOver({ errors, port });
    const low = ["--provider", "codex", "--plan", "low", "--store-dir", real, "--percent", "10", "--home", home];
    const high = ["--provider", "codex", "--plan", "high", "--store-dir", link, "--home", home];

    expect(await runPlansVerb({ deps, rest: low, verb: "add" })).toBe(EXIT_OK);
    expect(await runPlansVerb({ deps, rest: high, verb: "add" })).toBe(EXIT_ERROR);

    expect(errors).toStrictEqual([
      `plans: ${link} is the same directory as the codex plan \`low\`'s store ${real}, so no row was added — two ` +
        "rows over one sign-in would let one spend past the other's usage limit. Change that plan's limit with " +
        "`plans set-usage-limit --provider codex --plan low` instead",
    ]);
    const after = unwrap(await port.read({ home }));
    expect(after.plans.map((plan) => plan.alias)).toStrictEqual(["codex-one", "low"]);
  });

  it("refuses at the write when a symlinked add committed between its alias check and its write", async () => {
    const { home, link, real } = aliasedHome();
    const port = memoryPlanRegisterPort();
    const errors: string[] = [];
    // The other process: its own check ran before `low` existed, so it passed, and it commits while ours waits.
    const racing: PlansDeps["readRegister"] = async (input) => {
      const judged = await plansDepsOver({ port }).readRegister(input);
      unwrap(
        await port.write({
          home,
          mutation: {
            kind: "add",
            row: {
              alias: "high",
              allowance: { kind: "weekly-window" },
              provider: "codex",
              storeDir: link,
              usageLimitPercent: 100,
            },
          },
          nowIso: NOW,
        }),
      );
      return judged;
    };
    const deps = depsOver({ errors, over: { readRegister: racing }, port });
    const low = ["--provider", "codex", "--plan", "low", "--store-dir", real, "--percent", "10", "--home", home];

    expect(await runPlansVerb({ deps, rest: low, verb: "add" })).toBe(EXIT_ERROR);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("the plan register changed while this change was being prepared");
    const after = unwrap(await port.read({ home }));
    expect(after.plans.map((plan) => plan.alias)).toStrictEqual(["codex-one", "high"]);
  });
});
