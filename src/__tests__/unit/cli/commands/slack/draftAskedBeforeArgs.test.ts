/**
 * `--asked-before` and its companions read as ONE declaration, every meaningless combination refused before a
 * read.
 */
import { describe, expect, it } from "vitest";

import { askedBeforeOf } from "../../../../../cli/commands/slack/draftAskedBeforeArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const PERMALINK = "https://acme.slack.com/archives/C0ISO/p1789000000000100";

describe("askedBeforeOf", () => {
  it("is undeclared with no flag, and none with --asked-before none", () => {
    expect([
      unwrap(askedBeforeOf({ values: {} })),
      unwrap(askedBeforeOf({ values: { "asked-before": "none" } })),
    ]).toEqual(["undeclared", { kind: "none" }]);
  });

  it("reads an earlier ask with a change and its pictures, or with why it was no answer", () => {
    const changed = askedBeforeOf({
      values: { "asked-before": PERMALINK, changed: " spend tripled ", "changed-media": "a.png, b.png" },
    });
    const notAnswered = askedBeforeOf({ values: { "asked-before": PERMALINK, "not-answered": "will look" } });
    expect([unwrap(changed), unwrap(notAnswered)]).toEqual([
      { changed: "spend tripled", changedMedia: ["a.png", "b.png"], kind: "prior", permalink: PERMALINK },
      { changedMedia: [], kind: "prior", notAnswered: "will look", permalink: PERMALINK },
    ]);
  });

  it.each([
    [{ changed: "x" }, "pass --asked-before <permalink>"],
    [{ "asked-before": "none", "not-answered": "x" }, "never asked"],
    [{ "asked-before": "https://example.com/x" }, "neither"],
    [{ "asked-before": PERMALINK, changed: "tripled" }, "at least one picture"],
    [{ "asked-before": PERMALINK, "changed-media": "a.png" }, "needs --changed"],
    [{ "asked-before": PERMALINK, changed: "", "changed-media": "a.png" }, "each need words"],
    [
      { "asked-before": PERMALINK, changed: "tripled", "changed-media": "a.png", "not-answered": "will look" },
      "pass one",
    ],
  ])("refuses %o, saying %s", (values, says) => {
    expect(unwrapErr(askedBeforeOf({ values })).join("\n")).toContain(says);
  });
});
