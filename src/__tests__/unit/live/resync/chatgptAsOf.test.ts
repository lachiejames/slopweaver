/**
 * The scheduled ChatGPT resync stamps its verified-sync clock at the instant the real `chatgpt sync` certified, never
 * at the instant the pass finished — the real sync running inside the real runner, the store clock the one fake. A
 * finish-time stamp would let a 3 from a day-old export hold the freshness page current for almost another day.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type ChatgptExportVerbDeps, runChatgptSync } from "../../../../cli/commands/chatgpt/exportRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../cli/exitCodes.js";
import { ChatgptExportErrors } from "../../../../corpus/chatgpt/errors.js";
import { importChatgptExport } from "../../../../corpus/chatgpt/exportStore.js";
import { writeLiveAsOf } from "../../../../corpus/chatgpt/liveAsOf.js";
import { corpusFreshnessWindowMs } from "../../../../corpus/freshnessPolicy.js";
import { err, unwrap, unwrapErr } from "../../../../lib/result.js";
import { readResyncAsOf } from "../../../../live/resync/clock.js";
import { buildResyncPolicies, type ResyncPolicy } from "../../../../live/resync/policy.js";
import { type ResyncRunDeps, runResync } from "../../../../live/resync/run.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { FUTURE, syntheticExportAt, syntheticFileAlone } from "../../../chatgptFixture.js";

/** The synthetic export, its files dated past every clock here so it is dated at the instant it is taken in. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

/** The chatgpt corpus target. */
const CHATGPT = { kind: "corpus", source: "chatgpt" } as const;

/** The instant the export was taken in, and so the instant it is dated. */
const IMPORTED = "2026-10-16T03:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-as-of-"));
  dirs.push(dir);
  return dir;
}

/** The chatgpt row, whose one step is `chatgpt sync`. */
const chatgptPolicy = (): ResyncPolicy =>
  buildResyncPolicies({
    atlases: [],
    corpus: [
      { source: "chatgpt", subject: { kind: "export" }, windowMs: corpusFreshnessWindowMs({ source: "chatgpt" }) },
    ],
  }).policies[0]!;

/** The sync's own edges at one instant, its refresh leg answering `refreshExit`. */
function syncDeps({ nowIso, refreshExit }: { nowIso: string; refreshExit: number }): ChatgptExportVerbDeps {
  return {
    archive: {
      extractZipMember: ({ zipPath }) =>
        err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
      listZip: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
    },
    downloadsDir: tempDir(),
    nowIso: () => nowIso,
    runVerb: () => Promise.resolve(refreshExit),
  };
}

/** The runner's edges at one instant, its step the real `chatgpt sync` and its as-of read the real one. */
function runnerDeps({ home, nowIso, refreshExit }: { home: string; nowIso: string; refreshExit: number }): {
  deps: ResyncRunDeps;
  exits: number[];
} {
  const exits: number[] = [];
  const sync = syncDeps({ nowIso, refreshExit });
  return {
    deps: {
      now: () => nowIso,
      readAsOf: () => readResyncAsOf({ home, target: { kind: "corpus", source: "chatgpt" } }),
      readClock: () => Promise.resolve("2026-10-15T00:00:00.000Z"),
      runVerb: async (argv) => {
        const code = await runChatgptSync({ deps: sync, rest: argv.slice(4) });
        exits.push(code);
        return code;
      },
      takeRelayRecoveries: () => [],
      takeSignInWalls: () => [],
      takeWalkCollisions: () => [],
      takeWalkStops: () => [],
      writeOut: () => undefined,
    },
    exits,
  };
}

/** A home holding the synthetic export, synced by hand at {@link IMPORTED}. */
async function syncedHome(): Promise<string> {
  const home = tempDir();
  const code = await runChatgptSync({
    deps: syncDeps({ nowIso: IMPORTED, refreshExit: EXIT_OK }),
    rest: ["--from", FIXTURE, "--home", home],
  });
  expect(code).toBe(EXIT_OK);
  return home;
}

