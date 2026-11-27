/**
 * The witness that a call's thread journal never becomes context: what the thinking model read sits in
 * `talk/threads`, and every call reader and recall source reads `talk/calls` by name. A word only the journal holds
 * is found by the journal's own reader — so the input carries it — and by none of the others.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { allCallIds, callsDir, readCalls } from "../../../talk/callStore.js";
import { appendCallThreadEntries, readCallThreadEntries } from "../../../talk/callThreadStore.js";
import { searchCalls, searchSteers } from "../../../talk/recallRead.js";

const CALL = "a0000041-0000-4000-8000-000000000044";

/** A word nothing but this journal holds. */
const ONLY_IN_JOURNAL = "quokkazanzibar";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-thread-iso-"));
  mkdirSync(callsDir({ home }), { recursive: true });
  unwrap(
    appendCallThreadEntries({
      callId: CALL,
      denylist: [],
      instance: undefined,
      entries: [
        {
          callId: CALL,
          capture: {
            arguments: "{}",
            contentItems: [{ text: `the web said ${ONLY_IN_JOURNAL}`, type: "inputText" }],
            kind: "tool-answer",
            success: true,
            threadId: "thr-1",
            tool: "web_search",
            toolCallId: "call-1",
            turnId: "turn-1",
          },
          receivedAtIso: "2026-11-02T05:00:00.000Z",
          version: 1,
          writeId: "00000000-0000-4000-8000-000000000001",
        },
      ],
      home,
      pid: 101,
      startOf: () => ({ running: true, start: "t101" }),
    }),
  );
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("the call-thread journal stays out of every investigation path", () => {
  it("is read by its own reader", () => {
    const read = unwrap(readCallThreadEntries({ callId: CALL, home }));
    expect(JSON.stringify(read.entries)).toContain(ONLY_IN_JOURNAL);
  });

  it("is no call to the call readers", () => {
    expect(unwrap(allCallIds({ home }))).toEqual([]);
    expect(unwrap(readCalls({ home, keep: { limit: 10 } })).calls).toEqual([]);
  });

  it("is matched by no recall source", () => {
    const search = { home, sinceMs: undefined, words: [ONLY_IN_JOURNAL] };
    expect(searchCalls(search)).toEqual({ count: 0, incomplete: undefined, matches: [], searched: true });
    expect(searchSteers(search)).toEqual({ count: 0, incomplete: undefined, matches: [], searched: true });
  });
});
