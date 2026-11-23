import { describe, expect, it } from "vitest";

import { eventFromKind } from "../../../handover/ledgerDecode.js";

/** The instant every case carries, so an assertion is about the kind rather than about the clock. */
const AT = "2026-09-22T11:01:43.217Z";

describe("eventFromKind — the three groups, asked in turn", () => {
  it("decodes a lifecycle kind", () => {
    expect(eventFromKind({ kind: "started", payload: { atIso: AT, branch: "a-branch", docHash: "abc123" } })).toEqual({
      atIso: AT,
      branch: "a-branch",
      docHash: "abc123",
      kind: "started",
    });
  });

  it("decodes an identity kind, carrying the session that wrote it", () => {
    expect(eventFromKind({ kind: "released", payload: { atIso: AT, sessionId: "s-1", why: "handing it on" } })).toEqual(
      {
        atIso: AT,
        kind: "released",
        sessionId: "s-1",
        why: "handing it on",
      },
    );
  });

  it("decodes a parked checkpoint whole", () => {
    const payload = {
      atIso: AT,
      branch: "b",
      question: "q",
      screenTail: "❯ ",
      sessionId: "s-1",
      workspaceRef: "workspace:238",
      worktree: "/wt/b",
    };
    expect(eventFromKind({ kind: "parked", payload })).toEqual({ ...payload, kind: "parked" });
  });

  it("decodes a parked checkpoint's wake, and drops a malformed one while keeping the checkpoint", () => {
    const payload = {
      atIso: AT,
      branch: "b",
      screenTail: "❯ ",
      sessionId: "s-1",
      workspaceRef: "workspace:238",
      worktree: "/wt/b",
    };
    const wake = { kind: "checks", number: 9877, repo: "acme/acme-admin" };
    expect([
      eventFromKind({ kind: "parked", payload: { ...payload, wake } }),
      eventFromKind({ kind: "parked", payload: { ...payload, wake: { ...wake, number: "9877" } } }),
    ]).toEqual([
      { ...payload, kind: "parked", wake },
      { ...payload, kind: "parked" },
    ]);
  });

  it("decodes an observation kind", () => {
    expect(eventFromKind({ kind: "probed", payload: { atIso: AT, failed: 2, passed: 5 } })).toEqual({
      atIso: AT,
      failed: 2,
      kind: "probed",
      passed: 5,
    });
  });

  // Name the uncertainty: an unknown standing would either silence a risk or invent one.
  it("decodes a steer-risk in either standing, and refuses one with another standing or no reason", () => {
    const payload = { atIso: AT, standing: "at-risk", why: "the deploy needs the owner's GCP sign-in" };
    expect([
      eventFromKind({ kind: "steer-risk", payload }),
      eventFromKind({ kind: "steer-risk", payload: { ...payload, standing: "cleared" } }),
      eventFromKind({ kind: "steer-risk", payload: { ...payload, standing: "late" } }),
      eventFromKind({ kind: "steer-risk", payload: { atIso: AT, standing: "at-risk" } }),
    ]).toEqual([
      { ...payload, kind: "steer-risk" },
      { ...payload, kind: "steer-risk", standing: "cleared" },
      undefined,
      undefined,
    ]);
  });

  it("decodes a ruling's explicit steer, and refuses a line whose steer will not read or is a reconstruction's", () => {
    const ruling = { anchor: "p9", atIso: AT, decidedIso: AT, ruling: "overriding the previous guidance" };
    const due = { deliverByIso: "2026-10-22T05:00:00.000Z" };
    expect([
      eventFromKind({ kind: "ruling", payload: { ...ruling, explicitSteer: due } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, explicitSteer: {} } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, explicitSteer: true } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, explicitSteer: { ...due, extra: 1 } } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, explicitSteer: { deliverByIso: "Friday" } } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, backfilledFrom: AT, explicitSteer: {} } }),
    ]).toEqual([
      { ...ruling, explicitSteer: due, kind: "ruling" },
      { ...ruling, explicitSteer: {}, kind: "ruling" },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("decodes a ruling's standing session, and refuses a line whose session will not read or is a reconstruction's", () => {
    const ruling = { anchor: "talk:p9", atIso: AT, decidedIso: AT, ruling: "keep that session open for me" };
    const until = { untilIso: "2026-11-17T13:00:00.000Z" };
    expect([
      eventFromKind({ kind: "ruling", payload: { ...ruling, standingSession: until } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, standingSession: {} } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, standingSession: true } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, standingSession: { ...until, extra: 1 } } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, standingSession: { untilIso: "the 17th" } } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, backfilledFrom: AT, standingSession: {} } }),
    ]).toEqual([
      { ...ruling, kind: "ruling", standingSession: until },
      { ...ruling, kind: "ruling", standingSession: {} },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("decodes a ruling's attach-upload verdict, and refuses one that will not read or is a reconstruction's", () => {
    const ruling = { anchor: "talk:p9", atIso: AT, decidedIso: AT, ruling: "pictures may go up" };
    expect([
      eventFromKind({ kind: "ruling", payload: { ...ruling, attachUpload: { verdict: "permitted" } } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, attachUpload: { verdict: "refused" } } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, attachUpload: "permitted" } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, attachUpload: { verdict: "maybe" } } }),
      eventFromKind({ kind: "ruling", payload: { ...ruling, attachUpload: { extra: 1, verdict: "refused" } } }),
      eventFromKind({
        kind: "ruling",
        payload: { ...ruling, attachUpload: { verdict: "permitted" }, backfilledFrom: AT },
      }),
    ]).toEqual([
      { ...ruling, attachUpload: { verdict: "permitted" }, kind: "ruling" },
      { ...ruling, attachUpload: { verdict: "refused" }, kind: "ruling" },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("answers undefined for a word this build has never heard, rather than throwing", () => {
    expect(eventFromKind({ kind: "a-kind-from-a-newer-build", payload: { atIso: AT } })).toBeUndefined();
  });
});

describe("eventFromKind — a group's own refusal is not offered to the next group", () => {
  it("leaves a parked line with no sessionId undecoded, so it cannot release a writer it does not name", () => {
    expect(eventFromKind({ kind: "parked", payload: { atIso: AT, workspaceRef: "workspace:238" } })).toBeUndefined();
  });

  it("leaves an identity line with no sessionId undecoded", () => {
    expect(eventFromKind({ kind: "launched", payload: { atIso: AT, pid: 7361 } })).toBeUndefined();
  });

  it("leaves a claim with no host undecoded, since both fields are load-bearing", () => {
    expect(
      eventFromKind({ kind: "claimed", payload: { atIso: AT, sessionId: "s-1", why: "the holder died" } }),
    ).toBeUndefined();
  });

  it("leaves an artifact pointer with no url undecoded, so a blank cannot supersede a real one", () => {
    expect(eventFromKind({ kind: "artifact", payload: { atIso: AT } })).toBeUndefined();
  });

  it("decodes a park-cleared whole through the kind switch", () => {
    const payload = { atIso: AT, parkIndex: 4, why: "the row is done" };
    expect(eventFromKind({ kind: "park-cleared", payload })).toEqual({ ...payload, kind: "park-cleared" });
  });
});

describe("eventFromKind — the offered ask", () => {
  const action = {
    actor: "me",
    body: "<@U01ARI> still chasing a review on this one.",
    destinations: [
      { channel: "C01SDLC", kind: "channel", label: "Post it to #delivery", tradeoff: "the channel sees it" },
    ],
    mentions: [{ label: "Ari", userId: "U01ARI" }],
    version: 1,
  };

  // The line carries an option list describing a DM to Tobias, which the action offers nowhere. The verbs
  // refuse a hand-authored list, but the journal is a hand-editable file shared by every checkout, so the
  // guarantee has to hold on the way IN too: a card that read this back would offer to DM Tobias over a draft
  // addressed to a channel. The bad list is in the input, so this reddens if the derivation is ever dropped.
  it("derives the options from the action and ignores the list the line stored", () => {
    expect(
      eventFromKind({
        kind: "question-offered",
        payload: {
          action,
          atIso: AT,
          lean: "A: the channel, for the visibility",
          options: [
            { letter: "Z", option: "DM Tobias", tradeoff: "only Tobias sees it" },
            { letter: "Y", option: "Hold", tradeoff: "the review waits" },
          ],
          problem: "no one has reviewed it in nine days",
          question: "post it to #delivery, DM them, or hold?",
        },
      }),
    ).toEqual({
      action,
      atIso: AT,
      kind: "question-offered",
      lean: "A: the channel, for the visibility",
      // One option per destination, in order, then the hold — and the letters come from position, so the
      // journalled `Z`/`Y` are gone along with the labels they carried.
      options: [
        { letter: "A", option: "Post it to #delivery", tradeoff: "the channel sees it" },
        {
          letter: "B",
          option: "Hold it — send nothing for now",
          tradeoff: "the thread moves on without our answer, and the draft goes stale",
        },
      ],
      problem: "no one has reviewed it in nine days",
      question: "post it to #delivery, DM them, or hold?",
    });
  });
});

describe("eventFromKind — a question whose action is present and will not read", () => {
  // The THIRD arm, and the one a first fix missed: a broken action is not an absent one. Its stored options
  // were written to describe destinations, so handing them back prints "DM Tobias" on a card whose draft was
  // addressed to a channel and no longer reads at all. The list is in the input, so this reddens if the
  // decoder goes back to reading it.
  it("carries no options at all, rather than the list the line stored", () => {
    const decoded = eventFromKind({
      kind: "question",
      payload: {
        action: { actor: "me", body: "Ready for review.", destinations: [], mentions: [], version: 1 },
        atIso: AT,
        options: [
          { letter: "A", option: "DM Tobias", tradeoff: "only Tobias sees it" },
          { letter: "B", option: "Hold", tradeoff: "the review waits" },
        ],
        question: "post it, DM them, or hold?",
      },
    });

    // The MARK is what makes this state distinguishable downstream. Without it the publisher reads the row
    // as an ask that never offered a draft and restores the doc's own front-matter options — the exact
    // route by which "DM Tobias" reached a card three fixes into this property.
    expect(decoded).toEqual({
      actionUnreadable: true,
      atIso: AT,
      kind: "question",
      question: "post it, DM them, or hold?",
    });
  });

  it("still reads the stored options of an ask carrying no action, which is most of them", () => {
    const decoded = eventFromKind({
      kind: "question",
      payload: {
        atIso: AT,
        options: [
          { option: "ship it", tradeoff: "the rollback is a revert" },
          { option: "wait a week", tradeoff: "the branch drifts" },
        ],
        question: "ship it now, or wait?",
      },
    });

    expect(decoded).toEqual({
      atIso: AT,
      kind: "question",
      options: [
        { letter: "A", option: "ship it", tradeoff: "the rollback is a revert" },
        { letter: "B", option: "wait a week", tradeoff: "the branch drifts" },
      ],
      question: "ship it now, or wait?",
    });
  });
});
