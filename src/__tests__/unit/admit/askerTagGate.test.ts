/** The gate that refuses to send an answer which never tags the person who asked for it. */
import { describe, expect, it } from "vitest";

import {
  ASKER_TAG_CODE,
  ASKER_TAG_OVERRIDE,
  answerMustTagAsker,
  answerTagsSlackId,
  askerTagFindings,
  askerTagGate,
  askerTagPreflightLines,
} from "../../../admit/askerTagGate.js";
import { admitDoor } from "../../../admit/door.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/** The colleague who asked, in the shape the module header anchors to. */
const COLLEAGUE = "U_COLLEAGUE";
/** The owner this session composes for. */
const OWNER = "U_OWNER";

function answer(over: Partial<AnswerFormAnswer> = {}): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:1 (Claude Code, in-turn)",
        skillsLoaded: [],
        verbsLoaded: [],
      },
      reason: "answered from the thread",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "the createNotification failure was retried",
    measurements: [],
    ...over,
  };
}

function codes({ findings }: { findings: readonly { readonly code: string }[] }): readonly string[] {
  return findings.map((finding) => finding.code);
}

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "turn", verb: "answer" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe("answerMustTagAsker", () => {
  it("owes the tag to a colleague who asked in a channel", () => {
    expect(answerMustTagAsker({ askedBy: COLLEAGUE, ownerUserId: OWNER, surface: "channel" })).toEqual({
      askedBy: COLLEAGUE,
      kind: "owed",
    });
  });

  it("exempts the owner's own ask — answering the owner is not a reason to ping the owner", () => {
    expect(answerMustTagAsker({ askedBy: OWNER, ownerUserId: OWNER, surface: "channel" })).toEqual({
      kind: "exempt",
      why: expect.stringContaining("own owner"),
    });
  });

  it("exempts a DM, where Slack already notifies the only other participant", () => {
    expect(answerMustTagAsker({ askedBy: COLLEAGUE, ownerUserId: OWNER, surface: "dm" })).toEqual({
      kind: "exempt",
      why: expect.stringContaining("1:1 DM"),
    });
  });

  it("exempts the owner's own DM too — the DM arm is checked first and both apply", () => {
    expect(answerMustTagAsker({ askedBy: OWNER, ownerUserId: OWNER, surface: "dm" }).kind).toBe("exempt");
  });

  it("owes the tag when no owner is configured — every asker is then someone other than the owner", () => {
    expect(answerMustTagAsker({ askedBy: OWNER, ownerUserId: undefined, surface: "channel" })).toEqual({
      askedBy: OWNER,
      kind: "owed",
    });
  });
});

describe("answerTagsSlackId", () => {
  it("finds a mention in the ABOVE-THE-FOLD index", () => {
    const tagged = answerTagsSlackId({
      answer: answer({
        index: [
          [
            { person: "@asker", type: "mention" },
            { text: " — yes, it retried.", type: "text" },
          ],
        ],
      }),
      mentions: new Map([["@asker", COLLEAGUE]]),
      slackId: COLLEAGUE,
    });

    expect(tagged).toBe(true);
  });

  it("finds a mention in the body, below the fold — the ping fires either way", () => {
    const tagged = answerTagsSlackId({
      answer: answer({ body: [{ runs: [{ person: COLLEAGUE, type: "mention" }], type: "paragraph" }] }),
      mentions: new Map([[COLLEAGUE, COLLEAGUE]]),
      slackId: COLLEAGUE,
    });

    expect(tagged).toBe(true);
  });

  it("is false for the measured card: prose about the person, no mention run anywhere", () => {
    const tagged = answerTagsSlackId({
      answer: answer({
        body: [{ runs: [{ text: "the colleague asked whether it was retried", type: "text" }], type: "paragraph" }],
      }),
      mentions: new Map(),
      slackId: COLLEAGUE,
    });

    expect(tagged).toBe(false);
  });

  it("does NOT count a broadcast — @channel notifies a room, and the duty is owed to a person", () => {
    const tagged = answerTagsSlackId({
      answer: answer({ index: [[{ range: "channel", type: "broadcast" }]] }),
      mentions: new Map([[COLLEAGUE, COLLEAGUE]]),
      slackId: COLLEAGUE,
    });

    expect(tagged).toBe(false);
  });

  it("is false when the answer tags a DIFFERENT person", () => {
    const tagged = answerTagsSlackId({
      answer: answer({ index: [[{ person: "@owner", type: "mention" }]] }),
      mentions: new Map([["@owner", OWNER]]),
      slackId: COLLEAGUE,
    });

    expect(tagged).toBe(false);
  });
});

