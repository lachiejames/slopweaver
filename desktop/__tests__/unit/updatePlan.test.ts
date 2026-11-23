/**
 * The one-click update, decided: the console's offer off the wire, the update waited on across the quit, the record
 * read back, the call owed a restart, the launch, and the menu bar's item.
 */
import { describe, expect, it } from "vitest";

import {
  decodePendingUpdate,
  decodeResumeVoice,
  decodeUpdateOutcome,
  lostOutcome,
  parseUpdateOffer,
  pendingVerdict,
  RESUME_WITHIN_MS,
  resumeDue,
  trayOutcomeLine,
  trayUpdateItem,
  UPDATE_GIVE_UP_MS,
  updateLaunch,
} from "../../src/updatePlan";

const STARTED = "2026-10-10T03:30:00.000Z";
const STARTED_MS = Date.parse(STARTED);
const SHA = "461e873ed0f301ebbd167766265eea51f8db26be";
const PENDING = {
  id: "2026-10-10t03-30-00z-1a2b3c4d",
  logPath: "/u/updates/1.log",
  outcomePath: "/u/updates/1.json",
  startedIso: STARTED,
};

describe("parseUpdateOffer", () => {
  it("takes exactly a short one-line label and whether it is enabled, or null for no offer", () => {
    expect(parseUpdateOffer({ value: { enabled: true, label: "Update now" } })).toEqual({
      enabled: true,
      label: "Update now",
    });
    expect(parseUpdateOffer({ value: null })).toBe(null);
  });

  it("refuses a label too long, empty or on two lines, a stray key, and a non-boolean enabled", () => {
    expect(parseUpdateOffer({ value: { enabled: true, label: "x".repeat(65) } })).toBe(undefined);
    expect(parseUpdateOffer({ value: { enabled: true, label: "" } })).toBe(undefined);
    expect(parseUpdateOffer({ value: { enabled: true, label: "Update\nnow" } })).toBe(undefined);
    expect(parseUpdateOffer({ value: { enabled: true, label: "Update now", run: "rm" } })).toBe(undefined);
    expect(parseUpdateOffer({ value: { enabled: "yes", label: "Update now" } })).toBe(undefined);
    expect(parseUpdateOffer({ value: undefined })).toBe(undefined);
  });
});

describe("decodePendingUpdate", () => {
  it("reads one exactly, and refuses an id of another shape, a stray key or a relative path", () => {
    expect(decodePendingUpdate({ value: PENDING })).toEqual(PENDING);
    expect(decodePendingUpdate({ value: { ...PENDING, id: "../x" } })).toBe(undefined);
    expect(decodePendingUpdate({ value: { ...PENDING, pid: 4 } })).toBe(undefined);
    expect(decodePendingUpdate({ value: { ...PENDING, logPath: "1.log" } })).toBe(undefined);
    expect(decodePendingUpdate({ value: { ...PENDING, startedIso: "now" } })).toBe(undefined);
  });
});

describe("decodeResumeVoice", () => {
  it("reads a dated flag and nothing else", () => {
    expect(decodeResumeVoice({ value: { sinceIso: STARTED } })).toEqual({ sinceIso: STARTED });
    expect(decodeResumeVoice({ value: { sinceIso: STARTED, call: "x" } })).toBe(undefined);
    expect(decodeResumeVoice({ value: { sinceIso: "soon" } })).toBe(undefined);
  });
});

describe("decodeUpdateOutcome", () => {
  it("reads the record the verb writes, both kinds", () => {
    const updated = { finishedIso: STARTED, kind: "updated", logPath: "/u/1.log", sha: SHA, startedIso: STARTED };
    expect(decodeUpdateOutcome({ value: updated })).toEqual({
      finishedIso: STARTED,
      kind: "updated",
      logPath: "/u/1.log",
      sha: SHA,
    });
    const failed = { code: "ROLLED_BACK", finishedIso: STARTED, kind: "failed", message: "m", rolledBack: true };
    expect(decodeUpdateOutcome({ value: failed })).toEqual({ ...failed, logPath: undefined });
  });

  it("refuses a short sha, an unknown kind and an over-long message", () => {
    expect(decodeUpdateOutcome({ value: { finishedIso: STARTED, kind: "updated", sha: "461e873" } })).toBe(undefined);
    expect(decodeUpdateOutcome({ value: { finishedIso: STARTED, kind: "later" } })).toBe(undefined);
    expect(
      decodeUpdateOutcome({
        value: { code: "X", finishedIso: STARTED, kind: "failed", message: "m".repeat(2001), rolledBack: false },
      }),
    ).toBe(undefined);
  });
});

