/**
 * `profile-unloaded` — a running session the owner's profile never reached is one quiet card reporting its reload, keyed on
 * the newest failure, held after the owner closes it. The source half reads a real ledger and a real transcript dated by `utimesSync`.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { observationOfRow, type ProfileLoadObservation } from "../../../context/loadLedger.js";
import { appendProfileLoad } from "../../../context/loadLedgerStore.js";
import { MARKER_UNWRITTEN_REASON } from "../../../context/profileDelivery.js";
import { unwrap } from "../../../lib/result.js";
import { evaluateProfileUnloaded, PROFILE_UNLOADED, profileUnloadedKey } from "../../../monitor/profileUnloaded.js";
import { readProfileUnloaded, runningSessionObservations } from "../../../monitor/profileUnloadedSource.js";
import { firing } from "./readings.js";

const NOW_MS = Date.parse("2026-10-05T12:00:00.000Z");
const NONE: ReadonlySet<string> = new Set();

/** One failed observation. */
function failed(over: Partial<ProfileLoadObservation> = {}): ProfileLoadObservation {
  return {
    atIso: "2026-10-05T10:23:58.000Z",
    cwd: "/repo/stale-wt",
    event: "SessionStart:startup",
    outcome: "failed",
    sessionId: "46e308d4-aaaa",
    why: "the SessionStart:startup profile hook never ran (exit-127)",
    ...over,
  };
}

describe("evaluateProfileUnloaded", () => {
  it("is clear when every session's newest observation is a load", () => {
    const loaded = failed({ atIso: "2026-10-05T11:00:00.000Z", outcome: "loaded" });
    expect(evaluateProfileUnloaded({ dismissed: NONE, observations: [failed(), loaded], shown: NONE })).toEqual({
      monitorId: "profile-unloaded",
      state: "clear",
    });
  });

  it("fires ONE subject over the set, keyed on the newest failure, every session in its details", () => {
    const older = failed({ atIso: "2026-10-04T03:28:00.000Z", cwd: "", sessionId: "cf0da601-bbbb" });
    const reading = firing({
      reading: evaluateProfileUnloaded({ dismissed: NONE, observations: [older, failed()], shown: NONE }),
    });
    expect(reading.subjects).toEqual([
      {
        details: [
          "46e308d4 at 2026-10-05T10:23Z in /repo/stale-wt: the SessionStart:startup profile hook never ran (exit-127) — not yet held: its next guarded call is, unless its hooks predate the hold",
          "cf0da601 at 2026-10-04T03:28Z: the SessionStart:startup profile hook never ran (exit-127) — not yet held: its next guarded call is, unless its hooks predate the hold",
        ],
        id: "2 sessions",
        key: "46e308d4-202610051023",
        label: "46e308d4 not yet held, cf0da601 not yet held",
      },
    ]);
  });

  it("claims a reload only for a session whose newest failure is the hold's own row", () => {
    const held = failed({ atIso: "2026-10-05T10:30:00.000Z", event: "PreToolUse", why: "the hold found no copy" });
    const subject = firing({
      reading: evaluateProfileUnloaded({
        dismissed: NONE,
        observations: [failed(), held, failed({ sessionId: "cf0da601-bbbb" })],
        shown: NONE,
      }),
    }).subjects[0]!;
    expect(subject.label).toBe("46e308d4 held, cf0da601 not yet held");
    expect(subject.details![0]).toBe(
      "46e308d4 at 2026-10-05T10:30Z in /repo/stale-wt: the hold found no copy — held, and reloading by itself",
    );
  });

  // Built from the row the hold writes, so a change to that reason's wording reddens this rather than going unnoticed.
  it("names a held session whose marker cannot be written apart from one reloading by itself", () => {
    const unwritten = observationOfRow({
      row: {
        atIso: "2026-10-05T10:30:00.000Z",
        cwd: "/repo/stale-wt",
        event: "PreToolUse",
        origin: "none",
        reason: `${MARKER_UNWRITTEN_REASON}the profile delivery marker /h/profile/delivered/s could not be written: EEXIST`,
        sessionId: "46e308d4-aaaa",
        source: "hook",
      },
    });
    const subject = firing({
      reading: evaluateProfileUnloaded({ dismissed: NONE, observations: [unwritten], shown: NONE }),
    }).subjects[0]!;
    expect(subject.label).toBe("46e308d4 held, marker unwritable");
    expect(subject.details![0]).toBe(
      "46e308d4 at 2026-10-05T10:30Z in /repo/stale-wt: the PreToolUse profile hook found no profile to load: delivered, but the profile delivery marker /h/profile/delivered/s could not be written: EEXIST — held on every guarded call: the owner's profile reaches it, but nothing can release it until its marker can be written",
    );
  });

  it("holds a key the owner closed, and one already shown and taken down, rather than re-floating it", () => {
    const key = profileUnloadedKey({ newest: failed() });
    const closed = firing({
      reading: evaluateProfileUnloaded({ dismissed: new Set([key]), observations: [failed()], shown: NONE }),
    });
    const shown = firing({
      reading: evaluateProfileUnloaded({ dismissed: NONE, observations: [failed()], shown: new Set([key]) }),
    });
    expect([closed.subjects[0]!.delivery!.kind, shown.subjects[0]!.delivery!.kind]).toEqual(["hold", "hold"]);
  });

  it("reports the reload already in flight, asks nothing of the owner, and neither floats nor declares a note level", () => {
    const subject = firing({
      reading: evaluateProfileUnloaded({
        dismissed: NONE,
        observations: [failed({ event: "PreToolUse" })],
        shown: NONE,
      }),
    }).subjects[0]!;
    expect(PROFILE_UNLOADED.what({ subject })).toBe("Your profile is missing from 1 session: 46e308d4 held");
    expect(PROFILE_UNLOADED.unblocks({ subject })).toBe("nothing waits on you — 46e308d4 held");
    expect([PROFILE_UNLOADED.floats, PROFILE_UNLOADED.noteLevel]).toEqual([undefined, undefined]);
  });
});