describe("askerTagFindings", () => {
  it("REFUSES the measured failure — the answer to a colleague's question mentions them nowhere", () => {
    const findings = askerTagFindings({
      answer: answer({
        body: [{ runs: [{ text: "the failure was retried twice", type: "text" }], type: "paragraph" }],
      }),
      askedBy: COLLEAGUE,
      mentions: new Map(),
      ownerUserId: OWNER,
      surface: "channel",
    });

    expect(codes({ findings })).toEqual([ASKER_TAG_CODE]);
  });

  it("names the person and says attribution is not notification", () => {
    const findings = askerTagFindings({
      answer: answer(),
      askedBy: COLLEAGUE,
      mentions: new Map(),
      ownerUserId: OWNER,
      surface: "channel",
    });

    expect(findings[0]!.summary).toContain(COLLEAGUE);
    expect(findings[0]!.summary).toContain("attribution in the ledger is not a notification in Slack");
  });

  it("makes the refusal self-correctable — a warn, its override token, and the exact run to add", () => {
    const findings = askerTagFindings({
      answer: answer(),
      askedBy: COLLEAGUE,
      mentions: new Map(),
      ownerUserId: OWNER,
      surface: "channel",
    });

    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!).toEqual(expect.objectContaining({ override: ASKER_TAG_OVERRIDE }));
    expect(findings[0]!.correction).toContain(`{"type":"mention","person":"${COLLEAGUE}"}`);
  });

  it("names the break-glass for a person the roster cannot address, so the gate is not a deadlock", () => {
    const findings = askerTagFindings({
      answer: answer(),
      askedBy: COLLEAGUE,
      mentions: new Map(),
      ownerUserId: OWNER,
      surface: "channel",
    });

    expect(findings[0]!.correction).toContain(`SLOPWEAVER_DOOR_OVERRIDE=${ASKER_TAG_OVERRIDE}`);
  });

  it("passes once the asker is tagged above the fold", () => {
    const findings = askerTagFindings({
      answer: answer({
        index: [
          [
            { person: "@asker", type: "mention" },
            { text: " — yes.", type: "text" },
          ],
        ],
      }),
      askedBy: COLLEAGUE,
      mentions: new Map([["@asker", COLLEAGUE]]),
      ownerUserId: OWNER,
      surface: "channel",
    });

    expect(findings).toEqual([]);
  });

  it("says nothing about the owner's own untagged ask", () => {
    const findings = askerTagFindings({
      answer: answer(),
      askedBy: OWNER,
      mentions: new Map(),
      ownerUserId: OWNER,
      surface: "channel",
    });

    expect(findings).toEqual([]);
  });

  it("says nothing in a DM", () => {
    const findings = askerTagFindings({
      answer: answer(),
      askedBy: COLLEAGUE,
      mentions: new Map(),
      ownerUserId: OWNER,
      surface: "dm",
    });

    expect(findings).toEqual([]);
  });
});

describe("askerTagGate", () => {
  it("composes into the real door, and an untagged answer to a colleague comes back WARN", () => {
    const decision = admitDoor({
      env: {},
      gates: [
        askerTagGate({
          answer: answer(),
          askedBy: COLLEAGUE,
          mentions: new Map(),
          ownerUserId: OWNER,
          surface: "channel",
        }),
      ],
      request: REQUEST,
    });

    expect(decision.status).toBe("warn");
    expect(codes({ findings: decision.findings })).toEqual([ASKER_TAG_CODE]);
  });

  it("is waivable by its own override token, and the door RECORDS the waiver", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: ASKER_TAG_OVERRIDE },
      gates: [
        askerTagGate({
          answer: answer(),
          askedBy: COLLEAGUE,
          mentions: new Map(),
          ownerUserId: OWNER,
          surface: "channel",
        }),
      ],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
    expect(codes({ findings: decision.overridden })).toEqual([ASKER_TAG_CODE]);
  });
});

describe("askerTagPreflightLines", () => {
  it("tells a worker answering a colleague exactly which run to write, and where", () => {
    const text = askerTagPreflightLines({ askedBy: COLLEAGUE, ownerUserId: OWNER, surface: "channel" }).join("\n");

    expect(text).toContain(`{"type":"mention","person":"${COLLEAGUE}"}`);
    expect(text).toContain(ASKER_TAG_OVERRIDE);
    expect(text).toContain("`index`");
  });

  it("tells a worker answering the owner NOT to add one for form's sake", () => {
    const text = askerTagPreflightLines({ askedBy: OWNER, ownerUserId: OWNER, surface: "channel" }).join("\n");

    expect(text).toContain("No tag is owed here");
    expect(text).toContain("Do not add one for form's sake");
  });

  it("carries the compound case the gate deliberately does not decide", () => {
    const text = askerTagPreflightLines({ askedBy: OWNER, ownerUserId: OWNER, surface: "channel" }).join("\n");

    expect(text).toContain("on somebody ELSE's behalf");
    expect(text).toContain("SUBJECT of a question is not");
  });
});
