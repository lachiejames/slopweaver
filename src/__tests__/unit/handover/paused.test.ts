import { describe, expect, it } from "vitest";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { pausedPhrase, pausedProblems, pausedRefusal, pausedStateOf } from "../../../handover/paused.js";

function doc(over: Partial<HandoverDoc> & { slug: string }): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: undefined,
    baseBranch: undefined,
    blockedBy: [],
    branch: undefined,
    doneWhen: [],
    evidence: [],
    kind: "doc",
    notDoneReason: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    origin: undefined,
    outputs: [],
    pausedOn: undefined,
    pausedSince: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    path: `/h/${over.slug}.md`,
    priority: undefined,
    probeWaiver: undefined,
    lean: undefined,
    examples: [],
    exampleGap: undefined,
    options: [],
    problem: undefined,
    problems: [],
    repo: undefined,
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    status: "ready",
    statusSummary: undefined,
    summary: undefined,
    supervisorState: undefined,
    ...over,
  };
}

/** The front-matter a real pause carries, as `handover pause` writes it. */
const PAUSED_TEXT = [
  "---",
  "slug: a-daily-post",
  "status: paused",
  "pausedOn: the reviewer it was sent to",
  "pausedSince: 2026-09-04T02:00:00.000Z",
  "---",
  "",
  "# body",
  "",
].join("\n");

describe("pausedProblems", () => {
  it("refuses a paused row that names nobody", () => {
    const problems = pausedProblems({
      declaredStatus: "paused",
      doc: doc({ slug: "a", status: "paused" }),
    });

    expect(problems).toEqual([
      "a paused row declares no pausedOn — `paused` with nobody named is the unfalsifiable parking this state replaced",
    ]);
  });

  it("refuses a pausedOn declared beside any other status", () => {
    const problems = pausedProblems({
      declaredStatus: "ready",
      doc: doc({ pausedOn: "a reviewer", slug: "a" }),
    });

    expect(problems).toEqual(["pausedOn is only meaningful on a paused row — declare `status: paused` or remove it"]);
  });

  it("names both misplaced fields in one sentence", () => {
    const problems = pausedProblems({
      declaredStatus: "ready",
      doc: doc({ pausedOn: "a reviewer", pausedSince: "2026-09-04T02:00:00.000Z", slug: "a" }),
    });

    expect(problems).toEqual([
      "pausedOn, pausedSince are only meaningful on a paused row — declare `status: paused` or remove them",
    ]);
  });

  /** An unreadable `status:` is already its own finding; two sentences for one defect names neither. */
  it("stays silent when the status itself did not parse", () => {
    const problems = pausedProblems({
      declaredStatus: "blocked",
      doc: doc({ pausedOn: "a reviewer", slug: "a", status: "unknown" }),
    });

    expect(problems).toEqual([]);
  });

  it("refuses a pausedSince that is not an instant", () => {
    const problems = pausedProblems({
      declaredStatus: "paused",
      doc: doc({ pausedOn: "a reviewer", pausedSince: "last tuesday", slug: "a", status: "paused" }),
    });

    expect(problems).toEqual(['pausedSince: "last tuesday" is not an instant']);
  });

  it("passes a well-formed pause", () => {
    const problems = pausedProblems({
      declaredStatus: "paused",
      doc: doc({ pausedOn: "a reviewer", pausedSince: "2026-09-04T02:00:00.000Z", slug: "a", status: "paused" }),
    });

    expect(problems).toEqual([]);
  });

  it("passes an ordinary doc that mentions no pause at all", () => {
    expect(pausedProblems({ declaredStatus: "ready", doc: doc({ slug: "a" }) })).toEqual([]);
  });
});

describe("parseHandoverDoc — the pause reaches the doc", () => {
  it("reads both fields off real front-matter", () => {
    const parsed = parseHandoverDoc({ path: "/h/a-daily-post.md", text: PAUSED_TEXT });

    expect(parsed.status).toBe("paused");
    expect(parsed.pausedOn).toBe("the reviewer it was sent to");
    expect(parsed.pausedSince).toBe("2026-09-04T02:00:00.000Z");
    expect(parsed.problems).toEqual([]);
  });

  /** `blocked` stays unreadable — this state is an addition, never a rehabilitation of that word. */
  it("still refuses `status: blocked`", () => {
    const parsed = parseHandoverDoc({
      path: "/h/b.md",
      text: "---\nslug: b\nstatus: blocked\n---\n",
    });

    expect(parsed.status).toBe("unknown");
  });

  it("carries a nameless pause through as a doc problem", () => {
    const parsed = parseHandoverDoc({ path: "/h/c.md", text: "---\nslug: c\nstatus: paused\n---\n" });

    expect(parsed.problems).toEqual([
      "a paused row declares no pausedOn — `paused` with nobody named is the unfalsifiable parking this state replaced",
    ]);
  });
});

describe("pausedStateOf", () => {
  it("returns who and since for a well-formed pause", () => {
    const state = pausedStateOf({
      doc: doc({ pausedOn: "a reviewer", pausedSince: "2026-09-04T02:00:00.000Z", slug: "a", status: "paused" }),
    })!;

    expect(state.who).toBe("a reviewer");
    expect(state.since).toBe("2026-09-04T02:00:00.000Z");
  });

  it("returns undefined for a paused row with no subject, so nothing prints a blank pause", () => {
    expect(pausedStateOf({ doc: doc({ slug: "a", status: "paused" }) })).toBe(undefined);
  });

  it("returns undefined for a row that is not paused", () => {
    expect(pausedStateOf({ doc: doc({ slug: "a" }) })).toBe(undefined);
  });
});

describe("pausedPhrase", () => {
  it("says who, and says outright that nothing is overdue", () => {
    expect(pausedPhrase({ state: { since: "2026-09-04T02:00:00.000Z", who: "a reviewer" } })).toBe(
      "paused on a reviewer, since 2026-09-04T02:00:00.000Z — no deadline, never overdue",
    );
  });

  /** The date is printed verbatim. Nothing subtracts from it, so no elapsed count can appear here. */
  it("omits the date entirely when none was recorded", () => {
    expect(pausedPhrase({ state: { since: undefined, who: "a reviewer" } })).toBe(
      "paused on a reviewer — no deadline, never overdue",
    );
  });
});

describe("pausedRefusal", () => {
  it("names who it waits on and the verb that changes that", () => {
    const refusal = pausedRefusal({
      doc: doc({ pausedOn: "a reviewer", slug: "a-daily-post", status: "paused" }),
    })!;

    expect(refusal).toBe(
      "a-daily-post is paused on a reviewer — no deadline, never overdue. " +
        "Unpausing is a decision, not a side effect of starting it: `slopweaver handover unpause a-daily-post`",
    );
  });

  it("lets every other row through", () => {
    expect(pausedRefusal({ doc: doc({ slug: "a", status: "in-progress" }) })).toBe(undefined);
  });
});
