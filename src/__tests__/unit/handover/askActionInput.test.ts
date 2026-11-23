import { describe, expect, it } from "vitest";

import type { AskAction } from "../../../handover/askAction.js";
import { AskActionInputErrors, actionFromText } from "../../../handover/askActionInput.js";
import { askActionFrom } from "../../../handover/askActionWire.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The whole action every case starts from — one tagged person, one place to send it. */
const WHOLE: AskAction = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review — one approval and it lands tonight.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

describe("actionFromText", () => {
  it("round-trips a whole document back to the action it spells", () => {
    const read = actionFromText({ label: "--action", text: JSON.stringify(WHOLE) });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual(WHOLE);
  });

  it("reports bytes that are not JSON as NOT_JSON, carrying the parser's own words", () => {
    const read = actionFromText({ label: "--action", text: "not json at all" });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("NOT_JSON");
    expect(unwrapErr(read).message).toContain("--action is not JSON:");
  });

  it("reports a document that parses to nothing as EMPTY, not as broken", () => {
    const read = actionFromText({ label: "--action", text: "null" });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)).toEqual(AskActionInputErrors.empty());
  });

  it("reports a parsed action that breaks a rule as BROKEN, carrying that rule's own sentence", () => {
    const read = actionFromText({ label: "--action", text: JSON.stringify({ ...WHOLE, body: "   " }) });
    expect(read.isErr()).toBe(true);
    const error = unwrapErr(read);
    expect(error.code).toBe("BROKEN");
    expect(error.message).toBe(
      "the action does not read: the drafted message is empty — an action the owner cannot read is not an action",
    );
  });

  // A destination label is drawn beside its positional letter, so a typed one draws two.
  it("refuses a destination label that opens with its own letter as BROKEN, while a stored one still reads", () => {
    const lettered = {
      ...WHOLE,
      destinations: [{ ...WHOLE.destinations[0]!, label: "C · Post it to #delivery" }],
    } satisfies AskAction;
    const written = actionFromText({ label: "--action", text: JSON.stringify(lettered) });
    expect(unwrapErr(written).code).toBe("BROKEN");
    expect(unwrapErr(written).message).toContain(`the channel's label opens with its own letter "C"`);
    expect(askActionFrom({ value: lettered })).toEqual({ action: lettered, kind: "action" });
  });
});

describe("AskActionInputErrors", () => {
  it("puts the three spellings in the unreadable-file sentence, so no caller has to add a second line", () => {
    const error = AskActionInputErrors.fileUnreadable({ cause: "ENOENT", path: "/tmp/absent.json" });
    expect(error.path).toBe("/tmp/absent.json");
    expect(error.message).toBe(
      "--action named a file it could not read: ENOENT. Spell it as `-` to read stdin, " +
        "as the JSON document itself, or as a path that exists",
    );
  });

  it("carries the broken rule in its own field as well as in the message", () => {
    expect(AskActionInputErrors.broken({ why: "the channel has no label" })).toEqual({
      code: "BROKEN",
      message: "the action does not read: the channel has no label",
      why: "the channel has no label",
    });
  });
});
