/**
 * Whether a recorded session may be resumed (`desktop/src/sessionResume.ts`): the journal must hold it up and never
 * stopped, under the same launch identity, and every process group it led is gone, ours to end, or refused by name.
 */
import { describe, expect, it } from "vitest";

import type { AppLaunchSpec } from "../../src/sessionControlProtocol";
import {
  foldRecoveryJournal,
  type RecoveredSession,
  type RecoveryJournal,
  type SessionRecoveryEvent,
} from "../../src/sessionRecoveryRecord";
import { classifyRecoveryGroup, parseProcessTable, resumeTargetOf, startedEpochMs } from "../../src/sessionResume";

const CODEX: AppLaunchSpec = {
  codexHome: "/home/acme/.codex-three",
  directory: "/work/acme",
  judgedInstanceId: "instance-1",
  ledgerHome: "/home/acme/.slopweaver",
  ledgerKey: "ABC-1",
  title: "ABC-1",
  vendor: "codex",
};

const CLAUDE: AppLaunchSpec = {
  claudeMdExcludes: [],
  credential: { kind: "store", secureStorageDir: "/home/acme/.claude-two" },
  directory: "/work/acme",
  ledgerHome: "/home/acme/.slopweaver",
  ledgerKey: "ABC-1",
  title: "ABC-1",
  vendor: "claude",
};

const APP = "/Applications/Acme.app/Contents/MacOS/Acme";
const CODEX_BIN = "/Applications/Acme.app/Contents/Resources/codex";

/** A journal holding one session `s1`, opened with `spec`, its one group 4100, closed when asked. */
function journalOf({
  spec,
  closed = false,
  malformedLines = [],
}: {
  spec: AppLaunchSpec;
  closed?: boolean;
  malformedLines?: readonly number[];
}): RecoveryJournal {
  const session: RecoveredSession = {
    closed,
    groups: [
      {
        atIso: "2026-11-10T00:00:00Z",
        expectedExecutables: [APP, CODEX_BIN],
        kind: "group-started",
        pgid: 4100,
        sessionId: "s1",
      },
    ],
    opened: { atIso: "2026-11-10T00:00:01Z", kind: "opened", sessionId: "s1", spec, vendorSessionId: "thread-1" },
    sessionId: "s1",
  };
  return { malformedLines, sessions: new Map([["s1", session]]) };
}

