import { describe, expect, it } from "vitest";

import {
  formatCodexRolloutPointer,
  isRolloutBasename,
  parseCodexRolloutPointer,
} from "../../../codex/rolloutOwnerTurnPointer.js";
import { type CodexRolloutLine, parseCodexOwnerTurns } from "../../../codex/rolloutOwnerTurns.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/* Every rollout here is hand-written against the public `codex-rs` RolloutLine envelope; none is a real file. */

const THREAD = "a0000201-0000-4000-8000-000000000001";
const ROLLOUT = `rollout-2026-11-20T09-00-00-${THREAD}.jsonl`;

/** One envelope line. */
const env = ({ type, payload, at = "2026-11-20T09:00:00.000Z" }: { type: string; payload: unknown; at?: string }) =>
  JSON.stringify({ payload, timestamp: at, type });

const META = env({ payload: { id: THREAD, cwd: "/w" }, type: "session_meta" });
const userMessage = ({ text, at }: { text: string; at: string }): string =>
  env({ at, payload: { message: text, type: "user_message" }, type: "event_msg" });

/** Lines addressed the way the streaming reader addresses them: 1-based, byte offset of each start. */
const linesOf = ({ raw }: { raw: readonly string[] }): CodexRolloutLine[] => {
  let offset = 0;
  return raw.map((line, index) => {
    const addressed = { byteOffset: offset, line, lineNumber: index + 1, undecodable: false };
    offset += Buffer.byteLength(line, "utf8") + 1;
    return addressed;
  });
};

const parse = ({ raw }: { raw: readonly string[] }) =>
  parseCodexOwnerTurns({ lines: linesOf({ raw }), rolloutName: ROLLOUT, threadId: THREAD });

