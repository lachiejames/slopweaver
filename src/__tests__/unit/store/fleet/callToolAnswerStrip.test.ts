import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { projectAuthoredFile } from "../../../../store/fleet/authoredFile.js";
import { isCallFilePath, stripCallToolAnswers } from "../../../../store/fleet/callToolAnswerStrip.js";

const SEGMENT = '{"atIso":"2026-11-07T04:33:00.000Z","kind":"segment","text":"keep my words","who":"voice"}';
const TOOL_WITH_ANSWER =
  '{"atIso":"2026-11-07T04:33:01.000Z","kind":"tool","name":"board_read","detail":"read the board","refused":false,"answer":"ROW acme-ABC-1 masked output"}';
const TOOL_STRIPPED =
  '{"atIso":"2026-11-07T04:33:01.000Z","kind":"tool","name":"board_read","detail":"read the board","refused":false}';
const TOOL_WITHOUT_ANSWER = '{"atIso":"2026-11-07T04:33:02.000Z","kind":"tool","name":"x","detail":"d","refused":true}';
const RELAY_SAYING_ANSWER = '{"kind":"relay","say":"the \\"answer\\" is no","heard":"answer"}';

const encode = ({ text }: { text: string }): Uint8Array => Buffer.from(text, "utf8");
const decode = ({ bytes }: { bytes: Uint8Array }): string => Buffer.from(bytes).toString("utf8");

describe("stripCallToolAnswers", () => {
  it("removes a tool line's answer and keeps every other field of it", () => {
    const result = stripCallToolAnswers({ bytes: encode({ text: `${TOOL_WITH_ANSWER}\n` }) });
    expect(decode({ bytes: result.bytes })).toBe(`${TOOL_STRIPPED}\n`);
    expect(result.stripped).toBe(1);
  });

  it("keeps every other line byte for byte, an unparseable one and a relay quoting the word included", () => {
    const input = [SEGMENT, TOOL_WITH_ANSWER, "{not json", RELAY_SAYING_ANSWER, TOOL_WITHOUT_ANSWER, ""].join("\n");
    const result = stripCallToolAnswers({ bytes: encode({ text: input }) });
    expect(decode({ bytes: result.bytes })).toBe(
      [SEGMENT, TOOL_STRIPPED, "{not json", RELAY_SAYING_ANSWER, TOOL_WITHOUT_ANSWER, ""].join("\n"),
    );
    expect(result.stripped).toBe(1);
  });

  it("strips an answer key spelled with a JSON escape, which the literal token would miss", () => {
    const result = stripCallToolAnswers({
      bytes: encode({ text: '{"kind":"tool","name":"x","\\u0061nswer":"masked output"}\n' }),
    });
    expect(decode({ bytes: result.bytes })).toBe('{"kind":"tool","name":"x"}\n');
    expect(result.stripped).toBe(1);
  });

  it("keeps a line that is not valid UTF-8 byte for byte while another line is rewritten", () => {
    const invalid = Buffer.from([0xff, 0x7b]);
    const input = Buffer.concat([invalid, encode({ text: `\n${TOOL_WITH_ANSWER}\n` })]);
    const result = stripCallToolAnswers({ bytes: input });
    expect(Buffer.from(result.bytes).equals(Buffer.concat([invalid, encode({ text: `\n${TOOL_STRIPPED}\n` })]))).toBe(
      true,
    );
    expect(result.stripped).toBe(1);
  });

  it("hands back the input itself when no tool line carries an answer", () => {
    const bytes = encode({ text: `${SEGMENT}\n${RELAY_SAYING_ANSWER}\n` });
    const result = stripCallToolAnswers({ bytes });
    expect(result.bytes).toBe(bytes);
    expect(result.stripped).toBe(0);
  });

  it("is idempotent, so a re-import of a stripped body converges", () => {
    const once = stripCallToolAnswers({ bytes: encode({ text: `${SEGMENT}\n${TOOL_WITH_ANSWER}\n` }) });
    const twice = stripCallToolAnswers({ bytes: once.bytes });
    expect(decode({ bytes: twice.bytes })).toBe(decode({ bytes: once.bytes }));
    expect(twice.stripped).toBe(0);
  });
});

describe("isCallFilePath", () => {
  it("names a call file and nothing beside it", () => {
    expect(isCallFilePath({ relativePath: "talk/calls/abc.jsonl" })).toBe(true);
    expect(isCallFilePath({ relativePath: "talk/calls/nested/abc.jsonl" })).toBe(false);
    expect(isCallFilePath({ relativePath: "talk/relays.jsonl" })).toBe(false);
    expect(isCallFilePath({ relativePath: "talk/threads/abc.jsonl" })).toBe(false);
  });
});

describe("projectAuthoredFile over a call file", () => {
  it("stores the stripped bytes and hashes them, while another talk file keeps its answer field", () => {
    const fileModifiedAt = new Date("2026-11-07T04:33:03.000Z");
    const call = projectAuthoredFile({
      bytes: encode({ text: `${TOOL_WITH_ANSWER}\n` }),
      denylist: [],
      fileModifiedAt,
      relativePath: "talk/calls/abc.jsonl",
    });
    expect(unwrap(call).body.body.toString("utf8")).toBe(`${TOOL_STRIPPED}\n`);
    const relays = projectAuthoredFile({
      bytes: encode({ text: `${TOOL_WITH_ANSWER}\n` }),
      denylist: [],
      fileModifiedAt,
      relativePath: "talk/relays.jsonl",
    });
    expect(unwrap(relays).body.body.toString("utf8")).toBe(`${TOOL_WITH_ANSWER}\n`);
  });

  it("refuses a call thread, which is local-only now", () => {
    const thread = projectAuthoredFile({
      bytes: encode({ text: `${SEGMENT}\n` }),
      denylist: [],
      fileModifiedAt: new Date("2026-11-07T04:33:03.000Z"),
      relativePath: "talk/threads/abc.jsonl",
    });
    expect(unwrapErr(thread).code).toBe("UNSTORABLE_AUTHORED_FILE");
  });
});
