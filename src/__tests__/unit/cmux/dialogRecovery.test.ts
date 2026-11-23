/**
 * Declining cmux's allowlisted dialog over fake effects, an in-memory revive journal and a real claim in a temp home's
 * runtime directory: what is pressed, what is journalled, and that a fleet of timing-out seats makes one attempt a
 * minute.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { type CmuxDialog, type CmuxDialogError, CmuxDialogErrors, type DialogDismissal } from "../../../cmux/dialog.js";
import {
  claimAutomaticDialogAttempt,
  type DialogRecoveryDeps,
  inspectDialogs,
  recoverDialogAfterTimeout,
} from "../../../cmux/dialogRecovery.js";
import type { FleetPort } from "../../../fleet/port.js";
import { runtimeCmuxDir, runtimeLockDir } from "../../../stateRuntime.js";
import { memoryFleetPort } from "../../fleetStoreFixture.js";

const PROMPT: CmuxDialog = {
  buttons: ["Run Once", "Cancel", "Trust and Run"],
  texts: ["Run Project Action?", "This project action comes from: /tmp/scratchpad/cmux.json"],
  title: "Run Project Action?",
};
const OTHER: CmuxDialog = { buttons: ["OK", "Cancel"], texts: ["Quit cmux?"], title: "Quit cmux?" };
const NOW = "2026-10-11T07:28:00.000Z";

let homes: string[] = [];

afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** A fresh home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "dialog-"));
  homes.push(home);
  return home;
}

/** Where the home's claim file lives, its directory made so a test can seed it. */
function claimFile({ home }: { home: string }): string {
  const directory = unwrap(runtimeCmuxDir({ home }));
  mkdirSync(directory, { recursive: true });
  return join(directory, "cmux-dialog-decline.json");
}

/** Hold the decline's lock, as a live seat mid-attempt does. */
function holdLock({ home, nowIso }: { home: string; nowIso: string }): { release: () => void } {
  return unwrap(
    acquireOperationLock({
      directory: unwrap(runtimeLockDir({ home })),
      home,
      key: "cmux-dialog-decline",
      nowIso,
      staleAfterMs: Number.POSITIVE_INFINITY,
    }),
  );
}

/** Fake effects showing `dialogs`, collecting each press, journalling through `fleet`. */
function deps({
  fleet,
  dialogs,
  pressed,
  pressFails = false,
  readFails = false,
  nowIso = NOW,
}: {
  fleet: FleetPort;
  dialogs: readonly CmuxDialog[];
  pressed: DialogDismissal[];
  pressFails?: boolean;
  readFails?: boolean;
  nowIso?: string;
}): DialogRecoveryDeps {
  return {
    append: ({ event, home }) => fleet.appendCmuxReviveEvent({ event, home }),
    dismiss: ({ dismissal }) => {
      if (pressFails) {
        return err(CmuxDialogErrors.dismissFailed({ why: "no cmux dialog titled exactly that" }));
      }
      pressed.push(dismissal);
      return ok(undefined);
    },
    nowIso: () => nowIso,
    read: () => (readFails ? err(CmuxDialogErrors.readFailed({ why: "not authorised" })) : ok(dialogs)),
  };
}

/** Claim at a fixed instant, attempting nothing. */
function claim({ home, nowIso }: { home: string; nowIso: string }): Promise<Result<boolean, CmuxDialogError>> {
  return claimAutomaticDialogAttempt({ attempt: () => Promise.resolve(), clock: () => nowIso, home });
}

/** The journal's event kinds. */
async function kinds({ fleet, home }: { fleet: FleetPort; home: string }): Promise<readonly string[]> {
  return unwrap(await fleet.readCmuxReviveJournal({ home })).events.map((event) => event.kind);
}

