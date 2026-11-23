/*
 * `slopweaver talk call-tools` driven through its real argv over a throwaway `--home`, and its text page as lines. A
 * call with no file is an error, never an empty page; a call that ran no tool reads as one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withoutAnswer } from "../../../../../cli/commands/talk/callsRun.js";
import { callToolsLines, runTalkCallTools } from "../../../../../cli/commands/talk/callToolsRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import type { CallEntry } from "../../../../../talk/callRecord.js";
import { appendCallEntries } from "../../../../../talk/callStore.js";

const CALL = "8d74b96f-f72d-4135-be24-b78897fa3926";
const LINK = "https://acme.slack.com/archives/C0SYNPLATFORM/p1759813000000100";

const argvFor = ({ rest }: { rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "talk",
  "call-tools",
  ...rest,
];

const SAID: CallEntry = {
  atIso: "2026-11-01T02:09:59.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "what is ABC-1",
  who: "owner",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-call-tools-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("runTalkCallTools", () => {
  it("reads a call's file as a page, and a call that ran no tool as one too", () => {
    // Writer pid 101, running, so no `ps` is spawned to ask.
    const startOf = () => ({ running: true, start: "t101" });
    unwrap(appendCallEntries({ callId: CALL, entries: [SAID], home, pid: 101, startOf }));
    expect(runTalkCallTools(argvFor({ rest: ["--call", CALL, "--home", home] }))).toBe(EXIT_OK);
    expect(runTalkCallTools(argvFor({ rest: ["--call", CALL, "--home", home, "--json"] }))).toBe(EXIT_OK);
  });

  it("refuses a call with no file as an error, never an empty page", () => {
    expect(runTalkCallTools(argvFor({ rest: ["--call", CALL, "--home", home] }))).toBe(EXIT_ERROR);
  });

  it("refuses a bad page as usage, before anything is read", () => {
    expect(runTalkCallTools(argvFor({ rest: ["--call", CALL, "--limit", "51", "--home", home] }))).toBe(EXIT_USAGE);
  });
});

describe("callToolsLines", () => {
  it("prints each row's header, its link, and its exact answer indented, line by line", () => {
    const lines = callToolsLines({
      page: {
        callId: CALL,
        from: 3,
        nextFrom: 5,
        tools: [
          {
            answer: "line one\nline two",
            atIso: "2026-11-01T02:10:01.000Z",
            detail: "read the thread",
            index: 3,
            name: "slack_thread_after",
            opened: LINK,
            refused: false,
          },
          {
            answer: null,
            atIso: "2026-11-01T02:10:02.000Z",
            detail: "no such issue",
            index: 4,
            name: "code_read",
            opened: undefined,
            refused: true,
          },
        ],
        total: 9,
      },
    });
    expect(lines).toEqual([
      `talk call-tools: call ${CALL}, tool lines 3–4 of 9 — next page --from 5`,
      "[3] 2026-11-01T02:10:01.000Z  slack_thread_after (answered) — read the thread",
      `    opened ${LINK}`,
      "    line one",
      "    line two",
      "[4] 2026-11-01T02:10:02.000Z  code_read (refused) — no such issue",
      "    no answer kept: no model was handed one, or the line was written before answers were kept",
    ]);
  });

  it("prints a reopened call's window step under its row, as numbers", () => {
    const previousCallId = "a0000076-0000-4000-8000-000000000083";
    const lines = callToolsLines({
      page: {
        callId: CALL,
        from: 0,
        nextFrom: null,
        tools: [
          {
            answer: null,
            atIso: "2026-11-06T01:12:03.140Z",
            detail: "handed the reminder after 3002 ms of the 3000 ms window",
            index: 0,
            name: "reopen-reminder",
            opened: undefined,
            refused: false,
            reopenReminder: { elapsedSinceArmedMs: 3_002, phase: "handed", previousCallId, windowMs: 3_000 },
          },
        ],
        total: 1,
      },
    });
    expect(lines).toEqual([
      `talk call-tools: call ${CALL}, tool lines 0–0 of 1 — the last of them`,
      "[0] 2026-11-06T01:12:03.140Z  reopen-reminder (answered) — handed the reminder after 3002 ms of the 3000 ms window",
      `    reopen reminder: phase handed; 3002 ms since armed; window 3000 ms; previous call ${previousCallId}`,
      "    no answer kept: no model was handed one, or the line was written before answers were kept",
    ]);
  });

  it("names a call with no tool line, and a page started past the last", () => {
    const empty = { callId: CALL, from: 0, nextFrom: null, tools: [], total: 0 };
    expect(callToolsLines({ page: empty })).toEqual([`talk call-tools: call ${CALL} ran no tool`]);
    expect(callToolsLines({ page: { ...empty, from: 7, total: 2 } })).toEqual([
      `talk call-tools: call ${CALL} has 2 tool line(s); --from is past the last`,
    ]);
  });
});

describe("withoutAnswer", () => {
  it("leaves a tool line's answer off `talk calls --json`, and a relay as it is", () => {
    const relay = {
      about: "",
      atIso: "2026-11-01T02:10:03.000Z",
      detail: "relayed",
      heard: "ship it",
      kind: "relay",
      outcome: "relayed",
      say: "passing it on",
      turnId: null,
    } as const;
    expect(
      withoutAnswer({
        note: {
          answer: "the whole thread",
          atIso: "2026-11-01T02:10:01.000Z",
          detail: "read the thread",
          kind: "tool",
          name: "slack_thread_after",
          opened: LINK,
          refused: false,
        },
      }),
    ).toEqual({
      atIso: "2026-11-01T02:10:01.000Z",
      detail: "read the thread",
      kind: "tool",
      name: "slack_thread_after",
      opened: LINK,
      refused: false,
    });
    expect(withoutAnswer({ note: relay })).toBe(relay);
  });
});