describe("parseCodexOwnerTurns", () => {
  it("counts only user_message events, addressed by the byte offset their line starts at", () => {
    const first = userMessage({ at: "2026-11-20T09:01:00.000Z", text: "merge it" });
    const raw = [
      META,
      env({
        payload: { content: [{ text: "<environment_context>", type: "input_text" }], role: "user", type: "message" },
        type: "response_item",
      }),
      first,
      env({
        payload: { content: [{ text: "merge it", type: "input_text" }], role: "user", type: "message" },
        type: "response_item",
      }),
      env({ payload: { message: "done", type: "agent_message" }, type: "event_msg" }),
      env({ payload: { summary: "earlier" }, type: "compacted" }),
      userMessage({ at: "2026-11-20T09:05:00.000Z", text: "héllo" }),
    ];
    const secondOffset = [META, raw[1]!, first, raw[3]!, raw[4]!, raw[5]!].reduce(
      (sum, line) => sum + Buffer.byteLength(line, "utf8") + 1,
      0,
    );
    const firstOffset = Buffer.byteLength(META, "utf8") + 1 + Buffer.byteLength(raw[1]!, "utf8") + 1;

    const turns = unwrap(parse({ raw }));

    expect(turns.map((turn) => [turn.text, turn.timestamp, turn.pointer, turn.lineNumber])).toEqual([
      ["merge it", "2026-11-20T09:01:00.000Z", `codex-rollout:${THREAD}#${ROLLOUT}@${String(firstOffset)}`, 3],
      ["héllo", "2026-11-20T09:05:00.000Z", `codex-rollout:${THREAD}#${ROLLOUT}@${String(secondOffset)}`, 7],
    ]);
    expect(turns[0]!.turnId).toBe(`${ROLLOUT}@${String(firstOffset)}`);
  });

  it("counts an empty or image-only submission as a turn, so it is never silently dropped", () => {
    const raw = [META, env({ payload: { images: ["data:x"], message: "", type: "user_message" }, type: "event_msg" })];

    expect(unwrap(parse({ raw })).map((turn) => turn.text)).toEqual([""]);
  });

  it("reads a rollout with no owner turn as an empty list, and skips blank lines", () => {
    expect(unwrap(parse({ raw: [META, "", "  "] }))).toEqual([]);
  });

  it("accepts a later session_meta for the same thread — a resume appending to its file", () => {
    const raw = [META, userMessage({ at: "2026-11-20T09:01:00.000Z", text: "a" }), META];

    expect(unwrap(parse({ raw })).length).toBe(1);
  });

  it.each([
    ["not JSON", ["{torn"], "ROLLOUT_LINE_INVALID"],
    ["not an object", ["[1]"], "ROLLOUT_LINE_INVALID"],
    ["no item type", [JSON.stringify({ payload: {}, timestamp: "2026-11-20T09:00:00.000Z" })], "ROLLOUT_LINE_INVALID"],
    ["an unknown top-level kind", [env({ payload: {}, type: "owner_prompt" })], "ROLLOUT_ITEM_UNRECOGNISED"],
    [
      "an unreadable instant",
      [env({ at: "yesterday", payload: { id: THREAD }, type: "session_meta" })],
      "ROLLOUT_LINE_INVALID",
    ],
    [
      "a first line that is not session_meta",
      [userMessage({ at: "2026-11-20T09:01:00.000Z", text: "a" })],
      "SESSION_META_INVALID",
    ],
    ["a session_meta with no id", [env({ payload: {}, type: "session_meta" })], "SESSION_META_INVALID"],
    [
      "another thread's session_meta",
      [env({ payload: { id: "a0000201-0000-4000-8000-000000000099" }, type: "session_meta" })],
      "SESSION_THREAD_MISMATCH",
    ],
    [
      "paginated history",
      [env({ payload: { history_mode: "paginated", id: THREAD }, type: "session_meta" })],
      "SESSION_HISTORY_UNSUPPORTED",
    ],
    [
      "an unknown history mode",
      [env({ payload: { history_mode: "sparse", id: THREAD }, type: "session_meta" })],
      "SESSION_META_INVALID",
    ],
    [
      "a user_message with no message",
      [META, env({ payload: { type: "user_message" }, type: "event_msg" })],
      "USER_MESSAGE_INVALID",
    ],
    ["an event_msg with no type", [META, env({ payload: {}, type: "event_msg" })], "ROLLOUT_LINE_INVALID"],
    [
      "an event_msg with an empty type",
      [META, env({ payload: { type: "" }, type: "event_msg" })],
      "ROLLOUT_LINE_INVALID",
    ],
    [
      "an input-like event that is not user_message",
      [META, env({ payload: { type: "steer_input" }, type: "event_msg" })],
      "ROLLOUT_ITEM_UNRECOGNISED",
    ],
    [
      "an input-like event in another case",
      [META, env({ payload: { type: "UserInput" }, type: "event_msg" })],
      "ROLLOUT_ITEM_UNRECOGNISED",
    ],
    ["no line at all", [], "SESSION_META_INVALID"],
  ])("fails closed on %s, naming the check", (_what, raw, code) => {
    const read = parse({ raw });

    expect(unwrapErr(read).code).toBe(code);
  });

  it("fails closed on an undecodable line, and keeps the first failure over a later one", () => {
    const lines: CodexRolloutLine[] = [
      { byteOffset: 0, line: META, lineNumber: 1, undecodable: false },
      { byteOffset: 300, line: "�", lineNumber: 2, undecodable: true },
      { byteOffset: 302, line: "{torn", lineNumber: 3, undecodable: false },
    ];
    const read = parseCodexOwnerTurns({ lines, rolloutName: ROLLOUT, threadId: THREAD });

    expect(unwrapErr(read).message).toBe("line 2: the line is not UTF-8");
  });

  it("refuses an undecodable line even when its placeholder text is blank", () => {
    const lines: CodexRolloutLine[] = [
      { byteOffset: 0, line: META, lineNumber: 1, undecodable: false },
      { byteOffset: 300, line: " ", lineNumber: 2, undecodable: true },
    ];
    const read = parseCodexOwnerTurns({ lines, rolloutName: ROLLOUT, threadId: THREAD });

    expect(unwrapErr(read).message).toBe("line 2: the line is not UTF-8");
  });
});

describe("codex-rollout pointers", () => {
  it("round-trips the one spelling the writer produces", () => {
    const pointer = { byteOffset: 4096, rolloutName: ROLLOUT, threadId: THREAD };
    const text = formatCodexRolloutPointer({ pointer });

    expect(text).toBe(`codex-rollout:${THREAD}#${ROLLOUT}@4096`);
    expect(parseCodexRolloutPointer({ text })).toEqual(pointer);
  });

  it.each([
    `transcript:${THREAD}#x`,
    `codex-rollout:${THREAD}`,
    `codex-rollout:${THREAD}#${ROLLOUT}`,
    `codex-rollout:${THREAD}#${ROLLOUT}@012`,
    `codex-rollout:${THREAD}#${ROLLOUT}@-1`,
    `codex-rollout:${THREAD}#${ROLLOUT}@99999999999999999999`,
    `codex-rollout:${THREAD}#../${ROLLOUT}@0`,
    `codex-rollout:${THREAD}#notes.txt@0`,
    `codex-rollout:../x#${ROLLOUT}@0`,
    `CODEX-ROLLOUT:${THREAD}#${ROLLOUT}@0`,
  ])("refuses %s", (text) => {
    expect(parseCodexRolloutPointer({ text })).toBeUndefined();
  });

  it("knows a rollout basename from a path or another file", () => {
    expect(
      [ROLLOUT, `a/${ROLLOUT}`, "rollout-.jsonl", "rollout-x.json"].map((name) => isRolloutBasename({ name })),
    ).toEqual([true, false, false, false]);
  });
});
