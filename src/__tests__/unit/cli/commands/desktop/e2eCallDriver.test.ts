import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ElectronApplication } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { cachePaths } from "../../../../../cacheHome.js";
import { e2eLaunchArgs } from "../../../../../cli/commands/desktop/e2eApp.js";
import { generateFakeMicrophone, isWave, sayArgs } from "../../../../../cli/commands/desktop/e2eCallAudio.js";
import { cardFidelityFromCalls } from "../../../../../cli/commands/desktop/e2eCallCardFidelityRead.js";
import { INVENTORY_PAGES } from "../../../../../cli/commands/desktop/e2eCallCardInventory.js";
import { cardRead } from "../../../../../cli/commands/desktop/e2eCallCardReadScenario.js";
import { cardReadTyped } from "../../../../../cli/commands/desktop/e2eCallCardReadTypedScenario.js";
import { rendererKilled } from "../../../../../cli/commands/desktop/e2eCallCrashScenarios.js";
import { cleanupFatal, driveCallLeg, scenarioFor } from "../../../../../cli/commands/desktop/e2eCallDriver.js";
import {
  cursorAtEnd,
  desktopEventLogPath,
  liveLeaseIds,
  planLogPath,
  readAppended,
  transcriptEnd,
} from "../../../../../cli/commands/desktop/e2eCallEvidenceRead.js";
import { crashVoiceRenderer } from "../../../../../cli/commands/desktop/e2eCallInstance.js";
import { plannedSteps } from "../../../../../cli/commands/desktop/e2eCallLegPlan.js";
import { newTracker } from "../../../../../cli/commands/desktop/e2eCallPage.js";
import { queueSearch } from "../../../../../cli/commands/desktop/e2eCallQueueSearchScenario.js";
import { callLive, launcherVoice, nothingYet } from "../../../../../cli/commands/desktop/e2eCallScenarios.js";
import { type CallSession, readCallLogs } from "../../../../../cli/commands/desktop/e2eCallSession.js";
import { transcriptionFidelity } from "../../../../../cli/commands/desktop/e2eTranscriptFidelityScenario.js";
import { E2eCallErrors } from "../../../../../desktop/e2eCallErrors.js";
import { e2eCallSteps } from "../../../../../desktop/e2eCallPlan.js";
import { cardReadSteps } from "../../../../../desktop/e2eCardReadPlan.js";
import { OnCallHoldErrors } from "../../../../../desktop/onCallHold.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { callsDir } from "../../../../../talk/callStore.js";
import { armReopenProbe, readReopenProbe } from "../../../../../talk/e2eReopenProbe.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e2e-call-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("e2eLaunchArgs", () => {
  it("launches the walk with no fake media and no menu bar icon", () => {
    expect(e2eLaunchArgs({ checkout: "/c", fakeAudioPath: undefined, menuBar: false, userData: "/u" })).toEqual([
      "--slopweaver-desktop-e2e=/u",
      "--checkout=/c",
    ]);
  });

  it("adds the menu bar opt-in right beside the switch when asked, for a walk and a call alike", () => {
    expect(e2eLaunchArgs({ checkout: "/c", fakeAudioPath: undefined, menuBar: true, userData: "/u" })).toEqual([
      "--slopweaver-desktop-e2e=/u",
      "--slopweaver-desktop-e2e-menu-bar",
      "--checkout=/c",
    ]);
    expect(
      e2eLaunchArgs({ checkout: "/c", fakeAudioPath: "/m.wav", menuBar: true, userData: "/u" }).slice(0, 3),
    ).toEqual(["--slopweaver-desktop-e2e=/u", "--slopweaver-desktop-e2e-menu-bar", "--checkout=/c"]);
  });

  it("gives a call a file for its microphone, and replaces input only", () => {
    expect(e2eLaunchArgs({ checkout: "/c", fakeAudioPath: "/m.wav", menuBar: false, userData: "/u" })).toEqual([
      "--slopweaver-desktop-e2e=/u",
      "--checkout=/c",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--use-file-for-fake-audio-capture=/m.wav",
      "--disable-features=AudioServiceSandbox",
    ]);
  });
});

