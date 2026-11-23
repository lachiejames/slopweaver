/**
 * `slack poll`'s form source: literal JSON and stdin both reach the validator, and a source that cannot be
 * read is the same typed refusal as a form that does not validate, never a throw.
 */
import { describe, expect, it } from "vitest";

import { loadPollForm } from "../../../../../cli/commands/slack/pollFormSource.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const FORM = JSON.stringify({
  kind: "poll",
  options: ["Waiting on someone", "Fighting CI"],
  question: "Where did the time go?",
  why: "Finding the friction.",
});

/** A stdin that must never be read, so a test that reaches it fails by name. */
const unreadStdin = async (): Promise<string> => {
  throw new Error("stdin was read when the form was literal");
};

describe("loadPollForm", () => {
  it("validates a literal JSON form without touching stdin", async () => {
    const poll = unwrap(await loadPollForm({ readStdin: unreadStdin, source: FORM }));

    expect(poll.question).toBe("Where did the time go?");
    expect(poll.options).toEqual(["Waiting on someone", "Fighting CI"]);
  });

  it("reads the form from stdin when the source is the sentinel", async () => {
    const poll = unwrap(await loadPollForm({ readStdin: async () => FORM, source: "-" }));

    expect(poll.why).toBe("Finding the friction.");
  });

  it("turns a stdin that cannot be read into the typed refusal, naming what the read said", async () => {
    const refusal = unwrapErr(
      await loadPollForm({
        readStdin: async () => {
          throw new Error("stdin closed");
        },
        source: "-",
      }),
    );

    expect(refusal).toEqual({
      code: "FORM_UNREADABLE",
      message: "cannot read the poll form: stdin closed",
      reason: "stdin closed",
    });
  });

  it("refuses a form that does not validate with the same union an unreadable one uses", async () => {
    const refusal = unwrapErr(
      await loadPollForm({ readStdin: unreadStdin, source: JSON.stringify({ kind: "poll", options: [] }) }),
    );

    expect(refusal.code).toBe("FORM_INVALID");
  });
});
