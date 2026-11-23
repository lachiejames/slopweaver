/*
 * `draftRecordedLines`: what `slack draft record` prints opens on NOTHING was sent and points at the console
 * panel and the `draft show` that read the parked row back.
 */
import { describe, expect, it } from "vitest";

import { draftRecordedLines } from "../../../../../../cli/commands/slack/draftReport.js";
import { item } from "./harness.js";

describe("draftRecordedLines", () => {
  it("opens on NOTHING was sent, and points at the console panel that shows it", () => {
    const lines = draftRecordedLines({
      consoleUrl: "http://localhost:3000/queue?open=post%3Asd-11111111",
      item: item(),
    });
    expect(lines[0]).toBe("parked sd-11111111 — NOTHING was sent.");
    expect(lines).toContain("read it in the console: http://localhost:3000/queue?open=post%3Asd-11111111");
    expect(lines).toContain("or here: slopweaver slack draft show sd-11111111");
  });
});
