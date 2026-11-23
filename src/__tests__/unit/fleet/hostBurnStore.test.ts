/**
 * The fleet burn's scan over a real transcript tree in a throwaway directory: a line the transcript reader will not
 * hold is named as a problem, so Claude reads as a lower bound with no projection rather than a smaller whole figure.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanFleetBurn } from "../../../fleet/hostBurnStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { MAX_LINE_BYTES } from "../../../transcripts/source.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

/** The instant the scan is taken at. */
const NOW_ISO = "2026-10-08T12:00:00.000Z";

/** One assistant turn of 335 tokens, inside the window. */
const TURN = JSON.stringify({
  message: {
    id: "m1",
    usage: { cache_creation_input_tokens: 20, cache_read_input_tokens: 300, input_tokens: 10, output_tokens: 5 },
  },
  timestamp: "2026-10-08T11:00:00.000Z",
  type: "assistant",
});

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home, a Codex home and a projects tree holding one session with these lines, written inside the window. */
function tree({ lines }: { lines: readonly string[] }): { home: string; projectsDir: string; codexHome: string } {
  const root = mkdtempSync(join(tmpdir(), "burn-"));
  dirs.push(root);
  const projectsDir = join(root, "projects");
  const session = join(projectsDir, "-w", "s1.jsonl");
  mkdirSync(join(projectsDir, "-w"), { recursive: true });
  mkdirSync(join(root, "home"));
  mkdirSync(join(root, "codex"));
  // The register names the Codex home explicitly: a plan comes only from a sign-in, never from what the machine holds.
  const plansJson = stateHomePaths({ home: join(root, "home") }).plansJson;
  mkdirSync(dirname(plansJson), { recursive: true });
  writeFileSync(
    plansJson,
    JSON.stringify({ rows: [{ alias: "codex-a", provider: "codex", storeDir: join(root, "codex") }], version: 1 }),
    "utf8",
  );
  writeFileSync(session, `${lines.join("\n")}\n`);
  const writtenAt = new Date("2026-10-08T11:30:00.000Z");
  utimesSync(session, writtenAt, writtenAt);
  return { codexHome: join(root, "codex"), home: join(root, "home"), projectsDir };
}

describe("scanFleetBurn, Claude", () => {
  it("measures a readable transcript whole, with a seven-day amount", async () => {
    const { home, projectsDir } = tree({ lines: [TURN] });
    const report = await scanFleetBurn({ home, nowIso: NOW_ISO, port: memoryPlanRegisterPort(), projectsDir });
    expect(report.hosts.claude).toEqual({
      activeSessions: 0,
      kind: "measured",
      outputTokens: 5,
      projectedWeekTokens: 2345,
      sessions: 1,
      totalTokens: 335,
    });
  });

  it("reads a subagent written inside the window under a parent last written before it", async () => {
    const { home, projectsDir } = tree({ lines: [] });
    const parent = join(projectsDir, "-w", "s1.jsonl");
    const longAgo = new Date("2026-10-06T00:00:00.000Z");
    utimesSync(parent, longAgo, longAgo);
    mkdirSync(join(projectsDir, "-w", "s1", "subagents"), { recursive: true });
    writeFileSync(join(projectsDir, "-w", "s1", "subagents", "agent-a.jsonl"), `${TURN}\n`);
    const report = await scanFleetBurn({ home, nowIso: NOW_ISO, port: memoryPlanRegisterPort(), projectsDir });
    expect(report.hosts.claude).toEqual({
      activeSessions: 0,
      kind: "measured",
      outputTokens: 5,
      projectedWeekTokens: 2345,
      sessions: 1,
      totalTokens: 335,
    });
  });

  it("is partial, naming the directory, when a project directory will not list", async () => {
    const { home, projectsDir } = tree({ lines: [TURN] });
    const blocked = join(projectsDir, "-blocked");
    mkdirSync(blocked);
    chmodSync(blocked, 0o000);
    try {
      const report = await scanFleetBurn({ home, nowIso: NOW_ISO, port: memoryPlanRegisterPort(), projectsDir });
      expect(report.hosts.claude).toEqual({
        activeSessions: 0,
        kind: "partial",
        outputTokens: 5,
        problems: [`${blocked}: could not be listed, so its transcripts were not read`],
        sessions: 1,
        totalTokens: 335,
      });
    } finally {
      chmodSync(blocked, 0o700);
    }
  });

  it("is partial, naming the line, when one line is past the reader's limit", async () => {
    // Well past the limit: the reader judges the fragment it holds between reads, so a line ending inside the read
    // that crossed the limit would come back whole (`drainLines`, `src/transcripts/source.ts`).
    const oversized = `{"pad":"${"x".repeat(MAX_LINE_BYTES + 4 * 1024 * 1024)}"}`;
    const { home, projectsDir } = tree({ lines: [TURN, oversized] });
    const report = await scanFleetBurn({ home, nowIso: NOW_ISO, port: memoryPlanRegisterPort(), projectsDir });
    expect(report.hosts.claude).toEqual({
      activeSessions: 0,
      kind: "partial",
      outputTokens: 5,
      problems: [
        `${join(projectsDir, "-w", "s1.jsonl")}: line 2 is over the reader's ${String(MAX_LINE_BYTES)}-byte limit and was not read`,
      ],
      sessions: 1,
      totalTokens: 335,
    });
  });
});

