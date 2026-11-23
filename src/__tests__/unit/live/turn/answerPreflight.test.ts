import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { admitDoor } from "../../../../admit/door.js";
import type { DoorRequest } from "../../../../admit/types.js";
import { type VoiceGateInput } from "../../../../admit/voiceProfileGate.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { answerVoiceInput, deterministicAnswerGates } from "../../../../live/turn/answerPreflight.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";
import type { ResolvedMentions } from "../../../../outbound/slack/render.js";
import { answerProse } from "../../../../outbound/voice/artifactProse.js";

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "turn", verb: "review" },
  artifact: { actor: "bot", channel: "C1", messageTs: "1.1" },
  meta: { createsWorkItem: false, effect: "local-state", home: null, requiresApproval: false },
};

/**
 * An install that has configured no vocabulary at all — what every case not about voice hands in, so a rule
 * list arriving out of `profile.json` never decides an assertion about a different gate.
 */
const VOICE_OFF: VoiceGateInput = { allowVoiceRules: false, prose: [], rules: [] };

/** A valid answer, built the way the gate's own test builds one, with only the index varied. */
function answerOf({ index }: { index: AnswerFormAnswer["index"] }): AnswerFormAnswer {
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
    index,
    kind: "answer",
    lead: "the pool exhausted at 03:00Z",
    measurements: [],
  };
}

const decide = ({
  answer,
  askedBy,
  mentions,
}: {
  answer: AnswerFormAnswer;
  askedBy: string;
  mentions: ResolvedMentions;
}) =>
  admitDoor({
    env: {},
    gates: deterministicAnswerGates({
      answer,
      askedBy,
      atlasReadings: [],
      mentions,
      ownerUserId: "UOWNER",
      question: "why did the pool exhaust?",
      skills: [],
      voice: VOICE_OFF,
      surface: "channel",
    }),
    request: REQUEST,
  });

