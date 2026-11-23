/**
 * The `witness` verbs end to end over a throwaway home: the real runners, the real journal on disk and the
 * real per-home lock. Every case stays on a path that refuses or finishes BEFORE cmux — a dispatch is only
 * driven where the journal refuses it — so nothing here boots a workspace.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { productionWitnessJournalDeps } from "../../../../../cli/commands/witness/deps.js";
import { runWitnessDispatch, witnessDispatchCommand } from "../../../../../cli/commands/witness/dispatch.js";
import { runWitnessHelp, witnessHelpCommand, witnessHelpExitCode } from "../../../../../cli/commands/witness/help.js";
import {
  runWitnessList,
  threadStandDownListRow,
  witnessListCommand,
  witnessListRow,
} from "../../../../../cli/commands/witness/list.js";
import { runWitnessResume, witnessResumeCommand } from "../../../../../cli/commands/witness/resume.js";
import { runWitnessSettle, witnessSettleCommand } from "../../../../../cli/commands/witness/settle.js";
import {
  runWitnessStandDown,
  witnessStandDownCommand,
  witnessStandDownExitCode,
} from "../../../../../cli/commands/witness/standDown.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { WitnessHelpErrors } from "../../../../../live/witness/helpErrors.js";
import { foldWitnessJournal } from "../../../../../live/witness/journal.js";
import { appendWitnessEvent, readWitnessJournal } from "../../../../../live/witness/journalStore.js";
import { threadStandDown } from "../../../../../live/witness/standDown.js";
import { WitnessStandDownErrors } from "../../../../../live/witness/standDownErrors.js";
import { type WitnessDispatchedEvent, type WitnessKey, witnessIdOf } from "../../../../../live/witness/types.js";

const KEY: WitnessKey = { channel: "C0SYN000000001", messageTs: "1789000000.000200", threadTs: "1789000000.000100" };
const WITNESS_ID = witnessIdOf({ key: KEY });
const KEY_FLAGS = ["--channel", KEY.channel, "--thread-ts", KEY.threadTs, "--message-ts", KEY.messageTs];

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh, empty state home this file removes afterwards. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-witness-verbs-"));
  homes.push(home);
  return home;
}

/** The full argv a verb's runner receives. */
function argvOf({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "witness", verb, ...rest];
}

/** A `dispatched` row as `dispatchWitness` writes it, for a worker this file never boots. */
function dispatchedRow(): WitnessDispatchedEvent {
  return {
    ...KEY,
    host: "claude-code",
    kind: "dispatched",
    model: "sonnet",
    schemaVersion: 1,
    surfaceId: "surface-id-1",
    surfaceRef: "surface:1",
    text: "the deploy finished cleanly",
    tsIso: "2026-10-05T01:00:00.000Z",
    witnessId: WITNESS_ID,
    workspaceId: "workspace-id-1",
    workspaceRef: "workspace:1",
  };
}

