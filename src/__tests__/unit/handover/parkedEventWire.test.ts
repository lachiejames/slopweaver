/**
 * The write schema's `parked` fields — what a checkpoint line must carry, and the caps that bound it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { PARK_DRAFT_MAX_CHARS } from "../../../handover/parkedEvent.js";
import { PARKED_WIRE_FIELDS } from "../../../handover/parkedEventWire.js";

const parked = z.object(PARKED_WIRE_FIELDS);

const LINE = {
  branch: "a-doc",
  screenTail: "",
  sessionId: "session-parked",
  workspaceRef: "workspace:7",
  worktree: "/wt/a-doc",
};

describe("PARKED_WIRE_FIELDS", () => {
  it("takes a line with no question and no drafts, and an empty screen", () => {
    expect(parked.safeParse(LINE).success).toBe(true);
  });

  it("takes both kinds of draft", () => {
    const drafts = [
      { kind: "ask-action", text: "the card message" },
      { id: "sd-1", kind: "slack-draft", text: "a reply" },
    ];
    expect(parked.safeParse({ ...LINE, drafts }).success).toBe(true);
  });

  it("refuses a Slack draft with no id, and a draft past the cap", () => {
    expect(parked.safeParse({ ...LINE, drafts: [{ kind: "slack-draft", text: "a reply" }] }).success).toBe(false);
    const long = "x".repeat(PARK_DRAFT_MAX_CHARS + 1);
    expect(parked.safeParse({ ...LINE, drafts: [{ kind: "ask-action", text: long }] }).success).toBe(false);
  });

  it("takes a clock wake and a checks wake", () => {
    const wakes = [
      { atIso: "2026-10-15T03:13:00Z", kind: "at" },
      { kind: "checks", number: 9877, repo: "acme/acme-admin" },
    ];
    expect(wakes.map((wake) => parked.safeParse({ ...LINE, wake }).success)).toEqual([true, true]);
  });

  it("refuses a wake that is not exactly one well-formed clock or pull request", () => {
    const wakes = [
      { atIso: "2026-10-15T03:13:00+10:00", kind: "at" },
      { atIso: "2026-02-30T00:00:00Z", kind: "at" },
      { atIso: "2026-10-15T03:13:00Z", kind: "at", repo: "o/r" },
      { kind: "checks", number: 0, repo: "o/r" },
      { kind: "checks", number: 1.5, repo: "o/r" },
      { kind: "checks", number: 1, repo: "o/r/x" },
      { kind: "later" },
    ];
    expect(wakes.map((wake) => parked.safeParse({ ...LINE, wake }).success)).toEqual(wakes.map(() => false));
  });
});
