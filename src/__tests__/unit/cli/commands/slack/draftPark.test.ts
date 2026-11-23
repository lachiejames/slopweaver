/*
 * The park's one pure edge: the console link a parked draft's report points at. The park itself, under the register
 * lock, is driven end to end through `runSlackDraftWithDeps` in `./draftVerb/`.
 */

import { describe, expect, it } from "vitest";

import { draftConsoleUrl } from "../../../../../cli/commands/slack/draftPark.js";

describe("draftConsoleUrl", () => {
  it("opens the queue slide-over on the draft's own post row", () => {
    expect(draftConsoleUrl({ deps: { consoleBase: () => "http://localhost:3000" }, id: "sd-e7511638" })).toBe(
      "http://localhost:3000/queue?open=post%3Asd-e7511638",
    );
  });

  it("escapes an id a URL would otherwise read as syntax", () => {
    expect(draftConsoleUrl({ deps: { consoleBase: () => "http://localhost:3100" }, id: "sd a&b" })).toBe(
      "http://localhost:3100/queue?open=post%3Asd%20a%26b",
    );
  });
});