describe("answerVoiceInput — the one read the pre-flight and the send both make", () => {
  it("FAILS for a profile.json that is there but corrupt, rather than judging the answer against no rules", () => {
    const home = mkdtempSync(join(tmpdir(), "preflight-corrupt-"));
    try {
      writeFileSync(join(home, "profile.json"), "{", "utf8");

      const error = unwrapErr(answerVoiceInput({ answer: answerOf({ index: [] }), home }));

      expect(error.code).toBe("PROFILE_UNREADABLE");
      expect(error.path).toBe(join(home, "profile.json"));
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("judges against no rules when there is no profile at all, which is an install that configured none", () => {
    const home = mkdtempSync(join(tmpdir(), "preflight-absent-"));
    try {
      const input = unwrap(answerVoiceInput({ answer: answerOf({ index: [] }), home }));

      expect(input.gate.rules).toEqual([]);
      expect(input.findings).toEqual([]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe("deterministicAnswerGates", () => {
  it("refuses an answer that never tags the colleague who asked — the class that killed a turn after five rounds", () => {
    const decision = decide({
      answer: answerOf({ index: [[{ text: "the pool exhausted at 03:00Z", type: "text" }]] }),
      askedBy: "U_COLLEAGUE",
      mentions: { groups: new Map(), people: new Map() },
    });

    expect(decision.status).toBe("warn");
    expect(decision.findings.map((finding) => finding.code)).toContain("ANSWER_DOES_NOT_TAG_ASKER");
  });

  it("passes the same answer once it tags the asker above the fold", () => {
    const decision = decide({
      answer: answerOf({
        index: [
          [
            { person: "U_COLLEAGUE", type: "mention" },
            { text: " the pool exhausted at 03:00Z", type: "text" },
          ],
        ],
      }),
      askedBy: "U_COLLEAGUE",
      mentions: { groups: new Map(), people: new Map([["U_COLLEAGUE", "U_COLLEAGUE"]]) },
    });

    expect(decision.status).toBe("pass");
    expect(decision.findings).toEqual([]);
  });

  it("does not demand a tag when the owner asked in their own thread", () => {
    const decision = decide({
      answer: answerOf({ index: [[{ text: "the pool exhausted at 03:00Z", type: "text" }]] }),
      askedBy: "UOWNER",
      mentions: { groups: new Map(), people: new Map() },
    });

    expect(decision.status).toBe("pass");
  });

  it("refuses, before any reviewer is opened, a channel answer that names a local page path", () => {
    const decision = decide({
      answer: answerOf({
        index: [
          [
            { person: "U_COLLEAGUE", type: "mention" },
            { text: " the four pages are at ~/.slopweaver/pages/iso-27001/index.html", type: "text" },
          ],
        ],
      }),
      askedBy: "U_COLLEAGUE",
      mentions: { groups: new Map(), people: new Map([["U_COLLEAGUE", "U_COLLEAGUE"]]) },
    });

    expect(decision.status).toBe("warn");
    expect(decision.findings.map((finding) => finding.code)).toContain("ANSWER_NAMES_A_LOCAL_PAGE_PATH");
  });

  it("carries no verdict-dependent gate, so it is runnable before a reviewer exists", () => {
    const gates = deterministicAnswerGates({
      answer: answerOf({ index: [] }),
      askedBy: "UOWNER",
      atlasReadings: [],
      mentions: { groups: new Map(), people: new Map() },
      ownerUserId: "UOWNER",
      question: "why did the pool exhaust?",
      skills: [],
      voice: VOICE_OFF,
      surface: "channel",
    });

    expect(gates).toHaveLength(9);
    expect(gates.flatMap((gate) => gate(REQUEST)).map((finding) => finding.code)).toEqual([]);
  });

  it("refuses the one adjective the door refused after three clean verdicts, before any reviewer is spawned", () => {
    // Verbatim from `C0SYN000001/1790048248.995219`: the door refused `body.runs[32]` on the word rule
    // `genuinely` after round 6 returned clean, and the round-7 diff was that one adjective. Caught here it
    // costs one re-compose; it actually cost a reviewer workspace and an hour unposted.
    const answer = {
      ...answerOf({ index: [] }),
      body: [
        {
          runs: [{ text: "the pen test report genuinely expired 61 days ago", type: "text" as const }],
          type: "paragraph" as const,
        },
      ],
    };
    const decision = admitDoor({
      env: {},
      gates: deterministicAnswerGates({
        answer,
        askedBy: "UOWNER",
        atlasReadings: [],
        mentions: { groups: new Map(), people: new Map() },
        ownerUserId: "UOWNER",
        question: "how overdue is the pen test report?",
        skills: [],
        surface: "channel",
        voice: {
          allowVoiceRules: false,
          prose: answerProse({ answer }),
          rules: [{ actors: ["bot"], kind: "word", value: "genuinely" }],
        },
      }),
      request: REQUEST,
    });

    expect(decision.status).toBe("warn");
    expect(decision.findings.map((finding) => finding.code)).toEqual(["VOICE_RULE_BROKEN"]);
    expect(decision.findings[0]!.summary).toBe(
      'body.runs[0] matches the configured word voice rule "genuinely" for the bot lane',
    );
  });

  it("refuses a pre-flight that does not state which lane the answer goes out under", () => {
    const answer = answerOf({ index: [] });
    const decision = admitDoor({
      env: {},
      gates: deterministicAnswerGates({
        answer,
        askedBy: "UOWNER",
        atlasReadings: [],
        mentions: { groups: new Map(), people: new Map() },
        ownerUserId: "UOWNER",
        question: "why did the pool exhaust?",
        skills: [],
        surface: "channel",
        voice: {
          allowVoiceRules: false,
          prose: answerProse({ answer }),
          rules: [{ actors: ["bot"], kind: "word", value: "genuinely" }],
        },
      }),
      request: { ...REQUEST, artifact: { channel: "C1", messageTs: "1.1" } },
    });

    expect(decision.findings.map((finding) => finding.code)).toEqual(["VOICE_ACTOR_UNSTATED"]);
  });

  it("refuses, before any reviewer is spawned, an unscoped metric citation", () => {
    // A synthetic fixture of the class: a figure read off an unscoped database metric reproduces from no
    // reading of that metric for the one system the claim names — the link averages every database in the
    // org. Caught here it costs one re-compose; caught by review it costs a review round.
    const answer = answerOf({ index: [] });
    const decision = decide({
      answer: {
        ...answer,
        citations: [
          {
            id: "c6",
            label: "[6]",
            url:
              "https://ap1.datadoghq.com/metric/explorer?exp_metric=gcp.cloudsql.database.cpu.utilization" +
              "&exp_agg=avg&start=1700000000000&end=1700003600000&paused=true",
          },
        ],
      },
      askedBy: "UOWNER",
      mentions: { groups: new Map(), people: new Map() },
    });

    expect(decision.status).toBe("warn");
    expect(decision.findings.map((finding) => finding.code)).toEqual(["ANSWER_CITATION_DOES_NOT_OPEN_ON_ITS_EVIDENCE"]);
  });

  it("refuses an answer attaching a shot of a page served from this machine", () => {
    const answer = answerOf({ index: [[{ text: "the pool exhausted at 03:00Z", type: "text" }]] });
    const decision = decide({
      answer: { ...answer, images: ["http://127.0.0.1:8792/before.html"] },
      askedBy: "UOWNER",
      mentions: { groups: new Map(), people: new Map() },
    });

    expect(decision.status).toBe("warn");
    expect(decision.findings.map((finding) => finding.code)).toEqual([
      "INVENTED_VISUAL_LOCAL_RENDER_URL",
      "INVENTED_VISUAL_PAGE_NOT_CAPTURE",
    ]);
  });

  it("lets the same answer through once the invented-visual override is set", () => {
    const answer = answerOf({ index: [[{ text: "the pool exhausted at 03:00Z", type: "text" }]] });
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: "visual.invented:v1" },
      gates: deterministicAnswerGates({
        answer: { ...answer, images: ["http://127.0.0.1:8792/before.html"] },
        askedBy: "UOWNER",
        atlasReadings: [],
        mentions: { groups: new Map(), people: new Map() },
        ownerUserId: "UOWNER",
        question: "why did the pool exhaust?",
        skills: [],
        voice: VOICE_OFF,
        surface: "channel",
      }),
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
    expect(decision.overridden.map((finding) => finding.code)).toEqual([
      "INVENTED_VISUAL_LOCAL_RENDER_URL",
      "INVENTED_VISUAL_PAGE_NOT_CAPTURE",
    ]);
  });
});
