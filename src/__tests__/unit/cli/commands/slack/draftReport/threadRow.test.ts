/*
 * A thread row, and a top-level row whose why says thread reply: a thread row lists and shows its parent and
 * sends with `slack reply`, while a top-level row whose why says thread reply prints only the re-record.
 */
import { describe, expect, it } from "vitest";

import { draftListDocument } from "../../../../../../cli/commands/slack/draftListDocument.js";
import { draftListRow, draftShowLines } from "../../../../../../cli/commands/slack/draftReport.js";
import { item, NO_MEDIA } from "./harness.js";

describe("a thread row, and a top-level row whose why says thread reply", () => {
  const thread = {
    shape: "thread" as const,
    threadParent: { text: "staging pool exhausted", userId: "U0JONAH" },
    threadTs: "1789407961.767649",
  };

  it("lists a thread row as a thread in its channel", () => {
    expect(draftListRow({ item: item({ over: thread }), media: [] })).toContain("thread in #iso-27001");
  });

  it("shows the parent it replies under, and the reply command that sends it", () => {
    const row = item({ over: thread });
    const lines = draftShowLines({ item: row });
    expect(lines).toContain("thread   replies under 1789407961.767649 (U0JONAH): staging pool exhausted");
    expect(lines).toContain(
      `to send it as shown: slopweaver slack reply --as me --draft sd-11111111 --approve ${row.draft.digest}`,
    );
  });

  it("names the root alone for a thread row recorded without the parent", () => {
    const lines = draftShowLines({ item: item({ over: { shape: "thread", threadTs: "1789407961.767649" } }) });
    expect(lines).toContain("thread   replies under 1789407961.767649");
  });

  it("prints no send command for a top-level row whose why says thread reply — only the re-record", () => {
    const lines = draftShowLines({ item: item({ over: { why: "THREAD REPLY, not top-level" } }) });
    expect(lines.filter((line) => line.startsWith("to send it as shown:"))).toEqual([]);
    expect(lines).toContain(
      "NOT SENDABLE: parked top-level, but its why says thread reply — the release refuses it. Re-record it into its " +
        "thread, which spends this row and carries their yes: slopweaver slack draft record --thread-ts <root ts> " +
        "--supersedes sd-11111111",
    );
  });

  it("lists each held row with its release and a resolved row with none", () => {
    const held = item({ over: thread });
    const dropped = item({ over: { id: "sd-22222222" }, state: "dropped" });
    const document = draftListDocument({ items: [held, dropped], mediaOf: NO_MEDIA, people: [] });
    expect(document.items.map((row) => row.release)).toEqual([
      {
        command: `slopweaver slack reply --as me --draft sd-11111111 --approve ${held.draft.digest}`,
        kind: "send",
      },
      undefined,
    ]);
  });

  it("prints the bot handles the profile declares, and no field at all when it declares none", () => {
    const held = item({ over: thread });
    const declared = draftListDocument({ botHandles: ["acme-bot"], items: [held], mediaOf: NO_MEDIA, people: [] });
    expect(declared.botHandles).toEqual(["acme-bot"]);
    const bare = draftListDocument({ botHandles: [], items: [held], mediaOf: NO_MEDIA, people: [] });
    expect(Object.keys(bare)).toEqual(["items", "people", "picks"]);
  });
});