describe("runningSessionObservations", () => {
  let home = "";
  let projectsDir = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "profile-unloaded-home-"));
    projectsDir = mkdtempSync(join(tmpdir(), "profile-unloaded-projects-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(projectsDir, { force: true, recursive: true });
  });

  /** A transcript whose boot never ran the profile hook, last written at `writtenIso`. */
  function writeFailedBoot({ sessionId, writtenIso }: { sessionId: string; writtenIso: string }): void {
    const dir = join(projectsDir, "-repo-stale-wt");
    mkdirSync(dir, { recursive: true });
    const hook = "/d/mirror/by-root/repo/stale-wt/current/scripts/hook.sh";
    const line = {
      attachment: {
        command: `"${hook}" 10 profile-context "…/hooks/profile-context.sh"`,
        exitCode: 127,
        hookEvent: "SessionStart",
        hookName: "SessionStart:startup",
        stderr: `Failed with non-blocking status code: /bin/sh: ${hook}: No such file or directory`,
        type: "hook_non_blocking_error",
      },
      cwd: "/repo/stale-wt",
      sessionId,
      timestamp: writtenIso,
      type: "attachment",
    };
    const path = join(dir, `${sessionId}.jsonl`);
    writeFileSync(path, `${JSON.stringify(line)}\n`);
    const seconds = Date.parse(writtenIso) / 1000;
    utimesSync(path, seconds, seconds);
  }

  it("reads a failure off a transcript written inside the day, and ignores one written before it", () => {
    writeFailedBoot({ sessionId: "running", writtenIso: "2026-10-05T10:23:58.000Z" });
    writeFailedBoot({ sessionId: "long-gone", writtenIso: "2026-10-03T09:00:00.000Z" });
    const read = runningSessionObservations({ home, nowMs: NOW_MS, projectsDir });
    expect([read.problems, read.observations.map((observation) => observation.sessionId)]).toEqual([[], ["running"]]);
  });

  it("counts a ledger row's session as running, and lets a later reload clear the transcript's failure", () => {
    writeFailedBoot({ sessionId: "running", writtenIso: "2026-10-05T10:23:58.000Z" });
    unwrap(
      appendProfileLoad({
        home,
        row: {
          atIso: "2026-10-05T10:40:00.000Z",
          cwd: "/repo/stale-wt",
          event: "by-hand",
          origin: "live",
          reason: "",
          sessionId: "running",
          source: "by-hand",
        },
      }),
    );
    const read = runningSessionObservations({ home, nowMs: NOW_MS, projectsDir });
    expect(evaluateProfileUnloaded({ dismissed: NONE, observations: read.observations, shown: NONE }).state).toBe(
      "clear",
    );
  });

  it("lets a later boot of the same seat that RAN the hook clear its earlier failure", () => {
    writeFailedBoot({ sessionId: "resumed", writtenIso: "2026-10-05T10:23:58.000Z" });
    const ran = {
      attachment: {
        command: '"/d/mirror/current/scripts/hook.sh" 10 profile-context "…/hooks/profile-context.sh"',
        exitCode: 0,
        hookEvent: "SessionStart",
        hookName: "SessionStart:resume",
        stdout:
          '{"hookSpecificOutput":{"additionalContext":"[slopweaver] always-loaded context — read at now\\n- x"}}\n',
        type: "hook_success",
      },
      cwd: "/repo/stale-wt",
      sessionId: "resumed",
      timestamp: "2026-10-05T10:50:00.000Z",
      type: "attachment",
    };
    const path = join(projectsDir, "-repo-stale-wt", "resumed.jsonl");
    appendFileSync(path, `${JSON.stringify(ran)}\n`);
    const seconds = Date.parse(ran.timestamp) / 1000;
    utimesSync(path, seconds, seconds);
    const read = runningSessionObservations({ home, nowMs: NOW_MS, projectsDir });
    expect([
      read.observations.map((observation) => observation.outcome),
      evaluateProfileUnloaded({ dismissed: NONE, observations: read.observations, shown: NONE }).state,
    ]).toEqual([["failed", "loaded"], "clear"]);
  });

  it("reads clear on a first boot, where a failed boot load lost nothing and no call is held", () => {
    // A newcomer's first session was carded as one whose next call would be held.
    writeFailedBoot({ sessionId: "newcomer", writtenIso: "2026-10-05T10:23:58.000Z" });
    const read = ({ fresh }: { fresh: boolean }): string =>
      readProfileUnloaded({ home, neverConfigured: () => fresh, nowMs: NOW_MS, projectsDir }).state;
    expect([read({ fresh: true }), read({ fresh: false })]).toEqual(["clear", "firing"]);
  });

  it("names the projects directory it could not list as a problem, never a clear read", () => {
    const read = runningSessionObservations({ home, nowMs: NOW_MS, projectsDir: join(projectsDir, "absent") });
    expect(read.problems.length).toBe(1);
  });
});