describe("the witness verbs", () => {
  it("binds each manifest export to its runner", () => {
    expect(witnessDispatchCommand).toBe(runWitnessDispatch);
    expect(witnessHelpCommand).toBe(runWitnessHelp);
    expect(witnessListCommand).toBe(runWitnessList);
    expect(witnessResumeCommand).toBe(runWitnessResume);
    expect(witnessSettleCommand).toBe(runWitnessSettle);
    expect(witnessStandDownCommand).toBe(runWitnessStandDown);
  });

  it("refuses a stand-down with no why as a usage error before any home, token or Slack read", async () => {
    const home = freshHome();
    const argv = argvOf({ rest: [...KEY_FLAGS, "--home", home], verb: "stand-down" });

    expect(await runWitnessStandDown(argv)).toBe(EXIT_USAGE);
    expect(unwrap(readWitnessJournal({ home }))).toEqual([]);
  });

  it("stands a whole thread down over a home with NO Slack token, where every message already ended", async () => {
    const home = freshHome();
    const settledRow = {
      ...KEY,
      kind: "settled",
      outcome: "nothing-checkable",
      schemaVersion: 1,
      tsIso: "2026-10-05T01:00:00.000Z",
      why: "owner signing off; no claim",
      witnessId: WITNESS_ID,
    } as const;
    unwrap(appendWitnessEvent({ event: settledRow, home }));
    const rest = ["--channel", KEY.channel, "--thread-ts", KEY.threadTs, "--why", "owner: stop witnessing it"];

    expect(await runWitnessStandDown(argvOf({ rest: [...rest, "--home", home], verb: "stand-down" }))).toBe(EXIT_OK);
    expect(await runWitnessStandDown(argvOf({ rest: [...rest, "--home", home], verb: "stand-down" }))).toBe(EXIT_OK);
    const events = unwrap(readWitnessJournal({ home }));
    const standing = threadStandDown({ channel: KEY.channel, events, threadTs: KEY.threadTs })!;

    expect(standing.kind).toBe("thread-stood-down");
    expect(events.filter((event) => event.kind === "thread-stood-down")).toHaveLength(1);
    expect(foldWitnessJournal({ events }).size).toBe(1);
  });

  it.each([
    [WitnessStandDownErrors.locked({ reason: "held" }), EXIT_DEFERRED],
    [WitnessStandDownErrors.whyBlank(), EXIT_USAGE],
    [WitnessStandDownErrors.reactionFailed({ emoji: "zipper_mouth_face", why: "invalid_name" }), EXIT_ERROR],
    [WitnessStandDownErrors.alreadySettled({ outcome: "posted", witnessId: WITNESS_ID }), EXIT_EXPECTED_EMPTY],
    [WitnessStandDownErrors.alreadyDispatched({ witnessId: WITNESS_ID }), EXIT_EXPECTED_EMPTY],
  ] as const)("exits stand-down's %s.code as %i", (error, code) => {
    expect(witnessStandDownExitCode({ error })).toBe(code);
  });

  it("exits THREAD_STOOD_DOWN as a legitimate policy no", () => {
    expect(
      witnessHelpExitCode({
        error: WitnessHelpErrors.threadStoodDown({ key: KEY, stoodDownAt: `message ${KEY.messageTs}` }),
      }),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("settles a line by coordinates once, and refuses a second terminal without writing it", async () => {
    const home = freshHome();
    const settle = argvOf({ rest: [...KEY_FLAGS, "--as", "nothing-checkable", "--home", home], verb: "settle" });
    expect(await runWitnessSettle(settle)).toBe(EXIT_OK);
    expect(await runWitnessSettle(settle)).toBe(EXIT_ERROR);
    const events = unwrap(readWitnessJournal({ home }));
    expect(events).toMatchObject([{ kind: "settled", witnessId: WITNESS_ID }]);
  });

  it("refuses a help with no author as a usage error before any home, token or Slack read", async () => {
    const home = freshHome();
    const argv = argvOf({ rest: [...KEY_FLAGS, "--text", "anything?", "--home", home], verb: "help" });

    expect(await runWitnessHelp(argv)).toBe(EXIT_USAGE);
    expect(unwrap(readWitnessJournal({ home }))).toEqual([]);
  });

  it.each([
    [WitnessHelpErrors.locked({ reason: "held" }), EXIT_DEFERRED],
    [WitnessHelpErrors.state({ why: "malformed" }), EXIT_ERROR],
    [WitnessHelpErrors.captureDropped({ witnessId: WITNESS_ID }), EXIT_ERROR],
    [WitnessHelpErrors.notOwnThread({ key: KEY }), EXIT_EXPECTED_EMPTY],
    [WitnessHelpErrors.budgetSpent({ cap: 2, day: "2026-10-05", key: KEY }), EXIT_EXPECTED_EMPTY],
    [WitnessHelpErrors.highStakesRefused({ lines: ["undefended"] }), EXIT_EXPECTED_EMPTY],
  ] as const)("exits %s.code as %i", (error, code) => {
    expect(witnessHelpExitCode({ error })).toBe(code);
  });

  it("refuses a settle with no outcome as a usage error, journalling nothing", async () => {
    const home = freshHome();
    expect(await runWitnessSettle(argvOf({ rest: [...KEY_FLAGS, "--home", home], verb: "settle" }))).toBe(EXIT_USAGE);
    expect(unwrap(readWitnessJournal({ home }))).toEqual([]);
  });

  it("refuses to dispatch a settled witness from the journal alone, before any host or workspace", async () => {
    const home = freshHome();
    unwrap(
      appendWitnessEvent({
        event: {
          ...KEY,
          kind: "settled",
          outcome: "nothing-checkable",
          schemaVersion: 1,
          tsIso: "2026-10-05T01:00:00.000Z",
          witnessId: WITNESS_ID,
        },
        home,
      }),
    );
    const rest = [...KEY_FLAGS, "--text", "fixed", "--model", "sonnet", "--home", home];
    expect(await runWitnessDispatch(argvOf({ rest, verb: "dispatch" }))).toBe(EXIT_ERROR);
    expect(unwrap(readWitnessJournal({ home })).length).toBe(1);
  });

  it("refuses a dispatch with no model pin as a usage error", async () => {
    const home = freshHome();
    const rest = [...KEY_FLAGS, "--text", "fixed", "--home", home];
    expect(await runWitnessDispatch(argvOf({ rest, verb: "dispatch" }))).toBe(EXIT_USAGE);
  });

  it("resumes a live worker, finishes cleanly on a settled one, and refuses an id the journal lacks", () => {
    const home = freshHome();
    unwrap(appendWitnessEvent({ event: dispatchedRow(), home }));
    expect(runWitnessResume(argvOf({ rest: [WITNESS_ID, "--home", home], verb: "resume" }))).toBe(EXIT_OK);
    expect(runWitnessResume(argvOf({ rest: ["w-0000000000000000", "--home", home], verb: "resume" }))).toBe(EXIT_ERROR);
  });

  it("lists an empty home and a populated one, and refuses an unknown flag", () => {
    const home = freshHome();
    expect(runWitnessList(argvOf({ rest: ["--home", home], verb: "list" }))).toBe(EXIT_OK);
    unwrap(appendWitnessEvent({ event: dispatchedRow(), home }));
    expect(runWitnessList(argvOf({ rest: ["--home", home, "--json"], verb: "list" }))).toBe(EXIT_OK);
    expect(runWitnessList(argvOf({ rest: ["--home", home, "--bogus"], verb: "list" }))).toBe(EXIT_USAGE);
  });

  it("prints a live row with its state, coordinates, instant and workspace", () => {
    const record = foldWitnessJournal({ events: [dispatchedRow()] }).get(WITNESS_ID)!;
    expect(witnessListRow({ record })).toBe(
      `${WITNESS_ID}  live              C0SYN000000001/1789000000.000200  2026-10-05T01:00:00.000Z  workspace:1`,
    );
  });

  it("renders a whole-thread stand-down on its thread, with its why", () => {
    const row = {
      channel: KEY.channel,
      kind: "thread-stood-down",
      schemaVersion: 1,
      standDownId: "t-0123456789abcdef",
      threadTs: KEY.threadTs,
      tsIso: "2026-10-05T01:00:00.000Z",
      why: "owner: stop",
    } as const;

    expect(threadStandDownListRow({ row })).toBe(
      "t-0123456789abcdef  thread-stood-down C0SYN000000001/1789000000.000100  2026-10-05T01:00:00.000Z  owner: stop",
    );
  });
});

describe("productionWitnessJournalDeps", () => {
  it("holds one lock per home: a second take is refused until the first is released", () => {
    const deps = productionWitnessJournalDeps({ home: freshHome() });
    const first = deps.lock();
    expect(first.isOk()).toBe(true);
    expect(deps.lock().isErr()).toBe(true);
    unwrap(first).release();
    const again = deps.lock();
    expect(again.isOk()).toBe(true);
    unwrap(again).release();
  });

  it("reads back exactly the row it appended", () => {
    const deps = productionWitnessJournalDeps({ home: freshHome() });
    unwrap(deps.append({ event: dispatchedRow() }));
    expect(unwrap(deps.readJournal())).toEqual([dispatchedRow()]);
  });
});
