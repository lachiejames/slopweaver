/**
 * One small diff record and its two sides, shared by the policy diff tests: a document whose rewording, addition
 * and bold-only label exercise every row kind, one red mark, and a control id that resolves.
 */
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";
import type { DocumentSources } from "../../../../policy/diff/model.js";

/** Where the fixture's control links. */
export const CONTROL_URL = "https://app.vanta.com/c/acme/controls/net-38";

/** Where the fixture's evidence slot links. */
export const SLOT_URL = "https://app.vanta.com/c/acme/documents/network-diagram";

/** The identifier context the fixture resolves against. */
export const CONTEXT: BareRefContext = { complianceControls: [{ id: "NET-38", url: CONTROL_URL }], repos: [] };

/** The fixture document's two sides. */
export const SOURCES: ReadonlyMap<string, DocumentSources> = new Map([
  [
    "network",
    {
      after: [
        "---",
        "control: NET-38",
        "---",
        "# Network",
        "",
        "**Owner:** platform",
        "",
        "Staging was refreshed in June 2026.",
        "",
        "The public bypass on the Core API is still live.",
      ].join("\n"),
      before: [
        "---",
        "control: NET-38",
        "---",
        "# Network",
        "",
        "Owner: platform",
        "",
        "Staging was refreshed on 9 Jun 2026.",
      ].join("\n"),
    },
  ],
]);

/**
 * The fixture record as JSON, with any top-level field replaced.
 *
 * @param overrides top-level fields to replace
 * @returns the record file's text
 */
export function recordText({ overrides = {} }: { overrides?: Record<string, unknown> } = {}): string {
  return JSON.stringify({
    documents: [
      {
        after: { label: "going to Vanta", source: { path: "after.md" } },
        before: { label: "your draft", source: { path: "before.md" } },
        changes: [
          {
            id: "refresh",
            match: ["Staging was refreshed"],
            was: "A date nobody could source.",
            why: "NET-38 needs the month.",
          },
          { id: "bypass", match: ["public bypass"], was: "Not mentioned.", why: "The exception is live." },
        ],
        controls: ["NET-38"],
        id: "network",
        marks: [
          {
            id: "unasked",
            label: "Not in the ask",
            match: ["public bypass"],
            note: "Read it before you approve.",
            tone: "red",
          },
        ],
        name: "Network diagram",
        vantaEvidence: "network-diagram",
      },
    ],
    formatting: {},
    keyChanges: ["the refresh date is sourced", "the bypass is named", "labels are bold"],
    lede: "Two changes to NET-38's evidence.",
    links: [],
    schemaVersion: 1,
    team: {
      ask: "tell me if you disagree",
      opener: "we just pushed these changes to Vanta after I reviewed them:",
      title: "As uploaded",
    },
    title: "Network: what changed",
    uploaded: false,
    ...overrides,
  });
}
