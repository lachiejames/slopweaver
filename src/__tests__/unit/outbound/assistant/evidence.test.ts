import { describe, expect, it } from "vitest";

import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";
import {
  type EvidenceTrail,
  evidenceTrailFor,
  type Provenance,
  renderEvidenceTrail,
} from "../../../../outbound/assistant/evidence.js";

/** A provenance fixture with every field populated, so a render test has an unambiguous baseline. */
const PROVENANCE: Provenance = {
  model: "claude-sonnet-5",
  skillsLoaded: ["slopweaver:store"],
  verbsLoaded: ["handover", "store"],
};

/** A verb-grounded answer fixture — its `grounding.evidence` IS the trail. */
const VERB_ANSWER = {
  body: [],
  citations: [],
  documents: [],
  grounding: {
    capability: { command: ["fleet", "status"], id: "fleet-status", what: "open pull requests" },
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else to check" },
      premiseChecks: [],
      read: [{ label: "slopweaver fleet status" }],
      substitutedForReal: [],
    },
    kind: "verb",
    provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
    result: "3 open PRs",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "You have 3 open PRs.",
  measurements: [],
} satisfies AnswerFormAnswer;

/** A conversation-grounded answer fixture — its `grounding.evidence` IS the trail, same as `verb`/`unreachable`. */
const CONVERSATION_ANSWER = {
  body: [],
  citations: [],
  documents: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "no live source matched, and nothing needed checking" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "conversation",
    provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "the question is about a past decision, already known from context",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "We decided to keep BM25-only retrieval.",
  measurements: [],
} satisfies AnswerFormAnswer;

describe("evidenceTrailFor", () => {
  it("returns a verb-grounded answer's own evidence unchanged", () => {
    expect(evidenceTrailFor({ answer: VERB_ANSWER })).toEqual(VERB_ANSWER.grounding.evidence);
  });

  it("returns a conversation-grounded answer's own evidence unchanged, same as a verb-grounded one", () => {
    expect(evidenceTrailFor({ answer: CONVERSATION_ANSWER })).toEqual(CONVERSATION_ANSWER.grounding.evidence);
  });
});

/** Every key AND every string leaf found anywhere in a value's tree — arrays and objects both walked. */
function collectKeysAndStrings({
  value,
  keys,
  strings,
}: {
  value: unknown;
  keys: Set<string>;
  strings: string[];
}): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectKeysAndStrings({ keys, strings, value: item });
    });
    return;
  }
  if (typeof value === "string") {
    strings.push(value);
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key);
    collectKeysAndStrings({ keys, strings, value: nested });
  }
}