describe("resumeTargetOf", () => {
  it("answers the recorded transcript and groups for a session that came up and was never stopped", () => {
    const target = resumeTargetOf({
      journal: journalOf({ spec: CODEX }),
      sessionId: "s1",
      spec: { ...CODEX, judgedInstanceId: "instance-2" },
    });
    expect(target._unsafeUnwrap().vendorSessionId).toBe("thread-1");
    expect(target._unsafeUnwrap().groups.map((group) => group.pgid)).toEqual([4100]);
  });

  it("refuses a session the journal holds no opened row for", () => {
    const target = resumeTargetOf({ journal: journalOf({ spec: CODEX }), sessionId: "s2", spec: CODEX });
    expect(target._unsafeUnwrapErr()).toBe(
      "the recovery journal records no session s2 that came up, so there is no transcript to resume",
    );
  });

  it("refuses a session that was stopped", () => {
    const target = resumeTargetOf({ journal: journalOf({ closed: true, spec: CODEX }), sessionId: "s1", spec: CODEX });
    expect(target._unsafeUnwrapErr()).toBe("session s1 was stopped from its card or a close, so it is not resumed");
  });

  it("refuses the whole journal when any line decodes to no row", () => {
    const target = resumeTargetOf({
      journal: journalOf({ malformedLines: [3, 7], spec: CODEX }),
      sessionId: "s1",
      spec: CODEX,
    });
    expect(target._unsafeUnwrapErr()).toBe(
      "the recovery journal has lines no row decodes from (3, 7), so no session is resumed from it",
    );
  });

  it("refuses a resume that adds, drops or changes the state home the session's verbs ran under", () => {
    const confined: AppLaunchSpec = { ...CODEX, stateHome: "/scratch/home" };
    const cases: readonly { journal: RecoveryJournal; spec: AppLaunchSpec }[] = [
      { journal: journalOf({ spec: CODEX }), spec: confined },
      { journal: journalOf({ spec: confined }), spec: CODEX },
      { journal: journalOf({ spec: confined }), spec: { ...confined, stateHome: "/scratch/other" } },
    ];
    expect(
      cases.map(({ journal, spec }) => resumeTargetOf({ journal, sessionId: "s1", spec })._unsafeUnwrapErr()),
    ).toEqual([
      "session s1 was opened with a different state home, so it is not resumed",
      "session s1 was opened with a different state home, so it is not resumed",
      "session s1 was opened with a different state home, so it is not resumed",
    ]);
    expect(resumeTargetOf({ journal: journalOf({ spec: confined }), sessionId: "s1", spec: confined }).isOk()).toBe(
      true,
    );
  });

  it("refuses a resume naming a different vendor, directory, ledger home, Codex home or credential route", () => {
    const tokenRoute = (tokenFilePath: string): AppLaunchSpec => ({
      ...CLAUDE,
      credential: { kind: "setup-token", secureStorageDir: "/home/acme/.claude-two", tokenFilePath },
    });
    const cases: readonly { journal: RecoveryJournal; spec: AppLaunchSpec }[] = [
      { journal: journalOf({ spec: CODEX }), spec: CLAUDE },
      { journal: journalOf({ spec: CODEX }), spec: { ...CODEX, directory: "/work/other" } },
      { journal: journalOf({ spec: CODEX }), spec: { ...CODEX, ledgerHome: "/home/other" } },
      { journal: journalOf({ spec: CODEX }), spec: { ...CODEX, codexHome: "/home/acme/.codex-one" } },
      {
        journal: journalOf({ spec: CLAUDE }),
        spec: { ...CLAUDE, credential: { kind: "store", secureStorageDir: "/home/acme/.claude-one" } },
      },
      { journal: journalOf({ spec: CLAUDE }), spec: tokenRoute("/home/acme/two.token") },
      { journal: journalOf({ spec: tokenRoute("/home/acme/old.token") }), spec: tokenRoute("/home/acme/new.token") },
    ];
    const refusals = cases.map(({ journal, spec }) =>
      resumeTargetOf({ journal, sessionId: "s1", spec })._unsafeUnwrapErr(),
    );
    expect(refusals).toEqual([
      "session s1 was opened with a different vendor, so it is not resumed",
      "session s1 was opened with a different directory, so it is not resumed",
      "session s1 was opened with a different ledger home, so it is not resumed",
      "session s1 was opened with a different Codex home, so it is not resumed",
      "session s1 was opened with a different credential route, so it is not resumed",
      "session s1 was opened with a different credential route, so it is not resumed",
      "session s1 was opened with a different credential route, so it is not resumed",
    ]);
  });
});

