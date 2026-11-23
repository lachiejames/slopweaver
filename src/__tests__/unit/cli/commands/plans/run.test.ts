/**
 * Every `plans` verb, driven through the real run function over injected seams.
 *
 * The register's file edge is a SEAM here — a plain function passed in, not a mock (`.claude/rules/testing.md`)
 * — so what each case asserts is the verb's own behaviour: which mutation it builds, which exit code it
 * returns, and what it prints. `store.test.ts` is where the filesystem half is proven.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { plansUsage } from "../../../../../cli/commands/plans/plansUsage.js";
import { type PlansDeps, productionPlansDeps, runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, unwrap } from "../../../../../lib/result.js";
import { PlanRegisterErrors } from "../../../../../plans/errors.js";
import { laneShapeReadOf } from "../../../../../plans/laneShape.js";
import {
  ALIGNED_ROWS_SNAPSHOT,
  codexARefusedDeps,
  SYNC_CODEX_ROWS as codexRows,
  DEFAULT_THRESHOLD_LINES,
  FUTURE_FIELD_SNAPSHOT,
  fresh,
  NOW,
  PAID_THROUGH_SNAPSHOT,
  PAUSED_ROW_SNAPSHOT,
  SYNC_READ_LIVE as readLive,
  recordingDeps,
  row,
  STATED_PAID_THROUGH,
  snapshotOf,
} from "./plansRunFixtures.js";

describe("plans verb dispatch", () => {
  it("builds an adopt mutation and nothing else", async () => {
    const recording = fresh();
    const code = await runPlansVerb({ deps: recordingDeps({ recording }), rest: ["--home", "/h"], verb: "adopt" });
    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([{ kind: "adopt" }]);
    // ONE call, not two: the reread a write needs happens inside the register's lock, behind this seam, so a
    // change verb never reads through the CLI's own read path — which is what keeps the two from racing.
    expect(recording.homes).toStrictEqual(["/h"]);
  });

  it("builds an add mutation carrying every field the command line gave it", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: [
        "--provider",
        "codex",
        "--plan",
        "codex-two",
        "--store-dir",
        "/x/two",
        "--email",
        "owner@example.com",
        "--pinned",
      ],
      verb: "add",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      {
        kind: "add",
        row: {
          alias: "codex-two",
          allowance: { kind: "weekly-window" },
          email: "owner@example.com",
          pinned: true,
          provider: "codex",
          storeDir: "/x/two",
          usageLimitPercent: 100,
        },
      },
    ]);
  });

  it("binds the usage limit --percent names from the instant the row is added, never a whole-plan interval", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--plan", "codex-two", "--store-dir", "/x/two", "--percent", "30"],
      verb: "add",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      {
        kind: "add",
        row: {
          alias: "codex-two",
          allowance: { kind: "weekly-window" },
          provider: "codex",
          storeDir: "/x/two",
          usageLimitPercent: 30,
        },
      },
    ]);
  });

  it("hands the owner the sign-in line for a newly registered CODEX destination", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--plan", "codex-two", "--store-dir", "/x/two"],
      verb: "add",
    });
    expect(recording.out.join("\n")).toContain("mkdir -p /x/two && CODEX_HOME=/x/two codex login");
    expect(recording.out.join("\n")).toContain("Two homes signed into the same account add no capacity.");
  });

  it("CREATES the Codex home it registers, so the sign-in does not fail on a missing directory", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--plan", "codex-three", "--store-dir", "/x/three"],
      verb: "add",
    });
    expect(recording.ensured).toEqual(["/x/three"]);
    expect(recording.out).toContain("plans: created the Codex home /x/three");
  });

  it("REFUSES the add when the Codex home cannot be created, and writes no row", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ ensure: err("ENOTDIR: not a directory"), recording }),
      rest: ["--provider", "codex", "--plan", "codex-three", "--store-dir", "/x/three"],
      verb: "add",
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recording.mutations).toEqual([]);
    expect(recording.diagnostics).toEqual([
      "plans: /x/three could not be created (ENOTDIR: not a directory), so no row was added — a Codex home nobody can sign into takes no work. Fix the path, then add again",
    ]);
  });

  it("creates the Codex home under --json too", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--plan", "codex-three", "--store-dir", "/x/three", "--json"],
      verb: "add",
    });
    expect(recording.ensured).toEqual(["/x/three"]);
  });

  it("prints no sign-in line for a Claude destination, whose store the Claude verbs provision", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-six", "--store-dir", "/s/six"],
      verb: "add",
    });
    expect(recording.out.join("\n")).not.toContain("codex login");
    expect(recording.ensured).toEqual([]);
    expect(recording.out.join("\n")).toContain("registered claude/plan-six at /s/six");
  });

  it("stamps a pause with the instant from the injected clock, not the wall clock", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--reason", "the subscription lapsed"],
      verb: "pause",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      {
        alias: "plan-one",
        kind: "pause",
        paused: { reason: "the subscription lapsed", sinceIso: NOW },
        provider: "claude",
      },
    ]);
  });

  it("builds resume and pin mutations addressing the named row", async () => {
    const resume = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording: resume }),
      rest: ["--provider", "codex", "--plan", "codex-two"],
      verb: "resume",
    });
    const pin = fresh();
    await runPlansVerb({
      deps: recordingDeps({ recording: pin }),
      rest: ["--provider", "claude", "--plan", "plan-one"],
      verb: "pin",
    });
    expect(resume.mutations).toStrictEqual([{ alias: "codex-two", kind: "resume", provider: "codex" }]);
    expect(pin.mutations).toStrictEqual([{ alias: "plan-one", kind: "pin", provider: "claude" }]);
  });

  it("reads without writing for list and for validate without a repair", async () => {
    const list = fresh();
    await runPlansVerb({ deps: recordingDeps({ recording: list }), rest: [], verb: "list" });
    const validate = fresh();
    await runPlansVerb({ deps: recordingDeps({ recording: validate }), rest: [], verb: "validate" });
    expect(list.mutations).toStrictEqual([]);
    expect(validate.mutations).toStrictEqual([]);
  });

  it("turns --repair-projection into the one mutation that regenerates the copy", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--repair-projection"],
      verb: "validate",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([{ kind: "repair-projection" }]);
  });
});

describe("plans exit codes", () => {
  it("refuses a missing required flag before the act phase, with the usage line", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude"],
      verb: "pause",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.mutations).toStrictEqual([]);
    expect(recording.diagnostics).toStrictEqual(["--plan is required", plansUsage({ verb: "pause" })]);
  });

  it("refuses a provider neither register understands, naming both that it does", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "gemini", "--plan", "plan-one"],
      verb: "pin",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics[0]).toBe("--provider must be one of claude, codex");
  });

  it("refuses a relative store directory, because a provider CLI resolves it against its own cwd", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "codex", "--plan", "codex-two", "--store-dir", "relative/.codex"],
      verb: "add",
    });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics[0]).toContain("--store-dir must be an absolute path");
  });

  it("reports a register it could not read as an error rather than an empty fleet", async () => {
    const recording = fresh();
    const deps: PlansDeps = {
      ...recordingDeps({ recording }),
      readRegister: async () => err(PlanRegisterErrors.registerUnreadable({ path: "/h/plans.json" })),
    };
    const code = await runPlansVerb({ deps, rest: [], verb: "list" });
    expect(code).toBe(EXIT_ERROR);
    expect(recording.diagnostics[0]).toContain("/h/plans.json");
  });

  it("reports a register with no destinations as expected-empty, not as a failure", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ read: snapshotOf({ plans: [] }), recording }),
      rest: [],
      verb: "list",
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(recording.out).toStrictEqual([
      ...DEFAULT_THRESHOLD_LINES,
      "plans list: this install has no registered destinations",
    ]);
  });

  it("reports a --provider filter that matches nothing as expected-empty", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ read: snapshotOf({ plans: [row()] }), recording }),
      rest: ["--provider", "codex"],
      verb: "list",
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("exits 0 from validate when the only diagnostic is that nothing has been adopted", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({
        read: snapshotOf({
          diagnostics: [{ code: "DERIVED_REGISTER", message: "nothing adopted yet" }],
          plans: [row()],
          revision: null,
          source: "derived",
        }),
        recording,
      }),
      rest: [],
      verb: "validate",
    });
    expect(code).toBe(EXIT_OK);
    expect(recording.out[0]).toBe("1 destination(s) registered, read from the derived picture");
  });

  it("exits 1 from validate on a diverged projection — the diagnostic verb finding something", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({
        read: snapshotOf({
          diagnostics: [{ code: "PROJECTION_DIVERGED", message: "the copy no longer matches" }],
          plans: [row()],
        }),
        recording,
      }),
      rest: [],
      verb: "validate",
    });
    expect(code).toBe(EXIT_ERROR);
    expect(recording.out[1]).toBe("note [PROJECTION_DIVERGED]: the copy no longer matches");
  });

  it("reports a write the register refused as an error, carrying its own message", async () => {
    const recording = fresh();
    const deps: PlansDeps = {
      ...recordingDeps({ recording }),
      writeRegister: async () => err(PlanRegisterErrors.unknownDestination({ alias: "plan-nine", provider: "claude" })),
    };
    const code = await runPlansVerb({ deps, rest: ["--provider", "claude", "--plan", "plan-nine"], verb: "pin" });
    expect(code).toBe(EXIT_ERROR);
    expect(recording.diagnostics[0]).toContain("plan-nine");
  });
});

describe("plans printing", () => {
  it("prints one aligned row per destination, its state, and its store", async () => {
    const recording = fresh();
    await runPlansVerb({ deps: recordingDeps({ read: ALIGNED_ROWS_SNAPSHOT, recording }), rest: [], verb: "list" });
    expect(recording.out).toStrictEqual([
      ...DEFAULT_THRESHOLD_LINES,
      "plan-one       Claude · CACHED first@example.com  pinned  weekly-window limit 100%  /s/one · lapse UNRECORDED",
      "codex-ambient  Codex · UNMAPPED                           weekly-window limit 100%  /x/ambient · paid through UNREAD (no sign-in file) · lapse UNRECORDED",
      "claude lane: lean — 1 standing (1 with no recorded lapse)",
      "codex lane: lean — 1 standing (1 with no recorded lapse)",
    ]);
  });

  it("reads each printed Codex store's own sign-in for its paid-through date, and no Claude store", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({
        paidThrough: { "/x/ambient": STATED_PAID_THROUGH },
        read: PAID_THROUGH_SNAPSHOT,
        recording,
      }),
      rest: [],
      verb: "list",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.paidThroughReads).toStrictEqual(["/x/ambient"]);
    // The table's last row sits above the two lane lines.
    expect(recording.out.at(-3)).toBe(
      `codex-ambient  Codex · UNMAPPED${" ".repeat(27)}weekly-window limit 100%  /x/ambient · paid through ` +
        "2026-02-02T03:04:05+00:00 (provider-stated, checked 2026-01-20T10:11:12+00:00) · lapses 2026-03-01T00:00:00Z DIFFERS",
    );
  });

  it("reads no sign-in for a --provider claude list, nor under --json", async () => {
    const read = snapshotOf({ plans: [row(), row({ alias: "codex-a", provider: "codex", storeDir: "/s/a" })] });
    const claudeOnly = fresh();
    const json = fresh();

    await runPlansVerb({
      deps: recordingDeps({ read, recording: claudeOnly }),
      rest: ["--provider", "claude"],
      verb: "list",
    });
    await runPlansVerb({ deps: recordingDeps({ read, recording: json }), rest: ["--json"], verb: "list" });

    expect(claudeOnly.out.length).toBeGreaterThan(0);
    expect(claudeOnly.paidThroughReads).toStrictEqual([]);
    expect(json.out).toStrictEqual([
      JSON.stringify({ ...read, lanes: laneShapeReadOf({ nowIso: NOW, plans: read.plans }) }),
    ]);
    expect(json.paidThroughReads).toStrictEqual([]);
  });

  it("names a paused row's reason and the command that undoes it, beneath the table", async () => {
    const recording = fresh();
    await runPlansVerb({ deps: recordingDeps({ read: PAUSED_ROW_SNAPSHOT, recording }), rest: [], verb: "list" });
    expect(recording.out[DEFAULT_THRESHOLD_LINES.length + 2]).toBe(
      `Claude · CACHED second@example.com is PAUSED since ${NOW} — the subscription lapsed. It is not probed ` +
        "and not routed, but every fleet count still lists it as paused; " +
        "`slopweaver plans resume --provider claude --plan plan-two` puts it back.",
    );
  });

  it("emits the whole snapshot and its judged lanes as one JSON document under --json, and no human lines", async () => {
    const recording = fresh();
    const read = snapshotOf({ plans: [row({ email: "first@example.com" })] });
    const code = await runPlansVerb({ deps: recordingDeps({ read, recording }), rest: ["--json"], verb: "list" });
    expect(code).toBe(EXIT_OK);
    expect(recording.out).toStrictEqual([
      JSON.stringify({ ...read, lanes: laneShapeReadOf({ nowIso: NOW, plans: read.plans }) }),
    ]);
    expect(recording.out[0]).toContain('"claude":{"host":"claude","lapsedPlans":0,"mode":"lean"');
  });

  it("carries a field no version here declares through --json, rather than dropping it", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ read: FUTURE_FIELD_SNAPSHOT, recording }),
      rest: ["--json"],
      verb: "list",
    });
    expect(recording.out[0]).toContain('"futureField":"keep me"');
  });

  it("prints the usage line and acts on nothing for --help", async () => {
    const recording = fresh();
    const code = await runPlansVerb({ deps: recordingDeps({ recording }), rest: ["--help"], verb: "add" });
    expect(code).toBe(EXIT_OK);
    expect(recording.out).toStrictEqual([plansUsage({ verb: "add" })]);
    expect(recording.mutations).toStrictEqual([]);
  });

  it("refuses a verb no spec declares, rather than silently reading the register", async () => {
    const recording = fresh();
    const code = await runPlansVerb({ deps: recordingDeps({ recording }), rest: [], verb: "delete" });
    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics[0]).toBe("unknown plans verb: delete");
    expect(recording.homes).toStrictEqual([]);
  });
});

describe("productionPlansDeps.ensureStoreDir over a real temp directory", () => {
  it("refuses a path that exists as a regular file, since the printed mkdir -p would fail on it", () => {
    const dir = mkdtempSync(join(tmpdir(), "plans-home-"));
    const file = join(dir, "codex-home-file");
    writeFileSync(file, "", "utf8");
    try {
      const result = productionPlansDeps().ensureStoreDir({ storeDir: file });
      expect(result._unsafeUnwrapErr()).toContain("EEXIST");
      expect(unwrap(productionPlansDeps().ensureStoreDir({ storeDir: dir }))).toBe("existed");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("creates an absent home as 0700 whatever the umask would have masked off", () => {
    const dir = mkdtempSync(join(tmpdir(), "plans-home-"));
    const home = join(dir, "new-codex-home");
    try {
      expect(unwrap(productionPlansDeps().ensureStoreDir({ storeDir: home }))).toBe("created");
      expect(statSync(home).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("refuses an existing directory they cannot write, since no sign-in could land in it", () => {
    const dir = mkdtempSync(join(tmpdir(), "plans-home-"));
    const locked = join(dir, "locked");
    mkdirSync(locked, { mode: 0o555 });
    try {
      const result = productionPlansDeps().ensureStoreDir({ storeDir: locked });
      expect(result._unsafeUnwrapErr()).toContain("EACCES");
    } finally {
      chmodSync(locked, 0o700);
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("plans sync-accounts", () => {
  it("records each signed-in store's own address, one exact change per row, and names the login for the rest", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ read: snapshotOf({ plans: codexRows }), readLive, recording }),
      rest: [],
      verb: "sync-accounts",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      { alias: "codex-a", email: "a@example.com", kind: "record-email", provider: "codex", storeDir: "/s/a" },
      { alias: "codex-b", email: "new@example.com", kind: "record-email", provider: "codex", storeDir: "/s/b" },
      { alias: "codex-c", email: "same@example.com", kind: "record-email", provider: "codex", storeDir: "/s/c" },
    ]);
    expect(recording.out).toStrictEqual([
      "codex-a: signed in as a@example.com — recorded (the row carried no address)",
      "codex-b: signed in as new@example.com — recorded (the row said old@example.com)",
      "codex-c: signed in as same@example.com — recorded (the row said same@example.com)",
      "codex-d: not signed in — run mkdir -p /s/d && CODEX_HOME=/s/d codex login",
    ]);
  });

  it("exits 1 and says which row did not land when the register refuses one change, landing the others", async () => {
    const recording = fresh();
    const deps = codexARefusedDeps({ recording });

    expect(await runPlansVerb({ deps, rest: [], verb: "sync-accounts" })).toBe(EXIT_ERROR);
    expect(recording.mutations.length).toBe(3);
    expect(recording.diagnostics[0]).toContain("codex-a was not updated");
  });

  it("writes nothing and reports each store as unread when no live read happened", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ read: snapshotOf({ plans: codexRows.slice(0, 1) }), recording }),
      rest: ["--json"],
      verb: "sync-accounts",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([]);
    expect(JSON.parse(recording.out[0]!)).toStrictEqual({
      accounts: [
        {
          alias: "codex-a",
          line: "codex-a: live read unavailable — no live read in this test",
          liveEmail: null,
          recordedEmail: null,
          state: "unreadable",
          storeDir: "/s/a",
          update: false,
          written: false,
        },
      ],
    });
  });

  it("answers expected-empty when the register carries no Codex row", async () => {
    const recording = fresh();
    expect(await runPlansVerb({ deps: recordingDeps({ recording }), rest: [], verb: "sync-accounts" })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });
});