describe("scanFleetBurn, Codex", () => {
  it("is a measured zero for a home that has run nothing yet", async () => {
    const { home, projectsDir } = tree({ lines: [TURN] });
    const report = await scanFleetBurn({ home, nowIso: NOW_ISO, port: memoryPlanRegisterPort(), projectsDir });
    expect(report.hosts.codex).toEqual({
      activeSessions: 0,
      kind: "measured",
      outputTokens: 0,
      projectedWeekTokens: 0,
      sessions: 0,
      totalTokens: 0,
    });
  });

  it("is partial, naming the directory, when part of the sessions tree will not list", async () => {
    const { home, projectsDir, codexHome } = tree({ lines: [TURN] });
    const walled = join(codexHome, "sessions", "2026");
    mkdirSync(walled, { recursive: true });
    chmodSync(walled, 0o000);
    try {
      const report = await scanFleetBurn({ home, nowIso: NOW_ISO, port: memoryPlanRegisterPort(), projectsDir });
      expect(report.hosts.codex).toEqual({
        activeSessions: 0,
        kind: "partial",
        outputTokens: 0,
        problems: [`${walled}: could not be listed (EACCES: permission denied, scandir '${walled}')`],
        sessions: 0,
        totalTokens: 0,
      });
    } finally {
      chmodSync(walled, 0o700);
    }
  });

  it("is partial, naming the rollout, when a day directory lists but will not let its rollout be statted", async () => {
    const { home, projectsDir, codexHome } = tree({ lines: [TURN] });
    const day = join(codexHome, "sessions", "2026", "10", "08");
    mkdirSync(day, { recursive: true });
    const rollout = join(day, "rollout-a.jsonl");
    writeFileSync(rollout, "\n");
    chmodSync(day, 0o400);
    try {
      const report = await scanFleetBurn({ home, nowIso: NOW_ISO, port: memoryPlanRegisterPort(), projectsDir });
      expect(report.hosts.codex).toEqual({
        activeSessions: 0,
        kind: "partial",
        outputTokens: 0,
        problems: [`${rollout}: could not be statted (EACCES: permission denied, stat '${rollout}')`],
        sessions: 0,
        totalTokens: 0,
      });
    } finally {
      chmodSync(day, 0o700);
    }
  });

  it("is unavailable, naming the outage, when the register store cannot be read — never a measured zero", async () => {
    const { home, projectsDir } = tree({ lines: [TURN] });
    const report = await scanFleetBurn({ home, nowIso: NOW_ISO, port: unavailablePlanRegisterPort(), projectsDir });
    expect(report.hosts.codex.kind).toBe("unavailable");
    expect(JSON.stringify(report.hosts.codex)).toContain("ECONNREFUSED");
  });
});