describe("renderEvidenceTrail", () => {
  const trail: EvidenceTrail = {
    consultedEmpty: [{ label: "notion — no records on disk for this leg" }],
    couldNotSee: { blindSpots: ["slack [failed] — 2 path(s) could not be read"] },
    premiseChecks: [],
    read: [{ label: "src/pane/section.ts", url: "https://github.com/example/repo/blob/main/src/pane/section.ts" }],
    substitutedForReal: [],
  };

  it("renders a substitution as the real artifact AND the reason, in one line", () => {
    const withSubstitution: EvidenceTrail = {
      ...trail,
      substitutedForReal: [
        { real: "the deployed monitor's own evaluation panel", why: "no DD_APP_KEY here, so pulumi up refused" },
      ],
    };

    const blocks = renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail: withSubstitution });

    expect(blocks[2]).toEqual({
      elements: [
        {
          elements: [{ style: { bold: true }, text: "Stood in for the real thing", type: "text" }],
          type: "rich_text_section",
        },
        {
          elements: [
            {
              elements: [
                { style: { bold: true }, text: "the deployed monitor's own evaluation panel", type: "text" },
                { text: " — not produced this turn: no DD_APP_KEY here, so pulumi up refused", type: "text" },
              ],
              type: "rich_text_section",
            },
          ],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    });
  });

  // This case is also the WITNESS that a measurement-free answer renders no measurement section: the
  // expectation below is exact, so a block appearing for an empty `measurements` reddens it.
  it("renders exactly the approved order: read, consultedEmpty, couldNotSee, then provenance — no wrapper", () => {
    expect(renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail })).toEqual([
      {
        elements: [
          { elements: [{ style: { bold: true }, text: "What I read", type: "text" }], type: "rich_text_section" },
          {
            elements: [
              {
                elements: [
                  {
                    text: "src/pane/section.ts",
                    type: "link",
                    url: "https://github.com/example/repo/blob/main/src/pane/section.ts",
                  },
                ],
                type: "rich_text_section",
              },
            ],
            style: "bullet",
            type: "rich_text_list",
          },
        ],
        type: "rich_text",
      },
      {
        elements: [
          {
            elements: [{ style: { bold: true }, text: "Consulted, found nothing", type: "text" }],
            type: "rich_text_section",
          },
          {
            elements: [
              {
                elements: [{ text: "notion — no records on disk for this leg", type: "text" }],
                type: "rich_text_section",
              },
            ],
            style: "bullet",
            type: "rich_text_list",
          },
        ],
        type: "rich_text",
      },
      {
        elements: [
          {
            elements: [{ style: { bold: true }, text: "What I could not see", type: "text" }],
            type: "rich_text_section",
          },
          {
            elements: [
              {
                elements: [{ text: "slack [failed] — 2 path(s) could not be read", type: "text" }],
                type: "rich_text_section",
              },
            ],
            style: "bullet",
            type: "rich_text_list",
          },
        ],
        type: "rich_text",
      },
      {
        elements: [
          {
            text: "claude-sonnet-5 · verbs: handover, store · skills: slopweaver:store",
            type: "mrkdwn",
          },
        ],
        type: "context",
      },
    ]);
  });

  it("renders the premise checks FIRST, dated, above everything the rest of the answer rests on", () => {
    const withPremise: EvidenceTrail = {
      ...trail,
      premiseChecks: [
        {
          checkedAtIso: "2026-08-29T13:58:54.016Z",
          finding: "exists",
          how: "searched the org for it through the door",
          subject: "the repository being proposed",
          url: "https://github.com/example/repo",
        },
      ],
    };

    const blocks = renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail: withPremise });

    expect(blocks[0]).toEqual({
      elements: [
        {
          elements: [{ style: { bold: true }, text: "What I checked before answering", type: "text" }],
          type: "rich_text_section",
        },
        {
          elements: [
            {
              elements: [
                { text: "the repository being proposed", type: "link", url: "https://github.com/example/repo" },
                {
                  text: " — exists — searched the org for it through the door, as of 2026-08-29T13:58:54.016Z",
                  type: "text",
                },
              ],
              type: "rich_text_section",
            },
          ],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    });
  });

  it("renders the measurement list, figures first and the instant in the same line", () => {
    const blocks = renderEvidenceTrail({
      measurements: [
        {
          figures: ["1,771", "49%"],
          repro: "slopweaver atlas datadog --alerts --window 30d",
          takenAtIso: "2026-09-20T07:00:00.000Z",
        },
      ],
      provenance: PROVENANCE,
      trail,
    });

    expect(blocks[0]).toEqual({
      elements: [
        {
          elements: [{ style: { bold: true }, text: "How each figure was measured", type: "text" }],
          type: "rich_text_section",
        },
        {
          elements: [
            {
              elements: [
                { style: { bold: true }, text: "1,771, 49%", type: "text" },
                {
                  text: " — slopweaver atlas datadog --alerts --window 30d, as of 2026-09-20T07:00:00.000Z",
                  type: "text",
                },
              ],
              type: "rich_text_section",
            },
          ],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    });
  });

  it("renders a premise check with no url as plain text, never a fabricated link", () => {
    const withPremise: EvidenceTrail = {
      ...trail,
      premiseChecks: [
        {
          checkedAtIso: "2026-08-29T13:58:54.016Z",
          finding: "absent",
          how: "the working checkout's own remote",
          subject: "a second review queue",
        },
      ],
    };

    const blocks = renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail: withPremise });

    expect(blocks[0]).toEqual({
      elements: [
        {
          elements: [{ style: { bold: true }, text: "What I checked before answering", type: "text" }],
          type: "rich_text_section",
        },
        {
          elements: [
            {
              elements: [
                { text: "a second review queue", type: "text" },
                {
                  text: " — absent — the working checkout's own remote, as of 2026-08-29T13:58:54.016Z",
                  type: "text",
                },
              ],
              type: "rich_text_section",
            },
          ],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    });
  });

  it("omits the premise section entirely when there is nothing to state", () => {
    const blocks = renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail });

    expect(JSON.stringify(blocks)).not.toContain("What I checked before answering");
  });

  it("omits the read and consultedEmpty sections entirely when they are empty, but never omits couldNotSee", () => {
    const bare: EvidenceTrail = {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing was unreadable, absent or stale" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    };

    const blocks = renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail: bare });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      elements: [
        {
          elements: [
            { style: { bold: true }, text: "What I could not see", type: "text" },
            { text: " — nothing: nothing was unreadable, absent or stale", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("renders 'no verbs loaded' / 'no skills loaded' when a provenance carries neither", () => {
    const bareProvenance: Provenance = { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] };
    const bareTrail: EvidenceTrail = {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing was unreadable, absent or stale" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    };

    const blocks = renderEvidenceTrail({ measurements: [], provenance: bareProvenance, trail: bareTrail });

    expect(blocks[1]).toEqual({
      elements: [{ text: "claude-sonnet-5 · no verbs loaded · no skills loaded", type: "mrkdwn" }],
      type: "context",
    });
  });

  it("carries no attachments key and no session link anywhere in the rendered tree", () => {
    const blocks = renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail });

    const keys = new Set<string>();
    const strings: string[] = [];
    collectKeysAndStrings({ keys, strings, value: blocks });

    expect(keys.has("attachments")).toBe(false);
    expect(strings.some((text) => text.toLowerCase().includes("session"))).toBe(false);
  });

  it("is deterministic: the same trail and provenance render deeply-equal blocks on repeat calls", () => {
    const once = renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail });
    const twice = renderEvidenceTrail({ measurements: [], provenance: PROVENANCE, trail });

    expect(once).toEqual(twice);
  });
});
