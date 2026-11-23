import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSpawnAccounts } from "../../../../../claude/spawnAccounts.js";
import { claudeCommandErrorLines } from "../../../../../cli/commands/claude/errors.js";
import {
  applyAndWrite,
  claudePauseCommand,
  claudeResumeCommand,
  parseClaudePauseArgs,
  parseClaudeResumeArgs,
} from "../../../../../cli/commands/claude/pauseRun.js";
import {
  rereadWatchPlans,
  watchOpeningLines,
  watchPlanChangeLines,
  watchPlans,
} from "../../../../../cli/commands/claude/watchPlans.js";
import { claudeManifest } from "../../../../../cli/manifests/claude.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../../../plans/thresholds.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

const ROWS = [
  { alias: "plan-one", email: "one@example.invalid", pinned: null, storeDir: "/tmp/one" },
  { alias: "plan-two", email: "two@example.invalid", pinned: null, storeDir: "/tmp/two" },
  { alias: "plan-three", email: "three@example.invalid", pinned: null, storeDir: "/tmp/three" },
];

const homes: string[] = [];

/** One register port per test, shared by every write and read inside it — the shape a verb run has. */
let port = memoryPlanRegisterPort();

beforeEach(() => {
  port = memoryPlanRegisterPort();
});

/** A throwaway Slopweaver home holding one accounts file, so no test ever reads the operator's own. */
function homeWith({ rows }: { rows: readonly unknown[] }): string {
  const home = mkdtempSync(join(tmpdir(), "claude-pause-"));
  homes.push(home);
  mkdirSync(join(home, "claude-accounts"), { recursive: true });
  writeFileSync(join(home, "claude-accounts", "accounts.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  return home;
}

function rowsIn({ home }: { home: string }): readonly Record<string, unknown>[] {
  return JSON.parse(readFileSync(join(home, "claude-accounts", "accounts.json"), "utf8")) as readonly Record<
    string,
    unknown
  >[];
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("the claude pause and resume verbs", () => {
  it("take the one argv parameter the CLI verb contract dispatches with", () => {
    expect(claudePauseCommand.length).toBe(1);
    expect(claudeResumeCommand.length).toBe(1);
  });

  it("are both reachable through the claude manifest", () => {
    expect(Object.keys(claudeManifest).includes("pause")).toBe(true);
    expect(Object.keys(claudeManifest).includes("resume")).toBe(true);
  });
});

describe("parseClaudePauseArgs", () => {
  it("reads the alias and the reason", () => {
    expect(unwrap(parseClaudePauseArgs({ rest: ["plan-one", "--reason", "a bounced charge"] }))).toStrictEqual({
      alias: "plan-one",
      reason: "a bounced charge",
    });
  });

  it("refuses a pause with no reason, because an unexplained pause is a forgotten one", () => {
    const error = unwrapErr(parseClaudePauseArgs({ rest: ["plan-one"] }));
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(claudeCommandErrorLines({ error })).toStrictEqual([
      'say what the plan is out for with --reason "<why>" — a pause nobody can explain is a forgotten one',
    ]);
  });

  it("reports both rejections at once rather than the first", () => {
    const error = unwrapErr(parseClaudePauseArgs({ rest: [] }));
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(claudeCommandErrorLines({ error })).toStrictEqual([
      'name the plan to pause: `slopweaver claude pause <alias> --reason "<why>"`',
      'say what the plan is out for with --reason "<why>" — a pause nobody can explain is a forgotten one',
    ]);
  });

  it("refuses two plans in one invocation and names the extra", () => {
    const error = unwrapErr(parseClaudePauseArgs({ rest: ["plan-one", "plan-two", "--reason", "x"] }));
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(claudeCommandErrorLines({ error })).toStrictEqual(["one plan at a time; also got plan-two"]);
  });
});

describe("parseClaudeResumeArgs", () => {
  it("reads the alias", () => {
    expect(unwrap(parseClaudeResumeArgs({ rest: ["plan-one"] }))).toStrictEqual({ alias: "plan-one" });
  });

  it("refuses an invocation naming no plan", () => {
    const error = unwrapErr(parseClaudeResumeArgs({ rest: [] }));
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(claudeCommandErrorLines({ error })).toStrictEqual([
      "name the plan to resume: `slopweaver claude resume <alias>`",
    ]);
  });
});

const PAUSE = {
  kind: "pause",
  paused: { reason: "a bounced charge", sinceIso: "2026-09-21T11:00:00.000Z" },
} as const;

describe("applyAndWrite against a real accounts file", () => {
  it("writes the pause onto the named row and leaves every other row alone", async () => {
    const home = homeWith({ rows: ROWS });
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" })).toBe(0);
    const written = rowsIn({ home });
    expect((written[0]!["paused"] as Record<string, unknown>)["reason"]).toBe("a bounced charge");
    expect(written[0]!["email"]).toBe("one@example.invalid");
    expect(written[1]!["paused"]).toBe(undefined);
  });

  it("writes NOTHING when the resulting configuration would be unusable", async () => {
    const home = homeWith({ rows: [{ ...ROWS[0], pinned: true }, ROWS[1], ROWS[2]] });
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" })).toBe(1);
    expect(rowsIn({ home })[0]!["paused"]).toBe(undefined);
  });

  it("puts a paused plan back, and refuses a second resume", async () => {
    const home = homeWith({ rows: ROWS });
    await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" });
    expect(await applyAndWrite({ alias: "plan-one", change: { kind: "resume" }, home, port, verb: "resume" })).toBe(0);
    expect(rowsIn({ home })[0]!["paused"]).toBe(undefined);
    expect(await applyAndWrite({ alias: "plan-one", change: { kind: "resume" }, home, port, verb: "resume" })).toBe(1);
  });

  it("refuses an emptied accounts file and leaves it as it was", async () => {
    const home = homeWith({ rows: [] });
    const before = readFileSync(join(home, "claude-accounts", "accounts.json"), "utf8");
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" })).toBe(1);
    expect(readFileSync(join(home, "claude-accounts", "accounts.json"), "utf8")).toBe(before);
  });

  it("exits 2 on a caller mistake, before any configuration is read", async () => {
    expect(await claudePauseCommand(["node", "cli", "claude", "pause"])).toBe(2);
    expect(await claudeResumeCommand(["node", "cli", "claude", "resume"])).toBe(2);
  });
});

/** A throwaway home that has ADOPTED a plan register, its projection generated alongside it. */
function registeredHomeWith({ rows }: { rows: readonly Record<string, unknown>[] }): string {
  const home = homeWith({ rows });
  const document = { rows: rows.map((row) => ({ ...row, provider: "claude" })), version: 1 };
  writeFileSync(join(home, "plans.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return home;
}

function registerRowsIn({ home }: { home: string }): readonly Record<string, unknown>[] {
  return (JSON.parse(readFileSync(join(home, "plans.json"), "utf8")) as { rows: readonly Record<string, unknown>[] })
    .rows;
}

describe("applyAndWrite on an install that has adopted the plan register", () => {
  // The incident: plan-four was paused into the projection alone, the register never heard, and the router —
  // which reads the register — kept booting spawns on it. The witness is what a SPAWN reads back.
  it("writes the pause into the register, so the spawn router's own read sees the plan paused", async () => {
    const home = registeredHomeWith({ rows: ROWS });
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" })).toBe(0);
    expect(registerRowsIn({ home })[0]!["paused"]).toStrictEqual(PAUSE.paused);
    expect(rowsIn({ home })[0]!["paused"]).toStrictEqual(PAUSE.paused);
    const spawnRead = unwrap(await readSpawnAccounts({ home, port }))!;
    expect(spawnRead.map((account) => [account.alias, account.paused?.reason])).toStrictEqual([
      ["plan-one", "a bounced charge"],
      ["plan-two", undefined],
      ["plan-three", undefined],
    ]);
  });

  it("puts a paused plan back in both files, and refuses a second resume", async () => {
    const home = registeredHomeWith({ rows: ROWS });
    await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" });
    expect(await applyAndWrite({ alias: "plan-one", change: { kind: "resume" }, home, port, verb: "resume" })).toBe(0);
    expect(registerRowsIn({ home })[0]!["paused"]).toBe(undefined);
    expect(rowsIn({ home })[0]!["paused"]).toBe(undefined);
    expect(await applyAndWrite({ alias: "plan-one", change: { kind: "resume" }, home, port, verb: "resume" })).toBe(1);
  });

  it("refuses a second pause and leaves the register byte-identical", async () => {
    const home = registeredHomeWith({ rows: ROWS });
    await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" });
    const before = readFileSync(join(home, "plans.json"), "utf8");
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" })).toBe(1);
    expect(readFileSync(join(home, "plans.json"), "utf8")).toBe(before);
  });

  // One plan is a whole fleet, and pausing it is the operator's deliberate stop: it lands, and the spawn read
  // afterwards sees it paused rather than refusing the register.
  it("reports a pause of a register's only Claude plan as the success it is", async () => {
    const home = registeredHomeWith({ rows: [ROWS[0]!] });
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" })).toBe(0);
    expect(registerRowsIn({ home })[0]!["paused"]).toStrictEqual(PAUSE.paused);
    const spawnRead = unwrap(await readSpawnAccounts({ home, port }))!;
    expect(spawnRead.map((account) => [account.alias, account.paused?.reason])).toStrictEqual([
      ["plan-one", "a bounced charge"],
    ]);
  });

  it("pauses the last live plan of several, so every plan is paused", async () => {
    const home = registeredHomeWith({ rows: [ROWS[0]!, ROWS[1]!] });
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" })).toBe(0);
    expect(await applyAndWrite({ alias: "plan-two", change: PAUSE, home, port, verb: "pause" })).toBe(0);
    expect(registerRowsIn({ home }).map((row) => row["paused"])).toStrictEqual([PAUSE.paused, PAUSE.paused]);
  });

  it("writes NOTHING when pausing would take out the pinned plan", async () => {
    const home = registeredHomeWith({ rows: [{ ...ROWS[0], pinned: true }, ROWS[1]!, ROWS[2]!] });
    const before = readFileSync(join(home, "plans.json"), "utf8");
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port, verb: "pause" })).toBe(1);
    expect(readFileSync(join(home, "plans.json"), "utf8")).toBe(before);
  });

  it("writes NEITHER file when the register's store is unreachable", async () => {
    const home = registeredHomeWith({ rows: ROWS });
    const register = readFileSync(join(home, "plans.json"), "utf8");
    const projection = readFileSync(join(home, "claude-accounts", "accounts.json"), "utf8");
    const outage = unavailablePlanRegisterPort();
    expect(await applyAndWrite({ alias: "plan-one", change: PAUSE, home, port: outage, verb: "pause" })).toBe(1);
    expect(readFileSync(join(home, "plans.json"), "utf8")).toBe(register);
    expect(readFileSync(join(home, "claude-accounts", "accounts.json"), "utf8")).toBe(projection);
  });
});

describe("watchPlans", () => {
  it("drops a paused plan from what the loop ticks and hands back its notice", async () => {
    const home = homeWith({
      rows: [
        { ...ROWS[0], paused: { reason: "a bounced charge", sinceIso: "2026-09-21T11:00:00.000Z" } },
        ROWS[1],
        ROWS[2],
      ],
    });
    const plans = unwrap(await watchPlans({ home, port }));
    expect(plans.live.map((account) => account.alias)).toStrictEqual(["plan-two", "plan-three"]);
    expect(plans.pausedLines).toStrictEqual([
      "plan-one is PAUSED since 2026-09-21T11:00:00.000Z — a bounced charge. It is not probed and not routed, " +
        "but every fleet count still lists it as paused; `slopweaver claude resume plan-one` puts it back.",
    ]);
  });

  // Each watch probe is a billed request, and a monthly-spend plan's spend is its measure.
  it("never probes a monthly-spend plan, carries it to be judged on its spend, and names it", async () => {
    const home = homeWith({ rows: [{ ...ROWS[0], allowance: { kind: "monthly-spend" } }, ROWS[1], ROWS[2]] });
    const plans = unwrap(await watchPlans({ home, port }));
    expect(plans.live.map((account) => account.alias)).toStrictEqual(["plan-two", "plan-three"]);
    expect(plans.monthly.map((account) => account.alias)).toStrictEqual(["plan-one"]);
    expect(plans.monthlyLines).toStrictEqual([
      "plan-one is a monthly-spend plan: never probed, judged each tick on its spend reading — " +
        "`slopweaver claude spend --plan plan-one` records one, evidence for an hour",
    ]);
  });

  // MEASURED: a standing watch started before plan-two's resume never sampled it, because it resolved
  // its plans once. The loop now re-reads every tick; this is the read it repeats, over a register changed under it.
  it("sees a plan resumed after the first read on the next read of the same home", async () => {
    const home = homeWith({
      rows: [
        { ...ROWS[0], paused: { reason: "a bounced charge", sinceIso: "2026-09-21T11:00:00.000Z" } },
        ROWS[1],
        ROWS[2],
      ],
    });
    const before = unwrap(await watchPlans({ home, port }));
    writeFileSync(join(home, "claude-accounts", "accounts.json"), `${JSON.stringify(ROWS, null, 2)}\n`, "utf8");
    const after = unwrap(await watchPlans({ home, port }));
    expect(after.live.map((account) => account.alias)).toStrictEqual(["plan-one", "plan-two", "plan-three"]);
    expect(watchPlanChangeLines({ next: after, previous: before })).toStrictEqual([
      "claude watch: plan-one is back in the register's live plans — now watching 3 plan(s)",
    ]);
    expect(watchPlanChangeLines({ next: after, previous: after })).toStrictEqual([]);
  });

  it("re-reads between ticks: a change is announced, and an unreadable register skips the tick over the last plans", async () => {
    const home = homeWith({ rows: ROWS });
    const before = unwrap(await watchPlans({ home, port }));
    const same = await rereadWatchPlans({ home, port, previous: before });
    expect(same.readable).toBe(true);
    expect(same.lines).toStrictEqual([]);
    writeFileSync(join(home, "claude-accounts", "accounts.json"), "{ truncated", "utf8");
    const broken = await rereadWatchPlans({ home, port, previous: before });
    expect(broken.readable).toBe(false);
    expect(broken.plans).toBe(before);
    expect(broken.lines).toHaveLength(1);
    expect(broken.lines[0]).toContain("— this tick is skipped; the next one reads it again");
  });

  it("skips a tick over the last plans when the register's store goes unreachable mid-watch", async () => {
    const home = homeWith({ rows: ROWS });
    const before = unwrap(await watchPlans({ home, port }));
    const outage = await rereadWatchPlans({ home, port: unavailablePlanRegisterPort(), previous: before });
    expect(outage.readable).toBe(false);
    expect(outage.plans).toBe(before);
    expect(outage.lines[0]).toContain("ECONNREFUSED");
  });

  it("watches a one-plan fleet", async () => {
    const home = homeWith({ rows: [ROWS[0]] });
    expect(unwrap(await watchPlans({ home, port })).live.map((account) => account.alias)).toStrictEqual(["plan-one"]);
  });

  it("keeps watching a fleet whose only plan is paused, so a resume is seen on a later read", async () => {
    const home = homeWith({ rows: [{ ...ROWS[0], paused: PAUSE.paused }] });
    const plans = unwrap(await watchPlans({ home, port }));
    expect(plans.live).toStrictEqual([]);
    expect(plans.pausedLines).toHaveLength(1);
  });

  it("reports the configuration's own refusal rather than an empty fleet", async () => {
    const home = homeWith({ rows: [{ alias: "UPPER", storeDir: "/tmp/upper" }] });
    expect(unwrapErr(await watchPlans({ home, port })).code).toBe("ACCOUNT_CONFIG_INVALID");
  });

  // At a SPAWN an unconfigured install means the ambient slot, which is a success. A watch run's whole
  // subject is the plans it ticks, so the same read has to end the run rather than loop over nothing
  // reporting the fleet healthy — the one place the two callers of `readSpawnAccounts` differ.
  it("refuses an install that registers no Claude destination, rather than watching an empty fleet", async () => {
    const home = mkdtempSync(join(tmpdir(), "claude-watch-unconfigured-"));
    homes.push(home);
    const error = unwrapErr(await watchPlans({ home, port }));
    expect(error.code).toBe("ACCOUNT_CONFIG_INVALID");
    expect(error.message).toContain("no fleet to watch");
  });
});

describe("watchOpeningLines", () => {
  const plans = {
    live: [{ alias: "plan-two", storeDir: "/tmp/two" }],
    monthly: [],
    monthlyLines: [],
    pausedLines: ["plan-one is PAUSED since 2026-09-21T11:00:00.000Z — a bounced charge."],
    thresholds: DEFAULT_THRESHOLDS.claude,
  };

  it("counts the LIVE plans in the standing line, not the configured ones", () => {
    expect(watchOpeningLines({ interval: 5, once: false, plans })).toStrictEqual([
      "claude watch: plan-one is PAUSED since 2026-09-21T11:00:00.000Z — a bounced charge.",
      "watching 1 plan(s) every 5 minute(s), rotating when one runs out. Pass --dry-run to report without " +
        "writing. Interrupt to stop.",
    ]);
  });

  it("still names a paused plan on a one-shot run, where the standing line means nothing", () => {
    expect(watchOpeningLines({ interval: 5, once: true, plans })).toStrictEqual([
      "claude watch: plan-one is PAUSED since 2026-09-21T11:00:00.000Z — a bounced charge.",
    ]);
  });

  it("says nothing at all on a one-shot run of a fleet with no paused plan", () => {
    expect(
      watchOpeningLines({
        interval: 5,
        once: true,
        plans: { ...plans, pausedLines: [] },
      }),
    ).toStrictEqual([]);
  });
});