describe("inspectDialogs", () => {
  it("reports what it sees and presses nothing when only asked to look", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const pressed: DialogDismissal[] = [];
    const report = unwrap(
      await inspectDialogs({ deps: deps({ dialogs: [PROMPT], fleet, pressed }), dismiss: false, home }),
    );
    expect([report, pressed, await kinds({ fleet, home })]).toEqual([{ dialogs: [PROMPT], dismissed: null }, [], []]);
  });

  it("presses Cancel on the prompt, past a dialog it may not answer, and journals the press", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const pressed: DialogDismissal[] = [];
    const report = unwrap(
      await inspectDialogs({ deps: deps({ dialogs: [OTHER, PROMPT], fleet, pressed }), dismiss: true, home }),
    );
    const cancel = { button: "Cancel", title: "Run Project Action?" };
    expect([report.dismissed, pressed]).toEqual([cancel, [cancel]]);
    expect(unwrap(await fleet.readCmuxReviveJournal({ home })).events).toEqual([
      { atIso: NOW, button: "Cancel", kind: "dialog-dismissed", schemaVersion: 1, title: "Run Project Action?" },
    ]);
  });

  it("presses and journals nothing when no dialog shown is allowlisted", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const pressed: DialogDismissal[] = [];
    const report = unwrap(
      await inspectDialogs({ deps: deps({ dialogs: [OTHER], fleet, pressed }), dismiss: true, home }),
    );
    expect([report.dismissed, pressed, await kinds({ fleet, home })]).toEqual([null, [], []]);
  });

  it("journals nothing when the press fails", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const failed = await inspectDialogs({
      deps: deps({ dialogs: [PROMPT], fleet, pressed: [], pressFails: true }),
      dismiss: true,
      home,
    });
    expect([unwrapErr(failed).code, await kinds({ fleet, home })]).toEqual(["DIALOG_DISMISS_FAILED", []]);
  });
});

describe("claimAutomaticDialogAttempt", () => {
  it("claims once a minute: the first caller, not a second inside it, then one after", async () => {
    const home = freshHome();
    expect([
      unwrap(await claim({ home, nowIso: NOW })),
      unwrap(await claim({ home, nowIso: "2026-10-11T07:28:30.000Z" })),
      unwrap(await claim({ home, nowIso: "2026-10-11T07:29:00.000Z" })),
    ]).toEqual([true, false, true]);
  });

  it("claims nothing when the clock is set back past the last claim", async () => {
    const home = freshHome();
    expect([
      unwrap(await claim({ home, nowIso: "2026-10-11T07:28:30.000Z" })),
      unwrap(await claim({ home, nowIso: "2026-10-11T07:28:00.000Z" })),
    ]).toEqual([true, false]);
  });

  it("holds a claim it cannot parse for one interval from the file's own time", async () => {
    const home = freshHome();
    const path = claimFile({ home });
    writeFileSync(path, "{cut");
    utimesSync(path, new Date("2026-10-11T07:27:30.000Z"), new Date("2026-10-11T07:27:30.000Z"));
    expect(unwrap(await claim({ home, nowIso: NOW }))).toBe(false);
  });

  it("holds a claim of the wrong shape the same way", async () => {
    const home = freshHome();
    const path = claimFile({ home });
    writeFileSync(path, "{}");
    utimesSync(path, new Date("2026-10-11T07:27:30.000Z"), new Date("2026-10-11T07:27:30.000Z"));
    expect(unwrap(await claim({ home, nowIso: NOW }))).toBe(false);
  });

  it("replaces a claim it cannot parse once the file is an interval old, rather than wedging", async () => {
    const home = freshHome();
    const path = claimFile({ home });
    writeFileSync(path, "{cut");
    utimesSync(path, new Date("2026-10-11T07:26:00.000Z"), new Date("2026-10-11T07:26:00.000Z"));
    expect(unwrap(await claim({ home, nowIso: NOW }))).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`{"atIso":"${NOW}","schemaVersion":1}\n`);
  });

  it("leaves the attempt to the seat holding the lock", async () => {
    const home = freshHome();
    const held = holdLock({ home, nowIso: NOW });
    try {
      expect(unwrap(await claim({ home, nowIso: NOW }))).toBe(false);
    } finally {
      held.release();
    }
  });

  it("makes the attempt while still holding the lock, so no later claimant presses until it is done", async () => {
    const home = freshHome();
    const inside: boolean[] = [];
    const attempt = async (): Promise<void> => {
      inside.push(unwrap(await claim({ home, nowIso: "2026-10-11T07:29:30.000Z" })));
    };
    expect(unwrap(await claimAutomaticDialogAttempt({ attempt, clock: () => NOW, home }))).toBe(true);
    expect(inside).toEqual([false]);
  });

  it("stamps the instant read once the lock is held, never one read before it", async () => {
    const home = freshHome();
    const path = claimFile({ home });
    const clock = ["2026-10-11T07:28:00.000Z", "2026-10-11T07:31:00.000Z", "2026-10-11T07:31:05.000Z"];
    const seen: string[] = [];
    const attempt = (): Promise<void> => {
      seen.push(readFileSync(path, "utf8"));
      return Promise.resolve();
    };
    expect(unwrap(await claimAutomaticDialogAttempt({ attempt, clock: () => clock.shift()!, home }))).toBe(true);
    expect(seen).toEqual([`{"atIso":"2026-10-11T07:31:00.000Z","schemaVersion":1}\n`]);
  });

  it("stamps the claim again once the attempt is over, so a paused holder's minute runs from its press", async () => {
    const home = freshHome();
    const clock = ["2026-10-11T12:00:00.000Z", "2026-10-11T12:00:00.000Z", "2026-10-11T12:02:00.000Z"];
    const claimed = await claimAutomaticDialogAttempt({
      attempt: () => Promise.resolve(),
      clock: () => clock.shift()!,
      home,
    });
    expect(unwrap(claimed)).toBe(true);
    expect(unwrap(await claim({ home, nowIso: "2026-10-11T12:02:01.000Z" }))).toBe(false);
  });

  it("stamps the claim again even when the attempt throws", async () => {
    const home = freshHome();
    const clock = ["2026-10-11T12:00:00.000Z", "2026-10-11T12:00:00.000Z", "2026-10-11T12:02:00.000Z"];
    const attempt = (): Promise<void> => Promise.reject(new Error("System Events crashed"));
    await expect(claimAutomaticDialogAttempt({ attempt, clock: () => clock.shift()!, home })).rejects.toThrow(
      "System Events crashed",
    );
    expect(unwrap(await claim({ home, nowIso: "2026-10-11T12:02:01.000Z" }))).toBe(false);
  });

  it("waits out a whole interval after taking the lock from a holder that died, which may have pressed unstamped", async () => {
    const home = freshHome();
    unwrap(await claim({ home, nowIso: "2026-10-11T12:00:00.000Z" }));
    holdLock({ home, nowIso: "2026-10-11T12:00:00.000Z" });
    const lockDir = unwrap(runtimeLockDir({ home }));
    const lock = join(
      lockDir,
      readdirSync(lockDir).find((name) => name.endsWith(".lock"))!,
    );
    const token = join(lock, readdirSync(lock)[0]!);
    const dead = spawnSync("true", [], { stdio: "ignore" }).pid;
    writeFileSync(token, JSON.stringify({ acquiredAtIso: "2026-10-11T12:00:00.000Z", pid: dead }));
    const attempts: string[] = [];
    const taken = await claimAutomaticDialogAttempt({
      attempt: () => {
        attempts.push("pressed");
        return Promise.resolve();
      },
      clock: () => "2026-10-11T12:02:00.000Z",
      home,
    });
    expect([
      unwrap(taken),
      attempts,
      unwrap(await claim({ home, nowIso: "2026-10-11T12:02:59.000Z" })),
      unwrap(await claim({ home, nowIso: "2026-10-11T12:03:00.000Z" })),
    ]).toEqual([false, [], false, true]);
  });

  it("makes no attempt when the minute is already spent", async () => {
    const home = freshHome();
    const attempts: string[] = [];
    unwrap(await claim({ home, nowIso: NOW }));
    const second = await claimAutomaticDialogAttempt({
      attempt: () => {
        attempts.push("pressed");
        return Promise.resolve();
      },
      clock: () => "2026-10-11T07:28:30.000Z",
      home,
    });
    expect([unwrap(second), attempts]).toEqual([false, []]);
  });

  it("never takes the lock over from a live seat, however long it has held it", async () => {
    const home = freshHome();
    const held = holdLock({ home, nowIso: NOW });
    try {
      expect(unwrap(await claim({ home, nowIso: "2026-10-11T08:28:00.000Z" }))).toBe(false);
    } finally {
      held.release();
    }
  });
});

