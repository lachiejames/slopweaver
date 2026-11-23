/*
 * Parity between parse and send on the evidence trail: a bare URL the wire guard would refuse in a measurement's
 * repro or a premise check's `how` is refused at parse, while a linked or redacted one still parses.
 */
import { describe, expect, it } from "vitest";

import { type AnswerFormAnswer, answerFormSchema } from "../../../../../outbound/assistant/answerForm.js";
import { rawMarkupIssuesOfAnswer } from "../../../../../outbound/assistant/answerMarkupChecks.js";
import { VALID_ANSWER_VERB } from "./fixtures.js";

describe("the evidence trail is refused at PARSE for anything the send's wire guard would refuse", () => {
  /**
   * MEASURED on a live send: a bare URL
   * in `measurements[0].repro` validated and cleared review, then threw at the wire guard mid-send over a live
   * worker. `lead`/`body`/`index` were read for raw markup; the trail the same message renders was not.
   */
  const RAW_URL = "https://github.com/example/repo/pull/16524";

  it("REFUSES a bare URL in a measurement's repro, naming the span and the path", () => {
    const parsed = answerFormSchema.safeParse({
      ...VALID_ANSWER_VERB,
      measurements: [
        { figures: ["553"], repro: `slopweaver github read ${RAW_URL}`, takenAtIso: "2026-09-24T02:40:00Z" },
      ],
    });

    expect(parsed.success).toBe(false);
    const rootIssues = parsed.error!.issues.filter((issue) => issue.path.length === 0);
    expect(rootIssues).toHaveLength(1);
    expect(rootIssues[0]!.message).toContain("would be refused at send");
    expect(rootIssues[0]!.message).toContain(RAW_URL);
  });

  it("REFUSES a bare URL in a premise check's `how`", () => {
    const parsed = answerFormSchema.safeParse({
      ...VALID_ANSWER_VERB,
      grounding: {
        ...VALID_ANSWER_VERB.grounding,
        evidence: {
          ...VALID_ANSWER_VERB.grounding.evidence,
          premiseChecks: [
            { checkedAtIso: "2026-09-24T02:40:00Z", finding: "exists", how: `opened ${RAW_URL}`, subject: "the PR" },
          ],
        },
      },
    });

    expect(parsed.success).toBe(false);
    const rootIssues = parsed.error!.issues.filter((issue) => issue.path.length === 0);
    expect(rootIssues).toHaveLength(1);
    expect(rootIssues[0]!.message).toContain(RAW_URL);
  });

  it("reports nothing for an answer whose every rendered run is clean", () => {
    const form: AnswerFormAnswer = {
      body: [],
      citations: [],
      documents: [],
      grounding: {
        capability: { command: ["fleet", "status"], id: "fleet-status", what: "open pull requests" },
        evidence: {
          consultedEmpty: [],
          couldNotSee: { blindSpots: [], reason: "nothing else to check" },
          premiseChecks: [],
          read: [{ label: "the pull request", url: RAW_URL }],
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
      measurements: [{ figures: ["3"], repro: "slopweaver fleet status", takenAtIso: "2026-09-24T02:40:00Z" }],
    };

    expect(rawMarkupIssuesOfAnswer({ form })).toEqual([]);
  });

  it("accepts an IP-host URL the send's PII pass turns into no URL at all — parity with the wire, not stricter", () => {
    // A review counterexample: the send redacts `203.0.113.7` to `[ip]` before the wire guard
    // reads, and `https://[ip]/x` is no URL, so refusing it here would refuse an answer the wire accepts.
    const parsed = answerFormSchema.safeParse({
      ...VALID_ANSWER_VERB,
      measurements: [{ figures: ["553"], repro: "curl https://203.0.113.7/x", takenAtIso: "2026-09-24T02:40:00Z" }],
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts the SAME URL where the trail renders it as a link — a premise check's `url`", () => {
    const parsed = answerFormSchema.safeParse({
      ...VALID_ANSWER_VERB,
      grounding: {
        ...VALID_ANSWER_VERB.grounding,
        evidence: {
          ...VALID_ANSWER_VERB.grounding.evidence,
          premiseChecks: [
            {
              checkedAtIso: "2026-09-24T02:40:00Z",
              finding: "exists",
              how: "opened it",
              subject: "the PR",
              url: RAW_URL,
            },
          ],
        },
      },
    });

    expect(parsed.success).toBe(true);
  });
});
