/**
 * The chair's loaded-canon read: the `git log` argv, its parse, and the boot it is measured from. The log lines
 * are the real shape `git log origin/main --format=%H%x09%cI%x09%s` printed.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { canonLogArgs, parseCanonLog, readChairCanonFor, readChairCanonSince } from "../../../supervisor/chairCanon.js";
import { SupervisorCoreErrors } from "../../../supervisor/errors.js";

/** Two real canon commits, newest first, exactly as git printed them. */
const LOG = [
  "34e48e7b7accbdca0b1c7a73d355db7f7f51a443\t2026-09-30T17:31:31Z\tA background bash is stopped at its timeout, not reaped at ~75 minutes: the sweep contract's claim was measured wrong (#1659)",
  "b4571136d9c93498f386844e918546754fe09776\t2026-09-30T17:01:37Z\tA background run-due below the Bash tool's 7200000 ms timeout is refused (#1658)",
  "",
].join("\n");

describe("canonLogArgs", () => {
  it("asks origin/main for every commit touching the three canon paths since the boot, in the chair's worktree", () => {
    expect(canonLogArgs({ cwd: "/wt/chair", sinceIso: "2026-09-30T09:43:05.000Z" })).toStrictEqual([
      "-C",
      "/wt/chair",
      "log",
      "origin/main",
      "--since=2026-09-30T09:43:05.000Z",
      "--format=%H%x09%cI%x09%s",
      "--",
      "skills/supervisor",
      ".claude/rules",
      "AGENTS.md",
    ]);
  });
});

describe("parseCanonLog", () => {
  it("reads each line's sha, committer instant and subject, keeping git's newest-first order", () => {
    const parsed = parseCanonLog({ text: LOG });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).map(({ sha, committedIso }) => ({ committedIso, sha }))).toStrictEqual([
      { committedIso: "2026-09-30T17:31:31Z", sha: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443" },
      { committedIso: "2026-09-30T17:01:37Z", sha: "b4571136d9c93498f386844e918546754fe09776" },
    ]);
  });

  it("keeps a tab inside a subject as part of the subject", () => {
    const parsed = parseCanonLog({
      text: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443\t2026-09-30T17:31:31Z\tleft\tright",
    });

    expect(unwrap(parsed)[0]!.subject).toBe("left\tright");
  });

  it("reads empty output as no commits", () => {
    expect(unwrap(parseCanonLog({ text: "" }))).toStrictEqual([]);
  });

  it("refuses a line that is not sha, instant and subject, naming the line", () => {
    const parsed = parseCanonLog({ text: "fatal: bad revision 'origin/main'" });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("CANON_LOG_MALFORMED");
    expect(unwrapErr(parsed).message).toContain("fatal: bad revision");
  });

  it("refuses a line whose instant does not parse", () => {
    const parsed = parseCanonLog({ text: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443\tyesterday\tsubject" });

    expect(unwrapErr(parsed).code).toBe("CANON_LOG_MALFORMED");
  });
});

describe("readChairCanonFor", () => {
  it("asks git from the boot instant and keeps only commits strictly after it", () => {
    const asked: string[] = [];
    const reading = readChairCanonFor({
      runLog: ({ sinceIso }) => {
        asked.push(sinceIso);
        return ok(LOG);
      },
      // The older commit's own instant: it is not AFTER the boot.
      startedAtMs: Date.parse("2026-09-30T17:01:37Z"),
    });

    expect(asked).toStrictEqual(["2026-09-30T17:01:37.000Z"]);
    expect(reading).toMatchObject({ bootedIso: "2026-09-30T17:01:37.000Z", kind: "measured" });
    expect((reading as { changed: readonly { sha: string }[] }).changed.map(({ sha }) => sha)).toStrictEqual([
      "34e48e7b7accbdca0b1c7a73d355db7f7f51a443",
    ]);
  });

  it("reads a registry with no startedAt as UNMEASURED and never runs git", () => {
    const asked: string[] = [];
    const reading = readChairCanonFor({
      runLog: ({ sinceIso }) => {
        asked.push(sinceIso);
        return ok(LOG);
      },
      startedAtMs: 0,
    });

    expect(asked).toStrictEqual([]);
    expect(reading).toStrictEqual({
      kind: "unmeasured",
      why: "its session registry file records no `startedAt`, so its boot is unknown",
    });
  });

  it("carries a git failure as UNMEASURED with git's own message, on one line", () => {
    const reading = readChairCanonFor({
      runLog: () =>
        err(
          SupervisorCoreErrors.canonLogFailed({ cause: new Error("Command failed: git log\nnot a git repository\n") }),
        ),
      startedAtMs: Date.parse("2026-09-30T09:43:05Z"),
    });

    expect(reading).toStrictEqual({
      kind: "unmeasured",
      why: "`git log origin/main` over the canon paths failed: Command failed: git log — not a git repository",
    });
  });
});

describe("readChairCanonSince — a Codex chair's floor is the instant its record took the chair", () => {
  it("asks git from that instant and keeps only commits strictly after it", () => {
    const asked: string[] = [];
    const reading = readChairCanonSince({
      bootedIso: "2026-09-30T17:01:37Z",
      runLog: ({ sinceIso }) => {
        asked.push(sinceIso);
        return ok(LOG);
      },
    });

    expect(asked).toStrictEqual(["2026-09-30T17:01:37Z"]);
    expect(reading).toMatchObject({ bootedIso: "2026-09-30T17:01:37Z", kind: "measured" });
    expect((reading as { changed: readonly { sha: string }[] }).changed.map(({ sha }) => sha)).toStrictEqual([
      "34e48e7b7accbdca0b1c7a73d355db7f7f51a443",
    ]);
  });

  it("reads a floor that is not an instant as UNMEASURED and never runs git", () => {
    const asked: string[] = [];
    const reading = readChairCanonSince({
      bootedIso: "yesterday",
      runLog: ({ sinceIso }) => {
        asked.push(sinceIso);
        return ok(LOG);
      },
    });

    expect(asked).toStrictEqual([]);
    expect(reading).toStrictEqual({ kind: "unmeasured", why: "its canon floor yesterday is not an instant" });
  });
});