describe("pendingVerdict", () => {
  it("waits while the update may still run, and calls it lost once it exited unrecorded or ran past the bound", () => {
    expect(pendingVerdict({ exited: false, nowMs: STARTED_MS + UPDATE_GIVE_UP_MS, pending: PENDING })).toBe("wait");
    expect(pendingVerdict({ exited: true, nowMs: STARTED_MS, pending: PENDING })).toBe("lost");
    expect(pendingVerdict({ exited: false, nowMs: STARTED_MS + UPDATE_GIVE_UP_MS + 1, pending: PENDING })).toBe("lost");
  });
});

describe("lostOutcome", () => {
  it("names the update as lost, never rolled back, and points at its output", () => {
    expect(lostOutcome({ nowIso: "2026-10-10T03:50:00.000Z", pending: PENDING })).toEqual({
      code: "UPDATE_LOST",
      finishedIso: "2026-10-10T03:50:00.000Z",
      kind: "failed",
      logPath: "/u/updates/1.log",
      message:
        "the update started at 2026-10-10T03:30:00.000Z never wrote how it ended; it may have been stopped part " +
        "way; its output is at /u/updates/1.log",
      rolledBack: false,
    });
  });
});

describe("resumeDue", () => {
  it("restarts a call ended inside the window, and never one too old", () => {
    expect(resumeDue({ nowMs: STARTED_MS + RESUME_WITHIN_MS, resume: { sinceIso: STARTED } })).toBe(true);
    expect(resumeDue({ nowMs: STARTED_MS + RESUME_WITHIN_MS + 1, resume: { sinceIso: STARTED } })).toBe(false);
  });

  it("still restarts after the clock moved back since the hang-up, but not past the window", () => {
    expect(resumeDue({ nowMs: STARTED_MS - 1000, resume: { sinceIso: STARTED } })).toBe(true);
    expect(resumeDue({ nowMs: STARTED_MS - RESUME_WITHIN_MS - 1, resume: { sinceIso: STARTED } })).toBe(false);
  });
});

describe("updateLaunch", () => {
  it("keeps the update's record and output in the app's folder", () => {
    expect(updateLaunch({ folder: "/u/updates", id: "a-1" })).toEqual({
      logPath: "/u/updates/a-1.log",
      outcomePath: "/u/updates/a-1.json",
    });
  });
});

describe("trayUpdateItem", () => {
  it("says it is updating, carries the console's offer, or offers a check", () => {
    expect(trayUpdateItem({ offer: { enabled: true, label: "Update now" }, running: true })).toEqual({
      click: undefined,
      enabled: false,
      label: "Updating…",
    });
    expect(trayUpdateItem({ offer: { enabled: true, label: "Restart to update" }, running: false })).toEqual({
      click: "run",
      enabled: true,
      label: "Restart to update",
    });
    expect(trayUpdateItem({ offer: { enabled: false, label: "Building update…" }, running: false })).toEqual({
      click: undefined,
      enabled: false,
      label: "Building update…",
    });
    expect(trayUpdateItem({ offer: null, running: false })).toEqual({
      click: "check",
      enabled: true,
      label: "Check for Updates…",
    });
  });
});

describe("trayOutcomeLine", () => {
  it("shows a failure, which way it failed, and nothing for a success", () => {
    const failed = { code: "X", finishedIso: STARTED, kind: "failed", logPath: undefined, message: "m" } as const;
    expect(trayOutcomeLine({ outcome: { ...failed, rolledBack: true } })).toBe(
      "Update failed. The previous app was put back",
    );
    expect(trayOutcomeLine({ outcome: { ...failed, rolledBack: false } })).toBe("Update failed. This app kept running");
    expect(trayOutcomeLine({ outcome: { finishedIso: STARTED, kind: "updated", logPath: undefined, sha: SHA } })).toBe(
      undefined,
    );
    expect(trayOutcomeLine({ outcome: undefined })).toBe(undefined);
  });
});