describe("classifyRecoveryGroup", () => {
  const expectedExecutables = [APP, CODEX_BIN];
  const EARLY = "Tue Nov 10 04:31:31 2026";
  const LATER = "Tue Nov 10 04:31:36 2026";
  /** The row naming group 4100, written a second after its leader started at EARLY. */
  const rowAtIso = "2026-11-10T04:31:32.000Z";

  it("reads a group no process is in as gone", () => {
    const processes = [{ command: APP, pgid: 9, pid: 9, started: EARLY }];
    expect(classifyRecoveryGroup({ expectedExecutables, pgid: 4100, processes, rowAtIso })).toEqual({ kind: "gone" });
  });

  it("reads a group whose every process runs a recorded executable as owned, naming each by pid and start", () => {
    const processes = [
      { command: APP, pgid: 4100, pid: 4100, started: EARLY },
      { command: CODEX_BIN, pgid: 4100, pid: 4102, started: EARLY },
      { command: "/bin/zsh", pgid: 9, pid: 9, started: EARLY },
    ];
    expect(classifyRecoveryGroup({ expectedExecutables, pgid: 4100, processes, rowAtIso })).toEqual({
      identities: [`4100 ${EARLY}`, `4102 ${EARLY}`],
      kind: "owned",
    });
  });

  it("names every process in the group that runs anything else, and never reads it as owned", () => {
    const processes = [
      { command: APP, pgid: 4100, pid: 4100, started: EARLY },
      { command: "/bin/zsh", pgid: 4100, pid: 4105, started: EARLY },
    ];
    expect(classifyRecoveryGroup({ expectedExecutables, pgid: 4100, processes, rowAtIso })).toEqual({
      kind: "ambiguous",
      strangers: [{ command: "/bin/zsh", pgid: 4100, pid: 4105, started: EARLY }],
    });
  });

  it("never reads as owned a process that took the group's id and pid after the earlier read", () => {
    const known = new Set([`4100 ${EARLY}`]);
    const processes = [{ command: APP, pgid: 4100, pid: 4100, started: LATER }];
    expect(classifyRecoveryGroup({ expectedExecutables, known, pgid: 4100, processes, rowAtIso })).toEqual({
      kind: "ambiguous",
      strangers: [{ command: APP, pgid: 4100, pid: 4100, started: LATER }],
    });
  });

  it("reads the processes an earlier read owned, and only those, as still owned", () => {
    const known = new Set([`4100 ${EARLY}`, `4102 ${EARLY}`]);
    const processes = [{ command: CODEX_BIN, pgid: 4100, pid: 4102, started: EARLY }];
    expect(classifyRecoveryGroup({ expectedExecutables, known, pgid: 4100, processes, rowAtIso })).toEqual({
      identities: [`4102 ${EARLY}`],
      kind: "owned",
    });
  });

  it("never reads as owned a group whose leader started after the row naming the group was written", () => {
    const processes = [
      { command: APP, pgid: 4100, pid: 4100, started: LATER },
      { command: CODEX_BIN, pgid: 4100, pid: 4102, started: LATER },
    ];
    expect(classifyRecoveryGroup({ expectedExecutables, pgid: 4100, processes, rowAtIso })).toEqual({
      kind: "ambiguous",
      strangers: [{ command: APP, pgid: 4100, pid: 4100, started: LATER }],
    });
  });

  it("reads a leader started in the same second as its row, before the write, as the session's own", () => {
    const processes = [{ command: APP, pgid: 4100, pid: 4100, started: "Tue Nov 10 04:31:32 2026" }];
    expect(
      classifyRecoveryGroup({ expectedExecutables, pgid: 4100, processes, rowAtIso: "2026-11-10T04:31:32.750Z" }),
    ).toEqual({
      identities: ["4100 Tue Nov 10 04:31:32 2026"],
      kind: "owned",
    });
  });

  it("never reads as owned a leader whose start time does not read as one", () => {
    const processes = [{ command: APP, pgid: 4100, pid: 4100, started: "Tue Nox 10 04:31:31 2026" }];
    expect(classifyRecoveryGroup({ expectedExecutables, pgid: 4100, processes, rowAtIso })).toEqual({
      kind: "ambiguous",
      strangers: [{ command: APP, pgid: 4100, pid: 4100, started: "Tue Nox 10 04:31:31 2026" }],
    });
  });
});

