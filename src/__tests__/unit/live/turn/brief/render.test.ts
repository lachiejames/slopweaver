/**
 * `renderTurnRoutingBrief` — the text a visible session judges: the question, the execution context, the
 * standing rules and their order, the profile and owner directives by reference, the capabilities, the
 * dispatch command, and the guidance a proposal-shaped ask adds. Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import {
  buildTurnRoutingBrief,
  parseTurnRoutingBrief,
  renderTurnRoutingBrief,
} from "../../../../../live/turn/brief.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";
import { replyDisclosureLines } from "../../../../../live/turn/replyDisclosure.js";
import { BODY_MAX_BLOCKS } from "../../../../../outbound/assistant/contentLimits.js";
import { brief, ROUTING_INPUT, TAG_TREE } from "./harness.js";

const OWNER_DIRECTIVE = {
  id: "verified-fallback",
  source: {
    contentHash: `sha256:${"1".repeat(64)}`,
    file: "verified_fallback.md",
    modified: "2026-08-14T00:00:00.000Z",
  },
  text: "when the normal finalizer is broken, use the verified fallback",
};

describe("renderTurnRoutingBrief", () => {
  const render = (input: { question: string }): string =>
    renderTurnRoutingBrief({
      brief: brief(input),
      briefPath: "/tmp/b.json",
      tagTree: TAG_TREE,
    }).join("\n");

  it("prints the Datadog census block after the capabilities, and nothing when it is empty", () => {
    const withCensus = renderTurnRoutingBrief({
      brief: brief({ question: "jobs-api errors" }),
      briefPath: "/tmp/b.json",
      censusLines: ["DATADOG CENSUS — census line"],
      tagTree: TAG_TREE,
    });
    expect(withCensus.indexOf("DATADOG CENSUS — census line")).toBeGreaterThan(0);
    expect(render({ question: "jobs-api errors" })).not.toContain("DATADOG CENSUS");
  });

  it("prints the tag decision tree with this asker's trusted-tier standing", () => {
    const text = render({ question: "can you raise a PR for this?" });
    expect(text).toContain("WHAT HAPPENS TO THIS ASK — the tag decision tree");
    expect(text).toContain(
      "  (c) No ruling covers it? This asker is NOT on the trusted tier (`U_ASKER` is not on trusted-askers.json), so go to (d).",
    );
    expect(text).toContain("--need ruling");
  });

  it("states the question and the execution context", () => {
    const text = render({ question: "what are my open PRs?" });
    expect(text).toContain("QUESTION: what are my open PRs?");
    expect(text).toContain("mode=single-turn, host=claude-code");
  });

  it("states the outbound size caps, so an inline-tier answer composed here has its budget up front", () => {
    const text = render({ question: "what are my open PRs?" });
    expect(text).toContain("OUTBOUND SIZE CAPS");
    expect(text).toContain(`≤ ${String(BODY_MAX_BLOCKS)} sub-blocks (BODY_MAX_BLOCKS)`);
  });

  it("makes both halves of a loaded private profile mandatory and surfaces recent pain guidance", () => {
    const profileInput: RoutingJudgementInput = {
      ...ROUTING_INPUT,
      profile: {
        provenance: {
          minedAt: "2026-08-14T00:00:00.000Z",
          sourceManifestHash: `sha256:${"0".repeat(64)}`,
        },
        routing: { counterexamples: [], examples: [], principles: ["choose the smallest sufficient tier"] },
        schemaVersion: 1,
        voice: { examples: [], principles: ["lead with the outcome"] },
      },
    };
    const profiled = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.1",
      question: "what did we decide?",
      routingInput: profileInput,
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });
    const text = renderTurnRoutingBrief({
      brief: profiled,
      briefPath: "/tmp/profiled.json",
      painPoints: [
        {
          fieldPath: "body",
          kind: "voice",
          lane: "as-me",
          reason: 'authored prose matched configured word voice rule "blockedword"',
          tsIso: "2026-08-14T00:01:00.000Z",
        },
      ],
      tagTree: TAG_TREE,
    }).join("\n");

    expect(text).toContain("PRIVATE JUDGEMENT/VOICE PROFILE: loaded.");
    expect(text).toContain("Read /tmp/profiled.json at routingInput.profile");
    expect(text).toContain("Apply routing.* to the routing decision and voice.* to every answer");
    expect(text).toContain("VOICE RULES, binding on EVERY string that renders");
    expect(text).toContain("evidence labels");
    expect(text).toContain("    1. lead with the outcome");
    expect(text).toContain('authored prose matched configured word voice rule "blockedword"');
  });

  it("states when no private profile is loaded instead of silently implying one was applied", () => {
    expect(render({ question: "what did we decide?" })).toContain("PRIVATE JUDGEMENT/VOICE PROFILE: none loaded");
  });

  it("prints the reply-disclosure rule on a brief carrying NEITHER a profile NOR a directive — the fresh-install state", () => {
    const text = render({ question: "who has been slowest to close out their assigned tickets?" });

    expect(text).toContain("PRIVATE JUDGEMENT/VOICE PROFILE: none loaded");
    expect(text).toContain("CURRENT OWNER DIRECTIVES: none loaded.");
    expect(text).toContain("WHAT MAY BE ASKED — the standing owner rule, and it never loads conditionally:");
    expect(text).toContain("most accurate, citation-backed answer to ANY question");
    expect(text).toContain("Tact is the ASKER's onus, never yours.");
  });

  it("puts the standing rule ahead of the profile, which can be absent", () => {
    const text = render({ question: "what did we decide?" });

    expect(text.indexOf("WHAT MAY BE ASKED")).toBeLessThan(text.indexOf("PRIVATE JUDGEMENT/VOICE PROFILE"));
  });

  it("prints what the reply may share on a fresh-install brief, after the tree and ahead of the profile", () => {
    const text = render({ question: "where is the owner today?" });

    expect(text).toContain("CURRENT OWNER DIRECTIVES: none loaded.");
    expect(text).toContain(replyDisclosureLines()[0]!);
    expect(text).toContain("--need risky-approval");
    expect(text.indexOf("WHAT HAPPENS TO THIS ASK")).toBeLessThan(text.indexOf("WHAT THE REPLY MAY SHARE"));
    expect(text.indexOf("WHAT THE REPLY MAY SHARE")).toBeLessThan(text.indexOf("PRIVATE JUDGEMENT/VOICE PROFILE"));
  });

  it("loads current owner rulings by reference, states their precedence, and keeps their text collapsed", () => {
    const directed = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.1",
      question: "the normal finalizer broke again",
      routingInput: { ...ROUTING_INPUT, ownerDirectives: [OWNER_DIRECTIVE] },
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });
    const parsed = unwrap(parseTurnRoutingBrief({ raw: JSON.parse(JSON.stringify(directed)) }));
    const text = renderTurnRoutingBrief({
      brief: parsed,
      briefPath: "/tmp/directed.json",
      tagTree: TAG_TREE,
    }).join("\n");

    expect(parsed.routingInput.ownerDirectives).toEqual([OWNER_DIRECTIVE]);
    expect(text).toContain("CURRENT OWNER DIRECTIVES: 1 loaded.");
    expect(text).toContain("Read /tmp/directed.json at routingInput.ownerDirectives");
    expect(text).toContain("overrides conflicting mined-profile guidance");
    expect(text).not.toContain(OWNER_DIRECTIVE.text);
  });

  it("lists the available capability and the unavailable one, separately", () => {
    const text = render({ question: "what are my open PRs?" });
    expect(text).toContain("AVAILABLE CAPABILITIES");
    expect(text).toContain("github-vulnerability-report [available]");
    expect(text).toContain("production-logs [UNAVAILABLE]");
  });

  it("names the exact command that hands the decision to dispatch, including the brief's own path", () => {
    expect(render({ question: "what did we decide?" })).toContain("slopweaver turn dispatch --brief /tmp/b.json");
  });

  it("warns the continuous-drain loop that read-only-subagent is refused", () => {
    const drainInput: RoutingJudgementInput = {
      ...ROUTING_INPUT,
      execution: { mode: "continuous-drain", supervisorHost: "codex" },
    };
    const drainBrief = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.1",
      question: "what did we decide?",
      routingInput: drainInput,
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });
    const text = renderTurnRoutingBrief({
      brief: drainBrief,
      briefPath: "/tmp/b.json",
      tagTree: TAG_TREE,
    }).join("\n");
    expect(text).toContain("will be REFUSED by `turn dispatch`");
  });

  it("tells a single turn on the codex host every tier is admissible and the supervisor tick reconciles", () => {
    const codexSingleTurnInput: RoutingJudgementInput = {
      ...ROUTING_INPUT,
      execution: { mode: "single-turn", supervisorHost: "codex" },
    };
    const codexSingleTurnBrief = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.1",
      question: "what did we decide?",
      routingInput: codexSingleTurnInput,
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });
    const text = renderTurnRoutingBrief({
      brief: codexSingleTurnBrief,
      briefPath: "/tmp/b.json",
      tagTree: TAG_TREE,
    }).join("\n");
    expect(text).toContain("are admissible on either host. A fresh worker posts its own answer");
  });

  it("renders the addressing message separately from the thread, so a reply is never mistaken for a top-level tag", () => {
    const built = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "2.2",
      question: "what did we decide?",
      routingInput: ROUTING_INPUT,
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });
    const text = renderTurnRoutingBrief({
      brief: built,
      briefPath: "/tmp/b.json",
      tagTree: TAG_TREE,
    }).join("\n");
    expect(text).toContain("addressing message: 2.2");
    expect(text).toContain("thread: 1.1");
  });

  it("adds proposal guidance when the ask proposes something, naming the classes that can go and look", () => {
    const proposalBrief = buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.1",
      question: "what does standing this up cost the platform team",
      routingInput: {
        ...ROUTING_INPUT,
        context: {
          controlPlane: {
            ownerAddressingText: "what does standing this up cost the platform team",
            structuralMetadata: [{ key: "channel", value: "C1" }],
          },
          quotedEvidence: [],
        },
      },
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });
    const text = renderTurnRoutingBrief({
      brief: proposalBrief,
      briefPath: "/tmp/p.json",
      tagTree: TAG_TREE,
    }).join("\n");

    expect(text).toContain('THIS ASK PROPOSES SOMETHING — it says "what does standing this up cost"');
    expect(text).toContain("REQUIRED provider/repository/atlas-class");
    expect(text).toContain("`premiseChecks`");
  });

  it("adds nothing at all for an ask that proposes nothing — every other brief stays the length it was", () => {
    expect(render({ question: "what are my open PRs?" })).not.toContain("THIS ASK PROPOSES SOMETHING");
  });
});