describe("the chatgpt resync's verified-sync clock", () => {
  it("stamps a 3 from a day-old export at the export's own instant, so the next day's pass finds it late", async () => {
    const home = await syncedHome();
    const { deps, exits } = runnerDeps({ home, nowIso: "2026-10-17T02:00:00.000Z", refreshExit: EXIT_OK });
    const result = await runResync({ blocker: null, deps, home, policy: chatgptPolicy(), previous: null });
    expect(exits).toEqual([EXIT_EXPECTED_EMPTY]);
    expect(result.attempt.outcome).toBe("succeeded");
    expect(result.state.lastSuccessAtIso).toBe(IMPORTED);
    expect(Date.parse(IMPORTED) + corpusFreshnessWindowMs({ source: "chatgpt" })).toBe(
      Date.parse("2026-10-17T03:00:00.000Z"),
    );
  });

  it("never lets a 0 that only filled in an older straggler renew the clock past the newest export", async () => {
    const home = await syncedHome();
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    const straggler = syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE });
    const { archive } = syncDeps({ nowIso: IMPORTED, refreshExit: EXIT_OK });
    unwrap(importChatgptExport({ archive, from: straggler, nowIso: "2026-10-16T20:00:00.000Z", root }));
    const { deps, exits } = runnerDeps({ home, nowIso: "2026-10-16T21:00:00.000Z", refreshExit: EXIT_OK });
    const result = await runResync({ blocker: null, deps, home, policy: chatgptPolicy(), previous: null });
    expect(exits).toEqual([EXIT_OK]);
    expect(result.attempt.outcome).toBe("succeeded");
    expect(result.state.lastSuccessAtIso).toBe(IMPORTED);
  });

  it("stamps a months-old archive taken in for the first time today at its own date, so the page reads stale", async () => {
    const home = tempDir();
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    const august = syntheticExportAt({ modifiedIso: "2026-08-01T00:00:00.000Z" });
    const { archive } = syncDeps({ nowIso: IMPORTED, refreshExit: EXIT_OK });
    unwrap(importChatgptExport({ archive, from: august, nowIso: IMPORTED, root }));
    const { deps, exits } = runnerDeps({ home, nowIso: IMPORTED, refreshExit: EXIT_OK });
    const result = await runResync({ blocker: null, deps, home, policy: chatgptPolicy(), previous: null });
    expect(exits).toEqual([EXIT_OK]);
    expect(result.attempt.outcome).toBe("succeeded");
    expect(result.state.lastSuccessAtIso).toBe("2026-08-01T00:00:00.000Z");
  });

  it("fails a pass whose certified instant dates an export that is no longer the newest held", async () => {
    const home = await syncedHome();
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    writeFileSync(
      join(root, "as-of.json"),
      `${JSON.stringify({ asOfIso: "2026-10-16T23:00:00.000Z", contentHash: "a".repeat(64), schemaVersion: 1 })}\n`,
    );
    const asOf = readResyncAsOf({ home, target: { kind: "corpus", source: "chatgpt" } });
    expect(unwrapErr(asOf)[0]).toContain("it dates export aaaaaaaaaaaa, which is not the newest held");
  });

  it("reads a live-only home's instant off the live copy's own record", () => {
    const home = tempDir();
    unwrap(writeLiveAsOf({ asOfIso: "2026-11-18T01:00:00.000Z", root: stateHomePaths({ home }).corpus.chatgptLive }));
    expect(unwrap(readResyncAsOf({ home, target: CHATGPT }))).toBe("2026-11-18T01:00:00.000Z");
  });

  it("takes the later of the live and export instants, and lets a live one stand beside a stale export record", async () => {
    const home = await syncedHome();
    const live = stateHomePaths({ home }).corpus.chatgptLive;
    unwrap(writeLiveAsOf({ asOfIso: "2026-10-15T00:00:00.000Z", root: live }));
    expect(unwrap(readResyncAsOf({ home, target: CHATGPT }))).toBe(IMPORTED);
    unwrap(writeLiveAsOf({ asOfIso: "2026-11-18T01:00:00.000Z", root: live }));
    expect(unwrap(readResyncAsOf({ home, target: CHATGPT }))).toBe("2026-11-18T01:00:00.000Z");
    writeFileSync(
      join(stateHomePaths({ home }).corpus.chatgptExports, "as-of.json"),
      `${JSON.stringify({ asOfIso: "2026-10-16T23:00:00.000Z", contentHash: "a".repeat(64), schemaVersion: 1 })}\n`,
    );
    expect(unwrap(readResyncAsOf({ home, target: CHATGPT }))).toBe("2026-11-18T01:00:00.000Z");
  });

  it("fails a pass whose live record is there but does not read", () => {
    const home = tempDir();
    const live = stateHomePaths({ home }).corpus.chatgptLive;
    unwrap(writeLiveAsOf({ asOfIso: "2026-11-18T01:00:00.000Z", root: live }));
    writeFileSync(join(live, "as-of.json"), "{");
    expect(unwrapErr(readResyncAsOf({ home, target: CHATGPT }))[0]).toContain("is not a record this writes");
  });

  it("answers no certified instant for every target but chatgpt", () => {
    expect(unwrap(readResyncAsOf({ home: tempDir(), target: { kind: "corpus", source: "slack" } }))).toBe(null);
    expect(unwrap(readResyncAsOf({ home: tempDir(), target: { kind: "atlas", platform: "clerk" } }))).toBe(null);
  });
});
