/*
 * `gmail triage` holding out the mail another verb owns: Gemini's meeting notes and Fathom's recaps make no group,
 * the text names the verb that owns them, and a card's pin made before the rule still resolves.
 */
import { describe, expect, it } from "vitest";

import { buildGmailTriage } from "../../../../../live/gmail/triage.js";
import { pinnedStillInInbox } from "../../../../../live/gmail/triageActs.js";
import { heldOutLane, heldOutLanesOf } from "../../../../../live/gmail/triageHeldOut.js";
import { renderGmailTriageJson, renderGmailTriageText } from "../../../../../live/gmail/triageRender.js";
import { EMPTY_TRIAGE_POLICY } from "../../../../../live/gmail/triageRules.js";
import { EVERY_LANE_POLICY, message, READ_AT } from "./harness.js";

const ADDRESSES = [
  "no-reply@fathom.video",
  "gemini-notes@google.com",
  "meetings-noreply@google.com",
  "ana@example.com",
];

describe("heldOutLanesOf", () => {
  it("opens a lane only for a delegate the policy declares", () => {
    const fathomOnly = { ...EMPTY_TRIAGE_POLICY, delegates: [EVERY_LANE_POLICY.delegates[0]!] };
    expect([
      [...heldOutLanesOf({ policy: EVERY_LANE_POLICY })].toSorted(),
      [...heldOutLanesOf({ policy: fathomOnly })],
      [...heldOutLanesOf({ policy: EMPTY_TRIAGE_POLICY })],
    ]).toEqual([["fathom", "meetingNotes"], ["fathom"], []]);
  });
});

describe("heldOutLane", () => {
  it("names the lane another verb owns, and none for ordinary mail", () => {
    const lanes = heldOutLanesOf({ policy: EVERY_LANE_POLICY });
    expect(ADDRESSES.map((address) => heldOutLane({ address, lanes }))).toEqual([
      "fathom",
      "meetingNotes",
      "meetingNotes",
      undefined,
    ]);
  });

  it("names no lane the policy left closed, so that mail groups by sender like any other", () => {
    const lanes = heldOutLanesOf({ policy: EMPTY_TRIAGE_POLICY });
    expect(ADDRESSES.map((address) => heldOutLane({ address, lanes }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("buildGmailTriage holds Gemini's meeting-notes mail out of every group", () => {
  // Archive these once the transcript is proven — `gmail clear-meeting-notes` owns them.
  const document = buildGmailTriage({
    account: "owner@example.test",
    complete: true,
    inboxEstimate: 5,
    policy: EVERY_LANE_POLICY,
    messages: [
      message({ atIso: READ_AT, from: "Gemini <gemini-notes@google.com>", id: "notes-1" }),
      message({ atIso: READ_AT, from: "Google Meet <meetings-noreply@google.com>", id: "notes-2" }),
      message({ atIso: READ_AT, from: "Gemini <gemini-notes@google.com> (Google Meet)", id: "notes-3" }),
      message({ atIso: READ_AT, from: "meetings-noreply@google.com (Google Meet)", id: "notes-4" }),
      message({ atIso: READ_AT, from: "Bot <no-reply@example.test>", id: "other" }),
    ],
    readAtIso: READ_AT,
    inviteFileIds: new Set(),
    repliedThreadIds: new Set(),
  });

  it("makes no group of a notes mail, keeping only its id, a trailing comment in From included", () => {
    expect(document.groups.map((group) => group.key)).toEqual(["from:no-reply@example.test"]);
    expect(document.meetingNotes).toEqual(["notes-1", "notes-2", "notes-3", "notes-4"]);
  });

  it("names the held-out mail and the verb that owns it in the text", () => {
    expect(renderGmailTriageText({ carded: new Map(), document, only: undefined })).toContain(
      "4 Gemini meeting-notes mail(s) held out of triage — never carded here; each is archived once its " +
        "transcript is proven in the corpus, or proven absent: slopweaver gmail clear-meeting-notes",
    );
  });

  it("still finds a card's pinned notes id in the inbox, so a pin made before this rule resolves", () => {
    expect(pinnedStillInInbox({ document, pinned: ["notes-1", "gone"] })).toEqual(["notes-1"]);
  });
});

describe("buildGmailTriage holds Fathom's mail out of every group", () => {
  // The owner wants nothing to do with Fathom recap emails, so triage never asks about them.
  const recapSubject = "Someone shared a recap of your meeting with a vendor";
  const document = buildGmailTriage({
    account: "owner@example.test",
    complete: true,
    inviteFileIds: new Set<string>(),
    repliedThreadIds: new Set<string>(),
    inboxEstimate: 3,
    policy: EVERY_LANE_POLICY,
    messages: [
      message({
        atIso: "2026-09-23T01:49:01.000Z",
        from: "Fathom <no-reply@fathom.video>",
        id: "recap-1",
        subject: recapSubject,
      }),
      message({
        atIso: "2026-09-23T01:46:24.000Z",
        from: "Fathom <No-Reply@Fathom.video>",
        id: "recap-2",
        subject: recapSubject,
      }),
      message({ atIso: READ_AT, from: "Bot <no-reply@example.test>", id: "other" }),
    ],
    readAtIso: READ_AT,
  });

  it("makes no group of a Fathom recap mail, keeping only its id", () => {
    expect(document.groups.map((group) => group.key)).toEqual(["from:no-reply@example.test"]);
    expect(document.fathom).toEqual(["recap-1", "recap-2"]);
  });

  it("carries the recap's subject nowhere, so nothing can card or cite it", () => {
    expect(renderGmailTriageJson({ document })).not.toContain("recap of your meeting");
    expect(renderGmailTriageText({ carded: new Map(), document, only: undefined })).not.toContain(
      "recap of your meeting",
    );
    expect(recapSubject).toContain("recap of your meeting");
  });

  it("names the held-out mail and the verb that owns it in the text", () => {
    expect(renderGmailTriageText({ carded: new Map(), document, only: undefined })).toContain(
      "2 Fathom mail(s) held out of triage — never carded; the Fathom integration ingests each meeting, then " +
        "archives the mail: slopweaver fathom clear-inbox",
    );
  });

  it("still finds a card's pinned Fathom id in the inbox, so a pin made before this rule resolves", () => {
    expect(pinnedStillInInbox({ document, pinned: ["recap-2", "gone"] })).toEqual(["recap-2"]);
  });
});
