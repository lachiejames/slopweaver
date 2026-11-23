/**
 * The `SessionStart` emitter's own module, which exists to be reachable WITHOUT a flag parser.
 *
 * Two properties are worth a test and neither needs a database. The verb the manifest loads is the one this
 * module exports, and `--help` prints the usage a person who ran it by hand would read — the only argv shape
 * it interprets at all. Its store-backed path is proven by `context/load`'s own cases and by the live run
 * recorded in the pull request; what could not be asserted here is asserted there rather than mocked.
 */
import { describe, expect, it } from "vitest";

import {
  firstBootSessionToMark,
  profileHookOutcome,
  runProfileHook,
} from "../../../../../cli/commands/profile/hookRun.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { FIRST_BOOT_LINES } from "../../../../../context/loadLedger.js";

const AT = "2026-10-05T10:00:00.000Z";
const LIVE = { lines: ["# About the owner"], origin: "live" as const, reason: "" };
const NONE = { lines: ["(no profile)"], origin: "none" as const, reason: "the store did not answer within 2000ms" };

describe("profileHookOutcome", () => {
  it("records the payload's session, event and cwd, and injects the lines as loaded", () => {
    const payload = { cwd: "/repo/wt", hook_event_name: "PostCompact", session_id: "s-1" };
    expect(profileHookOutcome({ atIso: AT, firstBoot: false, loaded: LIVE, payload })).toEqual({
      event: "PostCompact",
      lines: ["# About the owner"],
      row: {
        atIso: AT,
        cwd: "/repo/wt",
        event: "PostCompact",
        origin: "live",
        reason: "",
        sessionId: "s-1",
        source: "hook",
      },
    });
  });

  it("leads with the STOP warning when nothing loaded, and records the failure", () => {
    const outcome = profileHookOutcome({ atIso: AT, firstBoot: false, loaded: NONE, payload: { session_id: "s-1" } });
    expect([outcome.lines[0], outcome.lines.at(-1), outcome.row!.origin, outcome.row!.cwd]).toEqual([
      "# STOP — the owner's profile did NOT load into this session",
      "(no profile)",
      "none",
      "",
    ]);
  });

  it("injects the first-boot lines instead of the STOP warning on a machine never configured, and records nothing", () => {
    const outcome = profileHookOutcome({ atIso: AT, firstBoot: true, loaded: NONE, payload: { session_id: "s-1" } });
    expect([outcome.lines, outcome.row]).toEqual([FIRST_BOOT_LINES, undefined]);
  });

  it("marks the row of a live read that found no owner row, so it never reads as a profile that existed", () => {
    // Not a first boot: another session's profile set held its mark while this hook ran.
    const loaded = { ...LIVE, ownerAbsent: true as const, ownerAbsentIn: "fp" };
    const outcome = profileHookOutcome({ atIso: AT, firstBoot: false, loaded, payload: { session_id: "s-1" } });
    expect([outcome.row!.origin, outcome.row!.ownerAbsent]).toEqual(["live", true]);
  });

  it("marks the payload's session on a first boot only, so the door holds it once another session configures", () => {
    const payload = { session_id: "s-1" };
    expect([
      firstBootSessionToMark({ firstBoot: true, payload }),
      firstBootSessionToMark({ firstBoot: false, payload }),
      firstBootSessionToMark({ firstBoot: true, payload: {} }),
    ]).toEqual(["s-1", undefined, undefined]);
  });

  it("records a session start under its source as the matcher, the way a transcript names the run", () => {
    const payload = { hook_event_name: "SessionStart", session_id: "s-1", source: "compact" };
    const outcome = profileHookOutcome({ atIso: AT, firstBoot: false, loaded: LIVE, payload });
    expect([outcome.event, outcome.row!.event]).toEqual(["SessionStart", "SessionStart:compact"]);
  });

  it("records nothing for a payload naming no session, and answers an unknown event as a session start", () => {
    expect(
      profileHookOutcome({ atIso: AT, firstBoot: false, loaded: LIVE, payload: { hook_event_name: "Stop" } }),
    ).toEqual({
      event: "SessionStart",
      lines: ["# About the owner"],
      row: undefined,
    });
  });
});

describe("profile hook", () => {
  it("prints its usage and exits zero on --help", async () => {
    expect(await runProfileHook(["node", "slopweaver", "profile", "hook", "--help"])).toBe(EXIT_OK);
  });

  it("answers -h the same way, because a hand-run hook is the only reader of either", async () => {
    expect(await runProfileHook(["node", "slopweaver", "profile", "hook", "-h"])).toBe(EXIT_OK);
  });
});
