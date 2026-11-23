/**
 * `plans set-store-dir`, driven through the real run function: the path is refused unless absolute, before the
 * register is touched; the move is judged by the same filesystem alias check as `add` and pinned to the revision it
 * judged; a path not yet on disk is accepted and never created; and — over the store-backed port with an in-memory
 * row — a moved row keeps its alias while a move onto another row's directory, through a symlink, writes nothing.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { plansUsage } from "../../../../../cli/commands/plans/plansUsage.js";
import { type PlansDeps, plansDepsOver, runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";
import { fresh, recordingDeps, row, snapshotOf } from "./plansRunFixtures.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("plans set-store-dir — the command line", () => {
  it("refuses a missing --store-dir with the usage line, before any register read or write", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one"],
      verb: "set-store-dir",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics).toStrictEqual(["--store-dir is required", plansUsage({ verb: "set-store-dir" })]);
    expect(recording.homes).toStrictEqual([]);
  });

  it("refuses a relative --store-dir, which a provider CLI would resolve against its own cwd", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--store-dir", "~/.claude-two"],
      verb: "set-store-dir",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics[0]).toBe(
      "--store-dir must be an absolute path, because a provider CLI resolves it against its own cwd",
    );
    expect(recording.mutations).toStrictEqual([]);
  });

  it("asks for one move pinned to the revision it judged, creating no directory, and says to sign in again", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ read: snapshotOf({ plans: [row()], revision: 4 }), recording }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--store-dir", "/not/yet/copied"],
      verb: "set-store-dir",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      { alias: "plan-one", kind: "set-store-dir", provider: "claude", storeDir: "/not/yet/copied" },
    ]);
    expect(recording.judged).toStrictEqual([4]);
    expect(recording.ensured).toStrictEqual([]);
    expect(recording.out[0]).toBe(
      "plans: moved claude/plan-one to /not/yet/copied, keeping its alias; sign in again there, since the store " +
        "path picks the sign-in — 1 destination(s) now registered",
    );
  });

  it("refuses a move onto the directory another row of that provider names, writing nothing", async () => {
    const recording = fresh();
    const plans = [row(), row({ alias: "plan-two", storeDir: "/s/two" })];
    const code = await runPlansVerb({
      deps: recordingDeps({ read: snapshotOf({ plans }), recording, resolved: { "/s/link": "d1", "/s/two": "d1" } }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--store-dir", "/s/link"],
      verb: "set-store-dir",
    });

    expect(code).toBe(EXIT_ERROR);
    expect(recording.diagnostics).toStrictEqual([
      "plans: /s/link is the same directory as the claude plan `plan-two`'s store /s/two, so `plan-one` was not " +
        "moved — two rows over one sign-in would let one spend past the other's usage limit. Change that plan's " +
        "limit with `plans set-usage-limit --provider claude --plan plan-two` instead",
    ]);
    expect(recording.mutations).toStrictEqual([]);
  });

  it("does not judge a move by the row's own current directory", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording, resolved: { "/s/link": "d1", "/s/one": "d1" } }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--store-dir", "/s/link"],
      verb: "set-store-dir",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toHaveLength(1);
  });
});

describe("plans set-store-dir — over the store-backed port", () => {
  /** A home whose register holds two Codex rows, a real directory the second names, and a symlink to it. */
  function movingHome(): { home: string; link: string; real: string } {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "plans-move-")));
    homes.push(home);
    const real = join(home, "codex-two");
    const link = join(home, "codex-link");
    mkdirSync(real);
    symlinkSync(real, link);
    writeFileSync(
      stateHomePaths({ home }).plansJson,
      JSON.stringify({
        rows: [
          { alias: "codex-one", email: "one@example.com", provider: "codex", storeDir: join(home, "old-one") },
          { alias: "codex-two", provider: "codex", storeDir: real },
        ],
        version: 1,
      }),
      "utf8",
    );
    return { home, link, real };
  }

  it("moves a row under its own alias, and refuses a move onto another row's directory through a symlink", async () => {
    const { home, link, real } = movingHome();
    const port = memoryPlanRegisterPort();
    const errors: string[] = [];
    const deps: PlansDeps = {
      ...plansDepsOver({ port }),
      writeDiagnostic: (line) => {
        errors.push(line);
      },
    };
    const move = async ({ storeDir }: { storeDir: string }): Promise<number> =>
      runPlansVerb({
        deps,
        rest: ["--provider", "codex", "--plan", "codex-one", "--store-dir", storeDir, "--home", home],
        verb: "set-store-dir",
      });

    expect(await move({ storeDir: link })).toBe(EXIT_ERROR);
    expect(errors[0]).toContain(`so \`codex-one\` was not moved`);
    const untouched = unwrap(await port.read({ home }));
    expect(untouched.plans.map((plan) => plan.storeDir)).toStrictEqual([join(home, "old-one"), real]);

    const newOne = join(home, "new-one");
    expect(await move({ storeDir: newOne })).toBe(EXIT_OK);
    const moved = unwrap(await port.read({ home }));
    expect(moved.plans.map((plan) => [plan.alias, plan.storeDir, plan.email])).toStrictEqual([
      ["codex-one", newOne, undefined],
      ["codex-two", real, undefined],
    ]);
  });
});
