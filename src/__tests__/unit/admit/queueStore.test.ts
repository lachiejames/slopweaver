/**
 * The queue store's round trip, against a real temp home.
 *
 * A genuine filesystem round trip rather than a fake: the thing being checked is that what was appended is
 * what comes back, including across two appends, and a fake edge would only be checking itself.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldQueue, type HeldReply, parseQueueLog } from "../../../admit/queue.js";
import { appendQueueEvent, mintQueueId, queueLogPath, readQueueText } from "../../../admit/queueStore.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-queue-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const HELD: HeldReply = {
  askedBy: "U_COLLEAGUE",
  channel: "C1",
  code: "withhold.reply",
  draft: { kind: "update", tldr: "We render rich_text." },
  messageTs: "1712345678.000100",
  question: "what did we decide?",
  reason: "not the owner",
  surface: "channel",
  threadTs: "1712345678.000100",
};

describe("the queue store", () => {
  it("reads an absent log as the empty string, not an error", () => {
    expect(readQueueText({ home })).toBe("");
  });

  it("puts the log under the home's queue directory", () => {
    expect(queueLogPath({ home })).toBe(join(home, "queue", "withheld.jsonl"));
  });

  it("round-trips one held draft", () => {
    appendQueueEvent({ event: { held: HELD, id: "q-1", kind: "held", tsIso: "t1" }, home });
    const items = foldQueue({ events: parseQueueLog({ text: readQueueText({ home }) }).events });
    expect(items.length).toBe(1);
    expect(items[0]!.held.draft).toEqual(HELD.draft);
  });

  it("APPENDS rather than overwriting, so a second hold cannot lose the first", () => {
    appendQueueEvent({ event: { held: HELD, id: "q-1", kind: "held", tsIso: "t1" }, home });
    appendQueueEvent({ event: { held: HELD, id: "q-2", kind: "held", tsIso: "t2" }, home });
    appendQueueEvent({ event: { id: "q-1", kind: "released", note: "sent by hand", tsIso: "t3" }, home });
    const items = foldQueue({ events: parseQueueLog({ text: readQueueText({ home }) }).events });
    expect(items.map((item) => item.id)).toEqual(["q-2", "q-1"]);
    expect(items[1]!.state).toBe("released");
  });

  it("writes the log owner-only — it holds a question and a draft answer", () => {
    appendQueueEvent({ event: { held: HELD, id: "q-1", kind: "held", tsIso: "t1" }, home });
    // A mode is a bit field; masking off the type bits is how the permission bits are read.
    expect(statSync(queueLogPath({ home })).mode & 0o777).toBe(0o600);
  });

  it("mints an id that can be retyped: prefixed and short", () => {
    const id = mintQueueId();
    expect(id.startsWith("q-")).toBe(true);
    expect(id.length).toBe(10);
  });

  it("mints a different id each time", () => {
    expect(mintQueueId()).not.toBe(mintQueueId());
  });
});
