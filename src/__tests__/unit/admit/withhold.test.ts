/**
 * The withhold verdict, driven by calling it.
 *
 * Everything here is pure — the judgement is a function of a reply context (plus a loaded whitelist), the
 * gate is a function of a door request, and the door decision is a function of both plus an environment. So
 * the whole mechanism, including the break-glass, is exercised with no filesystem, no clock and no Slack.
 */
import { describe, expect, it } from "vitest";

import { admitDoor, DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorRequest } from "../../../admit/types.js";
import {
  isReplyContext,
  type ReplyContext,
  WITHHOLD_CODE,
  WITHHOLD_OVERRIDE,
  whitelistJudgement,
  withholdGate,
} from "../../../admit/withhold.js";
import type { ResponderWhitelist } from "../../../live/listen/whitelist.js";

const OWNER = "U_OWNER";
const WHITELIST: ResponderWhitelist = { identities: [OWNER], kind: "list" };
const judge = whitelistJudgement({ openOverride: false, whitelist: WHITELIST });

const REPLY: ReplyContext = {
  askedBy: OWNER,
  channel: "C1",
  draftTldr: "We render rich_text.",
  question: "what did we decide about the renderer?",
  surface: "channel",
};

/** A door request carrying a reply context — what the answer write looks like. */
function answerRequest({ reply }: { reply: ReplyContext }): DoorRequest {
  return {
    action: { kind: "verb", noun: "turn", verb: "answer" },
    artifact: { channel: reply.channel, reply, turnId: "turn-1" },
    meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
  };
}

/** A door request carrying NO reply context — every other write a turn makes. */
const NOTICE_REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "turn", verb: "notice" },
  artifact: { channel: "C1", turnId: "turn-1" },
  meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
};

describe("whitelistJudgement — the shipped judgement, one list for admission AND reply", () => {
  it("sends a reply to a whitelisted asker", () => {
    expect(judge({ reply: REPLY }).kind).toBe("send");
  });

  it("withholds a non-whitelisted asker BY DEFAULT, with no environment variable involved anywhere in this test", () => {
    const verdict = judge({ reply: { ...REPLY, askedBy: "U_COLLEAGUE" } });
    expect(verdict.kind).toBe("withhold");
    expect(verdict.kind === "withhold" && verdict.code).toBe(WITHHOLD_CODE);
  });

  it("says WHY in terms of the whitelist, because the reason is what lands in the queue", () => {
    const verdict = judge({ reply: { ...REPLY, askedBy: "U_COLLEAGUE" } });
    expect(verdict.kind === "withhold" && verdict.reason).toContain("responder whitelist");
    expect(verdict.kind === "withhold" && verdict.reason).toContain("U_COLLEAGUE");
  });

  it("withholds the OWNER's own reply when the owner is NOT on the whitelist — no carve-out", () => {
    const noOwnerWhitelist: ResponderWhitelist = { identities: ["U_COLLEAGUE"], kind: "list" };
    const verdict = whitelistJudgement({ openOverride: false, whitelist: noOwnerWhitelist })({ reply: REPLY });
    expect(verdict.kind).toBe("withhold");
  });

  it("withholds everyone when the whitelist is absent", () => {
    const verdict = whitelistJudgement({ openOverride: false, whitelist: { kind: "absent" } })({ reply: REPLY });
    expect(verdict.kind).toBe("withhold");
  });

  it("sends anyone when the break-glass override is set, even a non-whitelisted asker", () => {
    const verdict = whitelistJudgement({ openOverride: true, whitelist: WHITELIST })({
      reply: { ...REPLY, askedBy: "U_COLLEAGUE" },
    });
    expect(verdict.kind).toBe("send");
  });

  it("applies in a DM as well as a channel — the judgement is about WHO asked, not where", () => {
    const verdict = judge({ reply: { ...REPLY, askedBy: "U_COLLEAGUE", surface: "dm" } });
    expect(verdict.kind).toBe("withhold");
  });
});

describe("withholdGate", () => {
  it("fires on a request carrying a reply context", () => {
    const findings = withholdGate({ judge })(answerRequest({ reply: { ...REPLY, askedBy: "U_COLLEAGUE" } }));
    expect(findings.length).toBe(1);
    expect(findings[0]!.code).toBe(WITHHOLD_CODE);
  });

  it("is SILENT on a request with no reply context, so a held notice can still be posted", () => {
    expect(withholdGate({ judge })(NOTICE_REQUEST)).toEqual([]);
  });

  it("is silent when the judgement says send", () => {
    expect(withholdGate({ judge })(answerRequest({ reply: REPLY }))).toEqual([]);
  });

  it("is a warn carrying an override token, never an unwaivable hold", () => {
    const finding = withholdGate({ judge })(answerRequest({ reply: { ...REPLY, askedBy: "U_X" } }))[0]!;
    expect(finding.severity).toBe("warn");
    expect(finding.severity === "warn" && finding.override).toBe(WITHHOLD_OVERRIDE);
  });

  it("carries the judgement's reason as the finding's summary, so the ledger records why", () => {
    const finding = withholdGate({ judge })(answerRequest({ reply: { ...REPLY, askedBy: "U_X" } }))[0]!;
    expect(finding.summary).toContain("U_X is not on the responder whitelist");
  });

  it("names the queue verbs in its correction, so the reader knows how to act on it", () => {
    const finding = withholdGate({ judge })(answerRequest({ reply: { ...REPLY, askedBy: "U_X" } }))[0]!;
    expect(finding.correction).toContain("slopweaver queue release");
  });
});

describe("the withhold through the door", () => {
  const gates = [...DEFAULT_GATES, withholdGate({ judge })];
  const held = answerRequest({ reply: { ...REPLY, askedBy: "U_COLLEAGUE" } });

  it("does NOT pass, so the caller's effect never runs", () => {
    expect(admitDoor({ env: {}, gates, request: held }).status).toBe("warn");
  });

  it("passes a whitelisted asker's own reply", () => {
    expect(admitDoor({ env: {}, gates, request: answerRequest({ reply: REPLY }) }).status).toBe("pass");
  });

  it("RELEASES on the override token — the break-glass", () => {
    const decision = admitDoor({ env: { SLOPWEAVER_DOOR_OVERRIDE: WITHHOLD_OVERRIDE }, gates, request: held });
    expect(decision.status).toBe("pass");
  });

  it("records the release rather than waiving it silently", () => {
    const decision = admitDoor({ env: { SLOPWEAVER_DOOR_OVERRIDE: WITHHOLD_OVERRIDE }, gates, request: held });
    expect(decision.overridden.map((finding) => finding.code)).toEqual([WITHHOLD_CODE]);
    expect(decision.findings).toEqual([]);
  });

  it("is not released by some other gate's override token", () => {
    const decision = admitDoor({ env: { SLOPWEAVER_DOOR_OVERRIDE: "slack.duplicate-send:v1" }, gates, request: held });
    expect(decision.status).toBe("warn");
  });
});

describe("isReplyContext", () => {
  it("accepts a whole context", () => {
    expect(isReplyContext(REPLY)).toBe(true);
  });

  it("rejects a context missing a field", () => {
    expect(isReplyContext({ ...REPLY, question: undefined })).toBe(false);
  });

  it("rejects an unknown surface", () => {
    expect(isReplyContext({ ...REPLY, surface: "mpim" })).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isReplyContext("reply")).toBe(false);
  });

  it("rejects null", () => {
    expect(isReplyContext(null)).toBe(false);
  });
});
