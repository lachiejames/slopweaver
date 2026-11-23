/**
 * Unit: the write verbs' argument parsing — the layer that must refuse before a credential, a form on
 * stdin, or an intent file is touched.
 */
import { describe, expect, it } from "vitest";
import {
  CALENDAR_WRITE_FLAG_NAMES,
  parseCalendarCommitArgs,
  parseCalendarWriteArgs,
} from "../../../../../cli/commands/calendar/writeCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseCalendarWriteArgs", () => {
  it("takes book's form with no event id", () => {
    const args = unwrap(parseCalendarWriteArgs({ rest: ["--form", "-"], verb: "book" }));
    expect(args).toStrictEqual({ eventId: undefined, formSource: "-", home: undefined, json: false, verb: "book" });
  });

  it("takes the event id positionally for every verb but book", () => {
    expect(unwrap(parseCalendarWriteArgs({ rest: ["evt-1", "--form", "{}"], verb: "edit" })).eventId).toBe("evt-1");
    expect(unwrap(parseCalendarWriteArgs({ rest: ["evt-1"], verb: "cancel" })).eventId).toBe("evt-1");
  });

  it("refuses a flag where the event id should be, rather than reading the flag as an id", () => {
    expect(unwrapErr(parseCalendarWriteArgs({ rest: ["--form", "{}"], verb: "edit" })).message).toBe(
      "missing <event-id>",
    );
  });

  it("requires --form on every verb that takes one, and refuses it on cancel", () => {
    expect(unwrapErr(parseCalendarWriteArgs({ rest: ["evt-1"], verb: "respond" })).message).toContain(
      "--form is required",
    );
    const onCancel = unwrapErr(parseCalendarWriteArgs({ rest: ["evt-1", "--form", "{}"], verb: "cancel" }));
    expect(onCancel.code).toBe("FLAGS_INVALID");
    expect(onCancel.message).toContain("--form");
  });

  it("carries --home and --json through", () => {
    const args = unwrap(parseCalendarWriteArgs({ rest: ["--form", "-", "--home", "/tmp/h", "--json"], verb: "book" }));
    expect(args.home).toBe("/tmp/h");
    expect(args.json).toBe(true);
  });

  it("declares no --dry-run anywhere, because a hold already shows what would be sent", () => {
    expect(Object.values(CALENDAR_WRITE_FLAG_NAMES).flat()).not.toContain("--dry-run");
  });
});

describe("parseCalendarCommitArgs", () => {
  it("takes the intent id positionally and the digest as a flag", () => {
    const args = unwrap(parseCalendarCommitArgs({ rest: ["intent-1", "--approve", "9c1e4b7a2d5f8e01"] }));
    expect(args.intentId).toBe("intent-1");
    expect(args.approval).toStrictEqual({ digest: "9c1e4b7a2d5f8e01", kind: "digest" });
  });

  it("takes the owner's yes as an --anchor", () => {
    const anchor = "talk-call:a0000024-0000-4000-8000-000000000027#turn_000000000000000000020";
    const args = unwrap(parseCalendarCommitArgs({ rest: ["intent-1", "--anchor", anchor] }));
    expect(args.approval).toStrictEqual({ anchor, kind: "anchor" });
  });

  it("refuses --anchor and --approve together, since a commit carries exactly one approval", () => {
    const refused = unwrapErr(parseCalendarCommitArgs({ rest: ["intent-1", "--anchor", "talk:t1", "--approve", "d"] }));
    expect(refused.code).toBe("ARGUMENTS_REFUSED");
    expect(refused.message).toBe("pass --anchor OR --approve, never both: a commit carries exactly one approval");
  });

  it("takes a commit with no approval at all, so the door decides rather than the parser", () => {
    expect(unwrap(parseCalendarCommitArgs({ rest: ["intent-1"] })).approval).toBeUndefined();
  });

  it("refuses a missing intent id", () => {
    expect(unwrapErr(parseCalendarCommitArgs({ rest: [] })).message).toBe("missing <intent-id>");
  });
});
