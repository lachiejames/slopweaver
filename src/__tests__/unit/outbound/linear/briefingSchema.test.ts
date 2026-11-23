import { describe, expect, it } from "vitest";

import { linearBriefingFormSchema } from "../../../../outbound/linear/briefingSchema.js";
import { BACKLOG, BRIEFING, COVERAGE, LOW_COMMENT } from "./briefingFixture.js";

/** Every rejection, as `path: message`, so a test asserts which check fired. */
function problems({ form }: { form: unknown }): readonly string[] {
  const parsed = linearBriefingFormSchema.safeParse(form);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("linearBriefingFormSchema", () => {
  it("accepts a briefing carrying every write kind", () => {
    expect(problems({ form: BRIEFING })).toEqual([]);
  });

  it("accepts an empty briefing whose every source is accounted for", () => {
    expect(problems({ form: { ...BRIEFING, proposals: [] } })).toEqual([]);
  });

  it("refuses an item id used twice, because the answer names items by it", () => {
    const found = problems({ form: { ...BRIEFING, proposals: [LOW_COMMENT, LOW_COMMENT] } });

    expect(found).toEqual(['proposals.1: item id "eng-7-comment" is used twice']);
  });

  it("refuses a source that vanished from coverage, so a gap cannot hide", () => {
    const found = problems({ form: { ...BRIEFING, coverage: COVERAGE.filter((entry) => entry.source !== "slack") } });

    expect(found).toEqual(['coverage: coverage names "slack" 0 times — exactly once, read or a named gap']);
  });

  it("refuses a proposal with no evidence", () => {
    const found = problems({ form: { ...BRIEFING, proposals: [{ ...LOW_COMMENT, evidence: [] }] } });

    expect(found).toEqual(["proposals.0.evidence: every proposal carries at least one evidence link"]);
  });

  it("refuses a backlog move that leaves the issue in the cycle", () => {
    const write = BACKLOG.write as Extract<typeof BACKLOG.write, { kind: "stale-to-backlog" }>;
    const partial = {
      ...BACKLOG,
      write: { ...write, update: { ...write.update, fields: { ...write.update.fields, cycleId: undefined } } },
    };

    const found = problems({ form: { ...BRIEFING, proposals: [partial] } });

    expect(found).toEqual([
      "proposals.0.write: a backlog move is the Backlog state AND `cycleId: null` AND `assignee: null` in one " +
        "form — a partial move leaves it in the cycle and on the assignee",
    ]);
  });

  it("refuses a move that sets no state", () => {
    const write = BACKLOG.write as Extract<typeof BACKLOG.write, { kind: "stale-to-backlog" }>;
    const stateless = {
      ...BACKLOG,
      write: {
        ...write,
        kind: "state-change",
        update: { ...write.update, fields: { teamId: "00000000-0000-4000-8000-000000000001", title: "The ticket" } },
      },
    };

    const found = problems({ form: { ...BRIEFING, proposals: [stateless] } });

    expect(found).toEqual([
      "proposals.0.write.update: a move sets fields.stateId — copy one `slopweaver linear states --team <key>` printed",
    ]);
  });

  it("refuses a move naming its issue by key, which `linear issue update --issue-id` would refuse", () => {
    const write = BACKLOG.write as Extract<typeof BACKLOG.write, { kind: "stale-to-backlog" }>;
    const keyed = { ...BACKLOG, write: { ...write, issueId: "ENG-9" } };

    const found = problems({ form: { ...BRIEFING, proposals: [keyed] } });

    expect(found).toEqual([
      "proposals.0.write.issueId: a move names its issue by the UUID v4 `linear read <key> --json` prints — " +
        "`linear issue update` takes no key",
    ]);
  });

  it("refuses an item id that is not lower-case kebab", () => {
    const found = problems({ form: { ...BRIEFING, proposals: [{ ...LOW_COMMENT, id: "ENG 7" }] } });

    expect(found).toEqual(["proposals.0.id: an item id is lower-case kebab, e.g. `eng-42-backlog`"]);
  });

  it("refuses a zone this runtime cannot format in", () => {
    const found = problems({ form: { ...BRIEFING, zone: "Mars/Olympus" } });

    expect(found).toEqual(["zone: zone is an IANA name, e.g. Australia/Melbourne"]);
  });

  it("refuses a two-line why, because the page renders it as one row", () => {
    const found = problems({ form: { ...BRIEFING, proposals: [{ ...LOW_COMMENT, why: "one\ntwo" }] } });

    expect(found).toEqual(["proposals.0.why: one line — the page renders it as a single row"]);
  });
});
