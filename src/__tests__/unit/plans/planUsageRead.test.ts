/**
 * {@link readPlanUsageReport} over plain injected readers — which stores it scans, and how one failed read stays in
 * the rows it feeds.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "../../../lib/result.js";
import {
  type PlanUsageReadDeps,
  productionPlanUsageReadDeps,
  readCodexAuthFileState,
  readCodexStoreState,
  readPlanUsageReport,
  sessionsRootSharers,
} from "../../../plans/planUsageRead.js";
import type { CodexStoreFiles } from "../../../plans/planUsageTypes.js";
import type { RegisteredPlan } from "../../../plans/types.js";

const NOW = "2026-11-06T12:00:00.000Z";
const FILES: CodexStoreFiles = {
  auth: { hasApiKey: false, hasTokens: true, readable: true },
  authFile: { kind: "present" },
  authStamp: { ctimeMs: 1, kind: "present", mtimeMs: 2, size: 3 },
  store: { kind: "present" },
};

/** A weekly register row. */
function row({ alias, over = {} }: { alias: string; over?: Partial<RegisteredPlan> }): RegisteredPlan {
  return {
    alias,
    allowance: { kind: "weekly-window" },
    provider: alias.startsWith("codex") ? "codex" : "claude",
    storeDir: `/stores/${alias}`,
    usageLimitPercent: 100,
    ...over,
  };
}

/** Readers over `plans`, recording every store scanned into `scanned`. */
function deps({
  over = {},
  plans,
  scanned,
}: {
  over?: Partial<PlanUsageReadDeps>;
  plans: readonly RegisteredPlan[];
  scanned: string[];
}): PlanUsageReadDeps {
  return {
    readClaudeProbes: () => Promise.resolve(ok([])),
    readClaudeSnapshot: () => ok(undefined),
    readCodexFiles: () => FILES,
    readCodexSignIns: ({ aliases }) =>
      Promise.resolve(ok(aliases.map((alias) => ({ alias, kind: "absent" as const })))),
    readRegister: () => Promise.resolve(ok(plans)),
    resolveSessionsRoot: ({ codexHome }) => `${codexHome}/sessions`,
    scanCodex: ({ codexHome }) => {
      scanned.push(codexHome);
      return { filesUnreadable: 0, gauge: undefined };
    },
    ...over,
  };
}

