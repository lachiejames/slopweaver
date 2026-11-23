/**
 * `pickReadMessage` — the ownership read's normalisation, and the ts comparison that makes it safe.
 *
 * The comparison is the whole point. A `conversations.history` read anchored at a `ts` returns the NEAREST
 * message when that exact one is gone, so a caller that trusted the response would read back a NEIGHBOUR's
 * ownership and go on to delete the wrong message. Every "mismatch yields undefined" case below is that
 * property, stated as a test rather than as a comment.
 *
 * This function is also what let the ownership read be extended to `conversations.replies` without a second
 * copy of the normalisation: `history` never returns thread replies, so a threaded message was invisible and
 * `slack delete` refused on a message that was plainly there. The two reads ask different questions and
 * share this one answer shape.
 */
import { describe, expect, it } from "vitest";

import { fileCountOf, pickReadMessage } from "../../../../corpus/slack/writeApi.js";

describe("pickReadMessage", () => {
  it("normalises the candidate whose ts matches exactly", () => {
    const found = pickReadMessage({
      candidates: [{ bot_id: "B1", ts: "111.222", user: "U1" }],
      ts: "111.222",
    });
    expect(found!.ts).toBe("111.222");
    expect(found!.botId).toBe("B1");
    expect(found!.userId).toBe("U1");
    expect(found!.fileIds).toEqual([]);
  });

  it("returns undefined when the only candidate is a NEIGHBOUR — the wrong-target guard", () => {
    expect(
      pickReadMessage({
        candidates: [{ bot_id: "B1", ts: "999.000", user: "U1" }],
        ts: "111.222",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for no candidates at all", () => {
    expect(pickReadMessage({ candidates: [], ts: "111.222" })).toBeUndefined();
  });

  it("finds the match anywhere in the list, which a thread read does not order for us", () => {
    const found = pickReadMessage({
      candidates: [
        { ts: "100.000", user: "U0" },
        { ts: "111.222", user: "U1" },
        { ts: "222.333", user: "U2" },
      ],
      ts: "111.222",
    });
    expect(found!.userId).toBe("U1");
  });

  it("names which attached files are images, so the graph-finding floor never counts a document", () => {
    const found = pickReadMessage({
      candidates: [
        {
          files: [
            { id: "F_SHOT", mimetype: "image/png" },
            { id: "F_DOC", mimetype: "application/pdf" },
            { id: "F_BARE" },
          ],
          ts: "111.222",
        },
      ],
      ts: "111.222",
    });
    expect(found!.fileIds).toEqual(["F_SHOT", "F_DOC", "F_BARE"]);
    expect(found!.imageFileIds).toEqual(["F_SHOT"]);
  });

  it("collects file ids, so an edit re-sends them instead of detaching the media", () => {
    const found = pickReadMessage({
      candidates: [{ files: [{ id: "F1" }, { id: "F2" }], ts: "111.222" }],
      ts: "111.222",
    });
    expect(found!.fileIds).toEqual(["F1", "F2"]);
  });

  it("skips a file entry carrying no id rather than emitting undefined into the list", () => {
    const found = pickReadMessage({
      candidates: [{ files: [{ id: "F1" }, { name: "no-id.png" }], ts: "111.222" }],
      ts: "111.222",
    });
    expect(found!.fileIds).toEqual(["F1"]);
  });

  it("carries the metadata event type, which is how ownership is decided", () => {
    const found = pickReadMessage({
      candidates: [
        {
          metadata: { event_payload: { renderer: "rich_text" }, event_type: "test_card_v1" },
          ts: "111.222",
        },
      ],
      ts: "111.222",
    });
    expect(found!.metadataEventType).toBe("test_card_v1");
    expect(found!.renderer).toBe("rich_text");
  });

  it("ignores a non-record candidate instead of throwing on it", () => {
    expect(pickReadMessage({ candidates: ["nonsense", 7, null], ts: "111.222" })).toBeUndefined();
  });

  it("omits botId and userId when the message carries neither", () => {
    const found = pickReadMessage({ candidates: [{ ts: "111.222" }], ts: "111.222" });
    expect(found!.botId).toBeUndefined();
    expect(found!.userId).toBeUndefined();
  });

  it("carries `edited.ts` through as Slack reported it", () => {
    const found = pickReadMessage({
      candidates: [{ edited: { ts: "333.444", user: "U1" }, ts: "111.222" }],
      ts: "111.222",
    });
    expect(found!.editedTs).toBe("333.444");
  });

  it("omits editedTs only when there is no `edited` block at all", () => {
    expect(pickReadMessage({ candidates: [{ ts: "111.222" }], ts: "111.222" })!.editedTs).toBeUndefined();
  });

  it("reports an `edited` block it cannot read as an edit, rather than as no edit", () => {
    // A NUMBER where Slack documents a string. Dropped, it makes a repaired message look untouched, and a
    // supersession deletes it — as shown against the real wiring. Nothing can
    // place this in time, which is what makes every caller of `editedAtOrAfter` refuse.
    const found = pickReadMessage({
      candidates: [{ edited: { ts: 333.444, user: "U1" }, ts: "111.222" }],
      ts: "111.222",
    });
    expect(found!.editedTs).toBe("unreadable");
  });

  it("reports an `edited` block with no ts at all the same way", () => {
    const found = pickReadMessage({ candidates: [{ edited: { user: "U1" }, ts: "111.222" }], ts: "111.222" });
    expect(found!.editedTs).toBe("unreadable");
  });

  it("reports an `edited` KEY carrying undefined as unreadable — presence is the question, not the value", () => {
    // Not a shape a JSON response can hold, which is exactly why the check is `"edited" in message`: a
    // criterion written against `undefined` leaves one hole nobody can see in a fixture.
    const found = pickReadMessage({ candidates: [{ edited: undefined, ts: "111.222" }], ts: "111.222" });
    expect(found!.editedTs).toBe("unreadable");
  });

  it("reports a PRESENT `edited` that is not an object at all as unreadable, whatever shape it took", () => {
    // The same class one level up, and the second half of the r2 review's finding: `edited: [{ts}]` walked
    // through an `isRecord` test that returned "no edit" for everything it could not read.
    const shapes: readonly unknown[] = [[{ ts: "333.444" }], "333.444", 7, null, true];
    const seen = shapes.map(
      (edited) => pickReadMessage({ candidates: [{ edited, ts: "111.222" }], ts: "111.222" })!.editedTs,
    );
    expect(seen).toEqual(["unreadable", "unreadable", "unreadable", "unreadable", "unreadable"]);
  });
});

/**
 * `fileCountOf` — the media guard's number, and the fail-closed reading of an unreadable message.
 *
 * The caller DELETES the message on zero, so which situations count as zero is a safety decision rather
 * than arithmetic. It used to be an inline expression over a raw history response, which is how a threaded
 * card came to count zero forever: `conversations.history` never returns thread replies, so the message was
 * never found, and "not found" and "no files" were the same answer with no way to tell them apart.
 */
describe("fileCountOf", () => {
  it("counts the files a message carries", () => {
    const message = pickReadMessage({
      candidates: [{ files: [{ id: "F1" }, { id: "F2" }], ts: "111.222" }],
      ts: "111.222",
    });
    expect(fileCountOf({ message })).toBe(2);
  });

  it("counts zero for a message that carries no files", () => {
    expect(fileCountOf({ message: pickReadMessage({ candidates: [{ ts: "111.222" }], ts: "111.222" }) })).toBe(0);
  });

  it("counts zero for a message no read could find, so the guard fails closed", () => {
    expect(fileCountOf({ message: undefined })).toBe(0);
  });
});

describe("pickReadMessage, askIdentity", () => {
  it("carries an answer card's askIdentity through, so an edit can inherit which ask it answers", () => {
    const found = pickReadMessage({
      candidates: [
        {
          bot_id: "B1",
          metadata: {
            event_payload: {
              artifactFingerprint: "abc",
              askIdentity: { channel: "C1", messageTs: "1.2", quality: "exact", threadTs: "1.0" },
              renderer: "slack-assistant-answer-v2",
              schemaVersion: 2,
            },
            event_type: "slopweaver_assistant_answer_v2",
          },
          ts: "1789467933.781459",
        },
      ],
      ts: "1789467933.781459",
    });
    expect(found!.askIdentity).toEqual({ channel: "C1", messageTs: "1.2", quality: "exact", threadTs: "1.0" });
    expect(found!.metadataEventType).toBe("slopweaver_assistant_answer_v2");
    expect(found!.renderer).toBe("slack-assistant-answer-v2");
  });

  it("omits askIdentity entirely on a card that carries none, rather than reporting an empty one", () => {
    const found = pickReadMessage({
      candidates: [
        {
          bot_id: "B1",
          metadata: {
            event_payload: { artifactFingerprint: "abc", renderer: "slack-card-v1", schemaVersion: 1 },
            event_type: "slopweaver_card",
          },
          ts: "1789467933.781459",
        },
      ],
      ts: "1789467933.781459",
    });
    expect("askIdentity" in found!).toBe(false);
  });
});

describe("pickReadMessage, turnId and pollId", () => {
  const read = ({ payload }: { payload: Record<string, unknown> }) =>
    pickReadMessage({
      candidates: [{ bot_id: "B1", metadata: { event_payload: payload, event_type: "e" }, ts: "1.5" }],
      ts: "1.5",
    })!;

  it("carries a checklist's turnId and a poll's pollId, so an edit inherits them", () => {
    expect(read({ payload: { renderer: "slack-turn-v1", turnId: "turn-abc" } }).turnId).toBe("turn-abc");
    expect(read({ payload: { pollId: "poll-1", renderer: "slack-poll-v1" } }).pollId).toBe("poll-1");
  });

  it("omits an empty or non-string id rather than carrying one an edit would inherit", () => {
    const found = read({ payload: { pollId: 7, renderer: "slack-turn-v1", turnId: "" } });
    expect("turnId" in found).toBe(false);
    expect("pollId" in found).toBe(false);
  });
});
