/**
 * Which record a `transcript:` intake mark may name: one of the owner's turns, or a message another session sent — never an
 * assistant reply. The incident is one chair's (`markTargetRefusal`'s doc): a uuid grepped off the tail of the
 * transcript was the chair's own assistant record, the mark exited 0, and the owner's turn stayed unwitnessed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "../../../lib/result.js";
import { readMarkableRecords } from "../../../supervisor/chairTranscript.js";
import { type MarkableRecords, markTargetRefusal } from "../../../supervisor/intakeMarkTarget.js";

const SESSION = "4c829e9d-d903-49b4-b446-6bb88b198511";
const HIS_TURN = "e721cdaa-00c4-47a4-833e-d881661d492b";
const QUEUED_TURN = "f7e2b91c-bd52-4d07-bcea-2470722eab57";
const ASSISTANT = "f9c3cee1-0000-4000-8000-000000000001";
const PEER = "7a9cc2d0-0e3e-4d1e-9f6e-0a3b64a1c2d3";
const TOOL_RESULT = "8cad5ffd-0000-4000-8000-000000000002";

const scratch: string[] = [];

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** The pointer `--turn` would carry for `uuid` on {@link SESSION}. */
const at = ({ uuid }: { uuid: string }): { sessionId: string; turnUuid: string } => ({
  sessionId: SESSION,
  turnUuid: uuid,
});

/** What a transcript holding one turn of the owner's and one peer message reads as. */
const RECORDS: MarkableRecords = { inboundUuids: new Set([PEER]), ownerTurnUuids: new Set([HIS_TURN]) };

describe("markTargetRefusal", () => {
  it("lets a mark name one of the owner's turns", () => {
    expect(markTargetRefusal({ pointer: at({ uuid: HIS_TURN }), records: ok(RECORDS) })).toBeUndefined();
  });

  it("lets a mark name a message another session sent, which is how a carried report is cleared", () => {
    expect(markTargetRefusal({ pointer: at({ uuid: PEER }), records: ok(RECORDS) })).toBeUndefined();
  });

  it("refuses the chair's own assistant record, naming the pointer and where the owner's turns are listed", () => {
    expect(markTargetRefusal({ pointer: at({ uuid: ASSISTANT }), records: ok(RECORDS) })).toBe(
      `transcript:${SESSION}#${ASSISTANT} names neither one of the owner's turns nor a message another session sent, so a ` +
        `mark on it witnesses nothing — list the owner's turns with \`slopweaver supervisor intake --session ${SESSION}\``,
    );
  });

  it("refuses when the transcript would not read, carrying why — could not check is never a pass", () => {
    expect(markTargetRefusal({ pointer: at({ uuid: HIS_TURN }), records: err(["line 4: torn JSON"]) })).toBe(
      `transcript:${SESSION}#${HIS_TURN} cannot be checked — its transcript would not read: line 4: torn JSON`,
    );
  });
});

/** A `~/.claude` with one transcript for {@link SESSION}: the owner's turn, a reply, a tool result, a queued turn, a peer message. */
function claudeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "intake-mark-target-"));
  scratch.push(home);
  const project = join(home, "projects", "-repo");
  mkdirSync(project, { recursive: true });
  const lines = [
    {
      message: { content: [{ text: "i think this is too concise", type: "text" }], role: "user" },
      timestamp: "2026-09-27T10:00:00.000Z",
      type: "user",
      uuid: HIS_TURN,
    },
    {
      message: { content: "relayed to workspace:414", role: "assistant" },
      timestamp: "2026-09-27T10:00:05.000Z",
      type: "assistant",
      uuid: ASSISTANT,
    },
    {
      message: { content: [{ text: "", type: "text" }], role: "user" },
      timestamp: "2026-09-27T10:00:06.000Z",
      toolUseResult: { stdout: "" },
      type: "user",
      uuid: TOOL_RESULT,
    },
    {
      attachment: {
        commandMode: "prompt",
        origin: { kind: "human" },
        prompt: "perfect, send",
        timestamp: "2026-09-27T10:05:00.000Z",
        type: "queued_command",
      },
      timestamp: "2026-09-27T10:05:00.000Z",
      type: "attachment",
      uuid: QUEUED_TURN,
    },
    {
      attachment: {
        commandMode: "prompt",
        origin: { body: "done", kind: "peer", msg_id: "m-1", name: "some-worker" },
        prompt: "Another Claude session sent a message: done",
        timestamp: "2026-09-27T10:06:00.000Z",
        type: "queued_command",
      },
      timestamp: "2026-09-27T10:06:00.000Z",
      type: "attachment",
      uuid: PEER,
    },
  ];
  writeFileSync(join(project, `${SESSION}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return home;
}

describe("readMarkableRecords", () => {
  it("reads the owner's typed and queued turns and the peer message, and neither the reply nor the tool result", () => {
    const records = unwrap(readMarkableRecords({ projectsDir: join(claudeHome(), "projects"), sessionId: SESSION }));

    expect([...records.ownerTurnUuids]).toEqual([HIS_TURN, QUEUED_TURN]);
    expect([...records.inboundUuids]).toEqual([PEER]);
  });

  it("is an error, not an empty read, when the session has no transcript", () => {
    const records = readMarkableRecords({
      projectsDir: join(claudeHome(), "projects"),
      sessionId: "00000000-0000-4000-8000-000000000000",
    });

    expect(records.isErr()).toBe(true);
    expect(markTargetRefusal({ pointer: at({ uuid: HIS_TURN }), records })).toContain("cannot be checked");
  });
});
