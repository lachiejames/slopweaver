/**
 * One interactive Codex message into the `owner_capture` row it becomes: exactly one text part, byte for byte, keyed
 * by thread, turn and item, and every other shape refused by name rather than joined by a convention nobody chose.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type CodexMessageInput,
  type CodexThreadInput,
  projectCodexMessage,
} from "../../../../store/fleet/codexMessageCapture.js";

const THREAD: CodexThreadInput = { cwd: "/work/acme", id: "th-1", surface: "cli", threadSource: "user" };

/** One history row, with the fields a case does not care about defaulted. */
function message(over: Partial<CodexMessageInput> & { content?: unknown } = {}): CodexMessageInput {
  const { content = [{ text: "ship ABC-1", type: "text" }], ...rest } = over;
  return {
    createdAtMs: Date.UTC(2026, 6, 14, 9, 30, 0),
    itemId: "item-7",
    itemJson: JSON.stringify({ content, type: "userMessage" }),
    threadId: "th-1",
    turnId: "turn-3",
    ...rest,
  };
}

describe("projectCodexMessage", () => {
  it("stores the one text part verbatim, with the instant, the surface, the thread source and the cwd", () => {
    expect(unwrap(projectCodexMessage({ message: message(), path: "/c/h.sqlite", thread: THREAD }))).toEqual({
      attachmentParts: 0,
      row: {
        body: "ship ABC-1",
        bodySha256: createHash("sha256").update("ship ABC-1").digest("hex"),
        byteLength: 10,
        codexSurface: "cli",
        codexThreadSource: "user",
        cwd: "/work/acme",
        saidAt: new Date("2026-07-14T09:30:00.000Z"),
        source: "codex",
        sourceId: "th-1/turn-3/item-7",
        threadId: "th-1",
      },
    });
  });

  it("gives two messages whose ids would join to the same string two distinct source ids", () => {
    const sourceIdOf = ({ threadId, turnId }: { threadId: string; turnId: string }): string =>
      unwrap(
        projectCodexMessage({
          message: message({ itemId: "d", threadId, turnId }),
          path: "/c",
          thread: { ...THREAD, id: threadId },
        }),
      ).row.sourceId;

    expect([sourceIdOf({ threadId: "a/b", turnId: "c" }), sourceIdOf({ threadId: "a", turnId: "b/c" })]).toEqual([
      "a%2Fb/c/d",
      "a/b%2Fc/d",
    ]);
  });

  it("counts an attached image part without reading it", () => {
    const projected = unwrap(
      projectCodexMessage({
        message: message({
          content: [
            { path: "/x.png", type: "localImage" },
            { text: "see this", type: "text" },
          ],
        }),
        path: "/c",
        thread: THREAD,
      }),
    );

    expect(projected.attachmentParts).toBe(1);
    expect(projected.row.body).toBe("see this");
  });

  it("keeps a null thread source as null", () => {
    const projected = unwrap(
      projectCodexMessage({ message: message(), path: "/c", thread: { ...THREAD, threadSource: null } }),
    );

    expect(projected.row.codexThreadSource).toBe(null);
  });

  it("refuses a message with no text part, or with two, naming how many", () => {
    expect(
      unwrapErr(projectCodexMessage({ message: message({ content: [] }), path: "/c", thread: THREAD })).message,
    ).toContain("it has 0 text parts");
    const two = [
      { text: "a", type: "text" },
      { text: "b", type: "text" },
    ];
    expect(
      unwrapErr(projectCodexMessage({ message: message({ content: two }), path: "/c", thread: THREAD })).message,
    ).toContain("it has 2 text parts");
  });

  it("refuses a NUL in the cwd, the thread source or an id it would store, naming the record", () => {
    const refusedOver = ({ thread, over }: { thread: CodexThreadInput; over?: Partial<CodexMessageInput> }): string =>
      unwrapErr(projectCodexMessage({ message: message(over), path: "/c/h.sqlite", thread })).message;

    expect(refusedOver({ thread: { ...THREAD, cwd: "/work\u0000" } })).toBe(
      "/c/h.sqlite#th-1/turn-3/item-7 cannot be stored as the owner's captured words: its cwd contains a NUL, which a Postgres text column cannot hold",
    );
    expect(refusedOver({ thread: { ...THREAD, threadSource: "\ud800" } })).toContain(
      "its thread_source contains a lone surrogate",
    );
    expect(refusedOver({ over: { turnId: "t\u0000" }, thread: THREAD })).toContain("its id contains a NUL");
    // Refused by name before the id is percent-encoded, which would otherwise throw a URIError on it.
    expect(refusedOver({ over: { itemId: "\ud800" }, thread: THREAD })).toContain("its id contains a lone surrogate");
  });

  it("refuses an item that is not a userMessage, naming the message's identity", () => {
    const refused = unwrapErr(
      projectCodexMessage({
        message: message({ itemJson: JSON.stringify({ content: [], type: "agentMessage" }) }),
        path: "/c/h.sqlite",
        thread: THREAD,
      }),
    );

    expect(refused.code).toBe("UNSTORABLE_OWNER_CAPTURE");
    expect(refused.message).toContain("/c/h.sqlite#th-1/turn-3/item-7");
    expect(refused.message).toContain("its item_json is not a userMessage");
  });

  it("refuses content that is not a list of parts, an instant that is not one, and a message of another thread", () => {
    expect(
      unwrapErr(projectCodexMessage({ message: message({ content: "hi" }), path: "/c", thread: THREAD })).message,
    ).toContain("its content is not a list of parts");
    expect(
      unwrapErr(projectCodexMessage({ message: message({ createdAtMs: 0 }), path: "/c", thread: THREAD })).message,
    ).toContain("its created_at_ms is not an instant");
    expect(
      unwrapErr(projectCodexMessage({ message: message({ threadId: "th-2" }), path: "/c", thread: THREAD })).message,
    ).toContain("it is not in thread th-1");
  });
});