describe("the fake microphone", () => {
  it("renders only the words, as one argument", () => {
    expect(sayArgs({ path: "/m.wav", words: "hello; rm -rf" })).toEqual([
      "-o",
      "/m.wav",
      "--file-format=WAVE",
      "--data-format=LEI16@48000",
      "--channels=1",
      "hello; rm -rf",
    ]);
  });

  it("knows a WAVE header from anything else", () => {
    expect(isWave({ bytes: Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt ", "latin1") })).toBe(true);
    expect(isWave({ bytes: Buffer.from("ID3\u0004 not a wave", "latin1") })).toBe(false);
  });

  it("refuses a file the program wrote that is not a WAVE", () => {
    const path = join(dir, "m.wav");
    const written = generateFakeMicrophone({
      leadMs: 0,
      path,
      run: () => {
        writeFileSync(path, "not audio at all");
      },
      silenceMs: 1000,
      words: "test",
    });
    expect(unwrapErr(written).code).toBe("AUDIO_INVALID");
  });

  it("names a program that failed", () => {
    const written = generateFakeMicrophone({
      leadMs: 0,
      path: join(dir, "m.wav"),
      run: () => {
        throw new Error("say: no voice");
      },
      silenceMs: 1000,
      words: "test",
    });
    expect(unwrapErr(written).message).toBe("/usr/bin/say could not write the fake microphone's audio: say: no voice");
  });
});

describe("the evidence reads", () => {
  it("finds the console's log beside its run record and the shell's in the home directory's logs", () => {
    expect(planLogPath({ cacheRoot: "/c", checkout: "/Users/x/slopweaver" })).toMatch(
      /^\/c\/docs-site\/slopweaver-[0-9a-f]{8}\.log$/u,
    );
    expect(desktopEventLogPath({ user: "/Users/x" })).toBe("/Users/x/Library/Logs/Slopweaver/desktop-events.jsonl");
  });

  it("reads only what was appended past a cursor, and a restarted log from the top", () => {
    const path = join(dir, "console.log");
    writeFileSync(path, "before\n");
    const cursor = unwrap(cursorAtEnd({ path }));
    writeFileSync(path, "before\nafter\n");
    expect(unwrap(readAppended({ cursor }))).toBe("after\n");
    writeFileSync(path, "new\n");
    expect(unwrap(readAppended({ cursor }))).toBe("new\n");
  });

  it("reads a log that does not exist yet as empty", () => {
    expect(unwrap(readAppended({ cursor: unwrap(cursorAtEnd({ path: join(dir, "none.log") })) }))).toBe("");
  });

  it("reads the live leases of every console's hold", () => {
    const hold = join(cachePaths().docsSite, "slopweaver-0d68033b.hold");
    mkdirSync(join(hold, "calls"), { recursive: true });
    writeFileSync(join(hold, "calls", "a.json"), JSON.stringify({ callId: "lease-a", untilMs: 5000 }));
    writeFileSync(join(hold, "calls", "b.json"), JSON.stringify({ callId: "lease-b", untilMs: 100 }));
    const live = unwrap(liveLeaseIds({ home: dir, nowMs: 1000 }));
    rmSync(hold, { force: true, recursive: true });
    expect(live).toEqual(["lease-a"]);
  });

  it("reads a transcript with no file yet as not ended", () => {
    expect(unwrap(transcriptEnd({ callId: "a0000101-0000-4000-8000-000000000112", home: dir }))).toBeUndefined();
  });

  it("parses both logs' appended lines for a session", () => {
    const plan = join(dir, "console.log");
    const desktop = join(dir, "desktop-events.jsonl");
    writeFileSync(plan, "2026-10-25T19:00:00.000Z talk plan call old opened: open\n");
    writeFileSync(desktop, "");
    const session = {
      desktopCursor: { offset: 0, path: desktop },
      planCursor: { offset: 57, path: plan },
      seenCallIds: new Set<string>(),
    };
    writeFileSync(
      plan,
      "2026-10-25T19:00:00.000Z talk plan call old opened: open\n2026-10-25T19:05:00.000Z talk plan call new opened: open\n",
    );
    const logs = unwrap(readCallLogs({ session: session as unknown as CallSession }));
    // A call seen in the log stays named even if a later read fails.
    expect([logs.planEvents.map((event) => event.callId), logs.desktopEvents, [...session.seenCallIds]]).toEqual([
      ["new"],
      [],
      ["new"],
    ]);
  });
});

describe("crashVoiceRenderer", () => {
  it("crashes nothing unless exactly one voice window matched", async () => {
    const two = { evaluate: async () => 2 } as unknown as ElectronApplication;
    const unclear = unwrapErr(await crashVoiceRenderer({ app: two }));
    expect([unclear.code, unclear.message]).toEqual([
      "VOICE_WINDOW_UNCLEAR",
      "2 live voice windows matched /voice; exactly one is crashed, so none was",
    ]);
  });
});

describe("the leg", () => {
  it("starts every scenario with nothing seen", () => {
    expect([newTracker(), nothingYet({ view: undefined }).live]).toEqual([
      { pageErrors: [], planCallIds: [], transcriptCallIds: [] },
      false,
    ]);
  });

  it("drives each scenario with its own drive", () => {
    expect([
      scenarioFor({ id: "call-live" }),
      scenarioFor({ id: "renderer-killed" }),
      scenarioFor({ id: "queue-search" }),
      scenarioFor({ id: "card-read" }),
      scenarioFor({ id: "card-read-typed" }),
      scenarioFor({ id: "transcription-fidelity" }),
      scenarioFor({ id: "launcher-voice" }),
    ]).toEqual([callLive, rendererKilled, queueSearch, cardRead, cardReadTyped, transcriptionFidelity, launcherVoice]);
  });

  it("takes no lock and places nothing with no scenario asked", async () => {
    const leg = await driveCallLeg({
      app: "/nowhere/Slopweaver.app",
      checkout: "/c",
      consoles: ["/c"],
      context: undefined,
      firstIndex: 0,
      home: dir,
      menuBar: false,
      nonce: "n",
      out: dir,
      inventorySurfaces: [],
      note: () => undefined,
      progress: () => undefined,
      steps: [],
    });
    expect(leg).toEqual({ fatal: undefined, fidelityTrials: [], heldOnCall: false, results: [] });
  });

  // A leg removes a leftover reopen arm file only once it holds the leg's lock, so a
  // second leg refused the lock never closes the window a running `call-reopen` armed.
  it("leaves the reopen arm file alone when another leg holds the lock", async () => {
    const held = acquireOperationLock({ home: dir, key: "desktop-e2e-call", nowIso: new Date().toISOString() });
    expect(held.isOk()).toBe(true);
    armReopenProbe({
      home: dir,
      pid: process.pid,
      start: "Fri Nov  6 17:00:00 2026",
      untilIso: "2099-01-01T00:00:00.000Z",
    });
    const leg = await driveCallLeg({
      app: "/nowhere/Slopweaver.app",
      checkout: "/c",
      consoles: ["/c"],
      context: undefined,
      firstIndex: 0,
      home: dir,
      menuBar: false,
      inventorySurfaces: [],
      nonce: "n",
      note: () => undefined,
      out: dir,
      progress: () => undefined,
      steps: e2eCallSteps({ holdMinutes: 5 }).filter((step) => step.id === "call-live"),
    });
    expect(leg.results).toEqual([]);
    expect(leg.fatal!).toContain("holds the call leg's lock");
    expect(readReopenProbe({ home: dir })).toBe(
      JSON.stringify({ pid: process.pid, start: "Fri Nov  6 17:00:00 2026", untilIso: "2099-01-01T00:00:00.000Z" }),
    );
    unwrap(held).release();
  });

  // A probe the leg cannot remove, and a test call can still read, once threw past the
  // lock. A read-only folder is that state: the file reads, and no removal succeeds.
  it("places no call and releases the lock when a readable reopen probe cannot be removed", async () => {
    const probePath = stateHomePaths({ home: dir }).talkE2eReopenProbeJson;
    armReopenProbe({
      home: dir,
      pid: process.pid,
      start: "Fri Nov  6 17:00:00 2026",
      untilIso: "2099-01-01T00:00:00.000Z",
    });
    chmodSync(dirname(probePath), 0o500);
    const leg = await driveCallLeg({
      app: "/nowhere/Slopweaver.app",
      checkout: "/c",
      consoles: ["/c"],
      context: undefined,
      firstIndex: 0,
      home: dir,
      menuBar: false,
      inventorySurfaces: [],
      nonce: "n",
      note: () => undefined,
      out: dir,
      progress: () => undefined,
      steps: e2eCallSteps({ holdMinutes: 5 }).filter((step) => step.id === "call-live"),
    });
    chmodSync(dirname(probePath), 0o700);
    const after = acquireOperationLock({ home: dir, key: "desktop-e2e-call", nowIso: new Date().toISOString() });
    expect([leg.results, leg.heldOnCall, after.isOk()]).toEqual([[], false, true]);
    expect(leg.fatal!).toContain(`could not remove the reopen probe at ${probePath}, which a test call can still read`);
    unwrap(after).release();
  });

  // The owner's call's lease keeps cleanup's live count above zero, so the cleanup failure that outranks the
  // hold must still name it.
  it("names the hold a scenario met inside the cleanup failure that outranks it, and nothing when it met none", () => {
    const hold = OnCallHoldErrors.onCall({ liveCalls: 1, micsInUse: [] });
    const bare = cleanupFatal({ cleanup: "1 lease still live", hold: undefined });
    const named = cleanupFatal({ cleanup: "1 lease still live", hold });
    expect(bare).toBe(E2eCallErrors.cleanupFailed({ detail: "1 lease still live" }).message);
    expect(named).toBe(`${bare} — the scenario had already held on the owner's call (ON_CALL): ${hold.message}`);
  });
});

describe("the card scenarios' judgement", () => {
  const KEY = "ask:acme-fixture-card";
  const SPOKEN = "a0000101-0000-4000-8000-000000000112";
  const SILENT = "7a2d3c0f-2e3b-4d4c-9f50-6b7c8d9e0f1a";
  const BLANK = "8b3e4d10-3f4c-4e5d-a061-7c8d9e0f1a2b";
  const [spoken, typed] = cardReadSteps({ cardKeys: [KEY], surfaces: ["card-read", "card-read-typed"] });
  const line = ({ entry }: { entry: Record<string, unknown> }): string => `${JSON.stringify(entry)}\n`;

  beforeEach(() => {
    mkdirSync(callsDir({ home: dir }), { recursive: true });
    writeFileSync(
      join(callsDir({ home: dir }), `${SPOKEN}.jsonl`),
      line({
        entry: {
          atIso: "2026-11-02T05:00:00.000Z",
          final: true,
          id: "v1",
          kind: "segment",
          text: "I could not find it.",
          who: "voice",
        },
      }),
    );
    writeFileSync(join(callsDir({ home: dir }), `${SILENT}.jsonl`), "");
    // A blank or punctuation-only segment is no words, so no failure could be anchored to it.
    const blank = { atIso: "2026-11-02T05:00:00.000Z", final: true, id: "h-empty", kind: "segment", text: "   " };
    const dots = { ...blank, id: "v-dots", text: "...", who: "voice" };
    writeFileSync(
      join(callsDir({ home: dir }), `${BLANK}.jsonl`),
      line({ entry: { ...blank, who: "owner" } }) + line({ entry: dots }),
    );
  });

  it("judges each call that said anything, on the surface its scenario names", () => {
    const callIds = [SPOKEN, SILENT, BLANK];
    const seen = unwrap(cardFidelityFromCalls({ callIds, home: dir, nonce: "n", step: typed! }));
    expect(
      seen.map((one) => [one.callId, one.surface, one.cardRead, one.failures.map((failure) => failure.code)]),
    ).toEqual([[SPOKEN, "typed", false, ["CARD_NOT_READ"]]]);
    expect(unwrap(cardFidelityFromCalls({ callIds: [SPOKEN], home: dir, nonce: "n", step: spoken! }))[0]!.surface).toBe(
      "spoken",
    );
  });

  it("judges nothing for a scenario that reads no card", () => {
    const live = { ...spoken!, cardKey: undefined, id: "call-live" as const };
    expect(unwrap(cardFidelityFromCalls({ callIds: [SPOKEN], home: dir, nonce: "n", step: live }))).toEqual([]);
  });

  it("names a call id the store refuses", () => {
    expect(unwrapErr(cardFidelityFromCalls({ callIds: ["../x"], home: dir, nonce: "n", step: spoken! })).code).toBe(
      "EVIDENCE_UNREADABLE",
    );
  });

  it("plans a named card leg as given, reading no inventory and placing nothing more", async () => {
    const steps = [spoken!, typed!];
    const options = {
      app: "/nowhere",
      checkout: "/c",
      consoles: ["/c"],
      context: undefined,
      home: dir,
      inventorySurfaces: [],
      note: () => undefined,
      steps,
    };
    expect(unwrap(await plannedSteps({ options, waitMs: 0 }))).toBe(steps);
  });

  it("inventories the Queue before the Alignment page", () => {
    expect(INVENTORY_PAGES).toEqual(["/queue", "/alignment"]);
  });
});