describe("recoverDialogAfterTimeout", () => {
  it("declines the prompt once for many timeouts in one minute", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const pressed: DialogDismissal[] = [];
    for (const second of ["00", "10", "45"]) {
      await recoverDialogAfterTimeout({
        deps: deps({ dialogs: [PROMPT], fleet, nowIso: `2026-10-11T07:28:${second}.000Z`, pressed }),
        home,
      });
    }
    expect([pressed.length, await kinds({ fleet, home })]).toEqual([1, ["dialog-dismissed"]]);
  });

  it("never throws when the read fails, and still spends the minute", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const pressed: DialogDismissal[] = [];
    await recoverDialogAfterTimeout({ deps: deps({ dialogs: [], fleet, pressed, readFails: true }), home });
    await recoverDialogAfterTimeout({ deps: deps({ dialogs: [PROMPT], fleet, pressed }), home });
    expect(pressed).toEqual([]);
  });

  it("never throws when an effect throws", async () => {
    const home = freshHome();
    const throwing: DialogRecoveryDeps = {
      ...deps({ dialogs: [PROMPT], fleet: memoryFleetPort(), pressed: [] }),
      read: () => {
        throw new Error("System Events crashed");
      },
    };
    expect(await recoverDialogAfterTimeout({ deps: throwing, home })).toBeUndefined();
  });
});