describe("readPlanUsageReport", () => {
  it("scans each measured weekly Codex store at its own directory, and never a paused or monthly one", async () => {
    const scanned: string[] = [];
    const plans = [
      row({ alias: "codex-one" }),
      row({ alias: "codex-two", over: { paused: { reason: "lapsed", sinceIso: NOW } } }),
      row({ alias: "codex-three", over: { allowance: { kind: "monthly-spend" } } }),
      row({ alias: "codex-four" }),
    ];

    const report = unwrap(await readPlanUsageReport({ deps: deps({ plans, scanned }), home: "/h", nowIso: () => NOW }));

    expect(scanned).toEqual(["/stores/codex-one", "/stores/codex-four"]);
    expect(report.rows.map((one) => one.usage.kind)).toEqual(["weekly", "paused", "not-measured", "weekly"]);
  });

  it("leaves Claude sign-ins unknown on a probe-store outage while the Codex rows still render", async () => {
    const plans = [row({ alias: "plan-one" }), row({ alias: "codex-one" })];
    const readers = deps({
      over: { readClaudeProbes: () => Promise.resolve(err("probe store down")) },
      plans,
      scanned: [],
    });

    const report = unwrap(await readPlanUsageReport({ deps: readers, home: "/h", nowIso: () => NOW }));

    expect(report.rows[0]!.signIn).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "probe store down",
      source: "claude-gauge-probe",
    });
    expect(report.rows[1]!.signIn).toMatchObject({ kind: "unknown", reason: "no live read of this store is filed" });
  });

  it("leaves Codex sign-ins unknown on a sign-in-store outage", async () => {
    const readers = deps({
      over: { readCodexSignIns: () => Promise.resolve(err("sign-in store down")) },
      plans: [row({ alias: "codex-one" })],
      scanned: [],
    });

    const report = unwrap(await readPlanUsageReport({ deps: readers, home: "/h", nowIso: () => NOW }));

    expect(report.rows[0]!.signIn).toEqual({
      kind: "unknown",
      observedAtIso: null,
      reason: "sign-in store down",
      source: "codex-live-read",
    });
  });

  it("keeps an unreadable Claude snapshot to its own row", async () => {
    const readers = deps({
      over: {
        readClaudeSnapshot: ({ alias }) => (alias === "plan-two" ? err("bad json") : ok(undefined)),
      },
      plans: [row({ alias: "plan-one" }), row({ alias: "plan-two" })],
      scanned: [],
    });

    const report = unwrap(await readPlanUsageReport({ deps: readers, home: "/h", nowIso: () => NOW }));

    expect(report.rows[0]!.usage).toMatchObject({ windows: [{ kind: "no-reading" }, { kind: "no-reading" }] });
    expect(report.rows[1]!.usage).toMatchObject({
      windows: [
        { kind: "unavailable", reason: "bad json" },
        { kind: "unavailable", reason: "bad json" },
      ],
    });
  });

  it("bounds the scan by the first clock read and stamps the report after the reads, so a reset passed mid-scan drops its number", async () => {
    const instants = ["2026-11-06T11:59:59.900Z", "2026-11-06T12:00:00.100Z"];
    const scanFrom: number[] = [];
    const readers = deps({
      over: {
        scanCodex: ({ nowMs }) => {
          scanFrom.push(nowMs);
          return {
            filesUnreadable: 0,
            gauge: {
              credits: undefined,
              limitId: "codex",
              observedAtIso: "2026-11-06T11:00:00.000Z",
              planType: "team",
              reached: undefined,
              reachedType: undefined,
              windows: [{ label: "weekly", resetAtIso: NOW, slot: "secondary", usedPercent: 77, windowMinutes: 10080 }],
            },
          };
        },
      },
      plans: [row({ alias: "codex-one" })],
      scanned: [],
    });

    const report = unwrap(await readPlanUsageReport({ deps: readers, home: "/h", nowIso: () => instants.shift()! }));

    expect(scanFrom).toEqual([Date.parse("2026-11-06T11:59:59.900Z")]);
    expect(report.observedAtIso).toBe("2026-11-06T12:00:00.100Z");
    expect(report.rows[0]!.usage).toMatchObject({ windows: [{ kind: "no-reading", label: "week" }] });
  });

  it("scans neither of two stores reading one sessions folder, and names the other plan on each row", async () => {
    const scanned: string[] = [];
    const plans = [row({ alias: "codex-one" }), row({ alias: "codex-two" }), row({ alias: "codex-three" })];
    const readers = deps({
      over: {
        resolveSessionsRoot: ({ codexHome }) => (codexHome === "/stores/codex-three" ? "/own" : "/shared/sessions"),
      },
      plans,
      scanned,
    });

    const report = unwrap(await readPlanUsageReport({ deps: readers, home: "/h", nowIso: () => NOW }));

    expect(scanned).toEqual(["/stores/codex-three"]);
    expect(report.rows[0]!.usage).toMatchObject({
      windows: [
        {
          kind: "no-reading",
          reason: "this store's sessions folder is also codex-two's, so its reading cannot be told to be this plan's",
        },
      ],
    });
    expect(report.rows[1]!.usage).toMatchObject({
      windows: [{ kind: "no-reading", reason: expect.stringContaining("also codex-one's") }],
    });
  });

  it("answers an empty report for an install with nothing registered", async () => {
    const report = unwrap(
      await readPlanUsageReport({ deps: deps({ plans: [], scanned: [] }), home: "/h", nowIso: () => NOW }),
    );

    expect(report).toEqual({ observedAtIso: NOW, rows: [] });
  });

  it("fails the whole report when the register cannot be read", async () => {
    const readers = deps({
      over: { readRegister: () => Promise.resolve(err("REGISTER_STORE_UNAVAILABLE")) },
      plans: [],
      scanned: [],
    });

    const read = await readPlanUsageReport({ deps: readers, home: "/h", nowIso: () => NOW });

    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr()).toEqual(["REGISTER_STORE_UNAVAILABLE"]);
  });
});

describe("sessionsRootSharers", () => {
  it("names every other alias reading the same folder, and none for a store reading its own", () => {
    const sharers = sessionsRootSharers({
      roots: [
        { alias: "codex-one", root: "/a" },
        { alias: "codex-two", root: "/a" },
        { alias: "codex-three", root: "/a" },
        { alias: "codex-four", root: "/b" },
      ],
    });

    expect(sharers.get("codex-one")).toEqual(["codex-two", "codex-three"]);
    expect(sharers.get("codex-three")).toEqual(["codex-one", "codex-two"]);
    expect(sharers.get("codex-four")).toEqual([]);
  });
});

