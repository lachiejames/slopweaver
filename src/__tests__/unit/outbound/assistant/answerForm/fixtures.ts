/*
 * One valid fixture per shape `answerFormSchema` accepts: the `answer` form under each of its three grounding
 * kinds. Pure data, so every `answerForm/` test file reads one copy.
 */

/** A valid `answer` arm, `conversation`-grounded — no live source matched, session-authored evidence. */
export const VALID_ANSWER_CONVERSATION = {
  answering: {
    permalink: "https://example.slack.com/archives/C1AAAAA/p1700000000000000",
    quote: "does the pane read the local checkout or a cached one",
  },
  body: [
    {
      runs: [
        { text: "The pane reads the local checkout, never a cache ", type: "text" },
        { citationId: "1", type: "citation" },
        { text: ".", type: "text" },
      ],
      type: "paragraph",
    },
  ],
  citations: [
    {
      id: "1",
      label: "[1]",
      sourceRef: { id: "src/pane/section.ts", source: "github" },
      url: "https://github.com/example/repo/blob/main/src/pane/section.ts",
    },
  ],
  documents: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "the code itself already answers this" },
      premiseChecks: [],
      read: [{ label: "src/pane/section.ts" }],
      substitutedForReal: [],
    },
    kind: "conversation",
    provenance: { model: "claude-sonnet-5", skillsLoaded: ["slopweaver:store"], verbsLoaded: ["handover", "store"] },
    reason: "the code itself already answers this, no live check needed",
  },
  images: ["/tmp/screenshot.png"],
  index: [],
  kind: "answer",
  measurements: [],
  lead: "The pane reads the local checkout, never a cache.",
} as const;

/** A valid `answer` arm, `verb`-grounded — a live command's own output, no corpus claims. */
export const VALID_ANSWER_VERB = {
  body: [
    { runs: [{ text: "jobs-api leads staging P2024 events, not checkout-api.", type: "text" }], type: "paragraph" },
  ],
  citations: [],
  documents: [],
  grounding: {
    capability: {
      command: ["fleet", "status"],
      id: "fleet-status",
      what: "every open pull request across the tracked repos",
    },
    evidence: {
      consultedEmpty: [{ label: "the linear corpus" }],
      couldNotSee: { blindSpots: [], reason: "the command's own output was sufficient" },
      premiseChecks: [],
      read: [{ label: "the Datadog logs partition", url: "https://app.datadoghq.com/logs" }],
      substitutedForReal: [],
    },
    kind: "verb",
    provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: ["fleet"] },
    result: "553 P2024 events over a closed 48h, 82% of the org total",
  },
  images: [],
  index: [],
  kind: "answer",
  measurements: [],
  lead: "Staging is still pool-exhausted.",
} as const;

/** A valid `answer` arm, `unreachable`-grounded — nothing reachable could establish the answer. */
const VALID_ANSWER_UNREACHABLE = {
  body: [{ runs: [{ text: "No connector here reaches the billing estate.", type: "text" }], type: "paragraph" }],
  citations: [],
  documents: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: ["the payment processor's own dashboard"] },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "unreachable",
    provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
    surface: { id: "billing", what: "the payment processor and the billing records it holds" },
    why: "no connector reaches Stripe",
  },
  images: [],
  index: [],
  kind: "answer",
  measurements: [],
  lead: "I cannot see the billing estate from here.",
} as const;

/** Every representable form — one `answer` fixture per grounding branch. */
export const FORM_FIXTURES = [
  { name: "answer.conversation", value: VALID_ANSWER_CONVERSATION },
  { name: "answer.verb", value: VALID_ANSWER_VERB },
  { name: "answer.unreachable", value: VALID_ANSWER_UNREACHABLE },
] as const;