describe("startedEpochMs", () => {
  it("reads a UTC start time, a padded day collapsed, on the epoch", () => {
    expect(startedEpochMs({ started: "Mon Nov 9 22:11:24 2026" })).toBe(Date.parse("2026-11-09T22:11:24.000Z"));
  });

  it("answers undefined for a month or shape it does not know", () => {
    expect([startedEpochMs({ started: "Mon Nox 9 22:11:24 2026" }), startedEpochMs({ started: "22:11:24" })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("the three-run reuse of one group id, through the fold and the classifier", () => {
  const CLAUDE_BIN = "/Applications/Acme.app/Contents/Resources/claude";
  const expectedExecutables = [APP, CLAUDE_BIN];
  const opened = ({ sessionId, atIso }: { sessionId: string; atIso: string }): SessionRecoveryEvent => ({
    atIso,
    kind: "opened",
    sessionId,
    spec: CLAUDE,
    vendorSessionId: `thread-${sessionId}`,
  });
  const group = ({ sessionId, atIso }: { sessionId: string; atIso: string }): SessionRecoveryEvent => ({
    atIso,
    expectedExecutables,
    kind: "group-started",
    pgid: 4100,
    sessionId,
  });
  // Run 1: session A's worker leads group 4100, and the app quits with no group-ended row. Run 2: session B's worker
  // is handed pid 4100 again, and the app is killed with B's claude left alive in that group.
  const journal = foldRecoveryJournal({
    lines: [
      group({ atIso: "2026-11-10T01:00:00.000Z", sessionId: "a" }),
      opened({ atIso: "2026-11-10T01:00:01.000Z", sessionId: "a" }),
      group({ atIso: "2026-11-10T02:00:00.000Z", sessionId: "b" }),
      opened({ atIso: "2026-11-10T02:00:01.000Z", sessionId: "b" }),
    ].map((row) => Buffer.from(JSON.stringify(row), "utf8")),
  });
  const bClaude = { command: CLAUDE_BIN, pgid: 4100, pid: 4102, started: "Tue Nov 10 02:00:02 2026" };

  it("gives run 3's resume of A no group to signal, so B's leftover claude is never read as A's", () => {
    const target = resumeTargetOf({ journal, sessionId: "a", spec: CLAUDE });
    expect(target._unsafeUnwrap()).toEqual({ groups: [], vendorSessionId: "thread-a" });
  });

  it("still gives B its own group, which reads as B's while only B's claude is left in it", () => {
    const target = resumeTargetOf({ journal, sessionId: "b", spec: CLAUDE })._unsafeUnwrap();
    expect(target.groups.map((row) => row.atIso)).toEqual(["2026-11-10T02:00:00.000Z"]);
    expect(
      classifyRecoveryGroup({
        expectedExecutables,
        pgid: 4100,
        processes: [bClaude],
        rowAtIso: target.groups[0]!.atIso,
      }),
    ).toEqual({ identities: ["4102 Tue Nov 10 02:00:02 2026"], kind: "owned" });
  });

  it("refuses A's row by its leader's start when B's worker still leads the group, had B's row never been written", () => {
    const bWorker = { command: APP, pgid: 4100, pid: 4100, started: "Tue Nov 10 01:59:59 2026" };
    expect(
      classifyRecoveryGroup({
        expectedExecutables,
        pgid: 4100,
        processes: [bWorker, bClaude],
        rowAtIso: "2026-11-10T01:00:00.000Z",
      }),
    ).toEqual({ kind: "ambiguous", strangers: [bWorker] });
  });
});

describe("parseProcessTable", () => {
  it("reads each pid, group, start and executable, a padded day and spaces in the path included", () => {
    const text =
      "  441 26842 Mon Nov  9 22:11:24 2026     /Applications/Acme.app/Contents/Frameworks/Acme Helper (Renderer)\n" +
      "26842 26842 Tue Nov 10 04:31:31 2026     /bin/zsh\n\n";
    expect(parseProcessTable({ text })._unsafeUnwrap()).toEqual([
      {
        command: "/Applications/Acme.app/Contents/Frameworks/Acme Helper (Renderer)",
        pgid: 26842,
        pid: 441,
        started: "Mon Nov 9 22:11:24 2026",
      },
      { command: "/bin/zsh", pgid: 26842, pid: 26842, started: "Tue Nov 10 04:31:31 2026" },
    ]);
  });

  it("refuses the whole table when one line is not a process", () => {
    const text = "1 1 Mon Nov  9 22:11:24 2026 /sbin/launchd\n1 1 /sbin/launchd\n";
    expect(parseProcessTable({ text })._unsafeUnwrapErr()).toBe(
      "the process table has a line that is not a pid, a group, a start time and a command: 1 1 /sbin/launchd",
    );
  });
});