describe("productionPlanUsageReadDeps' file readers", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "plan-usage-read-"));
  });
  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("reads a Codex store's own files by shape and stamp, and a missing store as missing", () => {
    const codexHome = join(root, "codex-one");
    mkdirSync(codexHome);
    const auth = '{"tokens":{"id_token":"FIXTURE"}}';
    writeFileSync(join(codexHome, "auth.json"), auth);
    const readers = productionPlanUsageReadDeps();

    const present = readers.readCodexFiles({ codexHome });
    const missing = readers.readCodexFiles({ codexHome: join(root, "absent") });

    expect(present.store).toEqual({ kind: "present" });
    expect(present.auth).toMatchObject({ hasApiKey: false, hasTokens: true, readable: true });
    expect(present.authStamp).toMatchObject({ kind: "present", size: auth.length });
    expect(missing.store).toEqual({ kind: "missing" });
    expect(missing.auth.readable).toBe(false);
    expect(missing.authStamp).toEqual({ kind: "absent" });
  });

  it("reads a store under a parent it may not search, and one it may not enter, as unreadable rather than missing", () => {
    const locked = join(root, "locked");
    const codexHome = join(locked, "codex-one");
    mkdirSync(codexHome, { recursive: true });
    const sealed = join(root, "sealed");
    mkdirSync(sealed);
    chmodSync(locked, 0o000);
    chmodSync(sealed, 0o000);
    try {
      expect(readCodexStoreState({ codexHome })).toEqual({
        kind: "unreadable",
        reason: "the store directory could not be read (EACCES)",
      });
      expect(readCodexStoreState({ codexHome: sealed })).toEqual({
        kind: "unreadable",
        reason: "the store directory could not be read (EACCES)",
      });
    } finally {
      chmodSync(locked, 0o700);
      chmodSync(sealed, 0o700);
    }
  });

  it("reads a self-referential auth.json as unreadable, a missing one as missing, and a real one as present", () => {
    const looped = join(root, "looped");
    mkdirSync(looped);
    symlinkSync("auth.json", join(looped, "auth.json"));
    const bare = join(root, "bare");
    mkdirSync(bare);
    const real = join(root, "real");
    mkdirSync(real);
    writeFileSync(join(real, "auth.json"), "{}");

    expect(productionPlanUsageReadDeps().readCodexFiles({ codexHome: looped }).authFile).toEqual({
      kind: "unreadable",
      reason: "auth.json could not be read (ELOOP)",
    });
    expect(readCodexAuthFileState({ codexHome: bare })).toEqual({ kind: "missing" });
    expect(readCodexAuthFileState({ codexHome: real })).toEqual({ kind: "present" });
  });

  it("resolves a symlinked sessions folder to the store it points into, and an absent one to its own path", () => {
    const target = join(root, "codex-two", "sessions");
    mkdirSync(target, { recursive: true });
    const linked = join(root, "codex-one");
    mkdirSync(linked);
    symlinkSync(target, join(linked, "sessions"));
    const readers = productionPlanUsageReadDeps();

    expect(readers.resolveSessionsRoot({ codexHome: linked })).toBe(
      readers.resolveSessionsRoot({ codexHome: join(root, "codex-two") }),
    );
    expect(readers.resolveSessionsRoot({ codexHome: join(root, "none") })).toBe(join(root, "none", "sessions"));
  });

  it("reads a path through a file as missing, as the filesystem says", () => {
    writeFileSync(join(root, "a-file"), "");

    expect(readCodexStoreState({ codexHome: join(root, "a-file", "codex-one") })).toEqual({ kind: "missing" });
  });

  it("finds no reading in a store with no rollout logs, and no snapshot in a home that never recorded one", () => {
    const readers = productionPlanUsageReadDeps();

    expect(readers.scanCodex({ codexHome: root, nowMs: Date.parse(NOW) })).toEqual({
      filesRead: 0,
      filesSkipped: 0,
      filesUnreadable: 0,
      gauge: undefined,
    });
    expect(unwrap(readers.readClaudeSnapshot({ alias: "plan-one", home: root }))).toBe(undefined);
  });
});
