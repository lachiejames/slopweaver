import { describe, expect, it } from "vitest";

import type { LandingRow } from "../../../review/landing.js";
import { isVulnRosterRow, rosterCapacityLine, vulnRosterOf, vulnSubjectOfTitle } from "../../../review/vulnRoster.js";
import { landingRowFake } from "../../landingRowFake.js";

/** A landing row with only the fields the roster reads stated; every other field is the fake's default. */
function row({
  number,
  title,
  labels = [],
  blockedOn = [],
  ready = false,
}: {
  number: number;
  title: string;
  labels?: readonly string[];
  blockedOn?: readonly string[];
  ready?: boolean;
}): LandingRow {
  return landingRowFake({
    blockedOn,
    labels,
    number,
    ready,
    title,
    url: `https://github.com/owner/name/pull/${String(number)}`,
  });
}

describe("vulnSubjectOfTitle", () => {
  it("drops a leading ticket and a conventional-commit prefix", () => {
    expect(vulnSubjectOfTitle({ title: "[SUP-9634] fix(security): bump lodash-es to ^4.18.1" })).toBe(
      "bump lodash-es to ^4.18.1",
    );
  });

  it("drops a bare conventional-commit prefix with no ticket", () => {
    expect(vulnSubjectOfTitle({ title: "fix(security): bump axios" })).toBe("bump axios");
  });

  it("drops a scopeless prefix", () => {
    expect(vulnSubjectOfTitle({ title: "chore: bump degit" })).toBe("bump degit");
  });

  it("keeps the whole title when it follows no convention at all", () => {
    expect(vulnSubjectOfTitle({ title: "just some words" })).toBe("just some words");
  });

  it("keeps a title whose colon is prose rather than a prefix", () => {
    expect(vulnSubjectOfTitle({ title: "the thing we did: and why" })).toBe("the thing we did: and why");
  });

  it("answers the empty string for an empty title", () => {
    expect(vulnSubjectOfTitle({ title: "" })).toBe("");
  });
});

describe("isVulnRosterRow", () => {
  it("selects on the title convention, case-insensitively", () => {
    const selected = isVulnRosterRow({
      row: row({ number: 1, title: "[X-1] FIX(SECURITY): bump lodash" }),
      selector: { titleContains: "fix(security)" },
    });

    expect(selected).toBe(true);
  });

  it("rejects a row whose title does not carry the convention", () => {
    const selected = isVulnRosterRow({
      row: row({ number: 1, title: "feat(api): add a field" }),
      selector: { titleContains: "fix(security)" },
    });

    expect(selected).toBe(false);
  });

  it("requires the label as well when a selector names one", () => {
    const withLabel = isVulnRosterRow({
      row: row({ labels: ["dependencies"], number: 1, title: "fix(security): bump lodash" }),
      selector: { label: "dependencies", titleContains: "fix(security)" },
    });
    const withoutLabel = isVulnRosterRow({
      row: row({ labels: ["e2e-local"], number: 2, title: "fix(security): bump lodash" }),
      selector: { label: "dependencies", titleContains: "fix(security)" },
    });

    expect(withLabel).toBe(true);
    expect(withoutLabel).toBe(false);
  });
});

describe("vulnRosterOf", () => {
  it("keeps only the matching rows, oldest number first, and computes the room left under a cap", () => {
    const roster = vulnRosterOf({
      rows: [
        row({ number: 30, title: "fix(security): bump c" }),
        row({ number: 10, title: "feat: something else" }),
        row({ number: 20, title: "[T-1] fix(security): bump b" }),
      ],
      selector: { titleContains: "fix(security)" },
      target: 10,
    });

    expect(roster.entries.map((entry) => entry.number)).toEqual([20, 30]);
    expect(roster.entries[0]!.subject).toBe("bump b");
    expect(roster.capacity).toEqual({ kind: "capped", remaining: 8, target: 10 });
  });

  it("is uncapped when the row sets no target, whatever stands open", () => {
    const roster = vulnRosterOf({
      rows: [row({ number: 1, title: "fix(security): bump a" }), row({ number: 2, title: "fix(security): bump b" })],
      selector: { titleContains: "fix(security)" },
      target: undefined,
    });

    expect(roster.entries.length).toBe(2);
    expect(roster.capacity).toEqual({ kind: "uncapped" });
  });

  it("reports no room when the set is already over the cap, never a negative one", () => {
    const roster = vulnRosterOf({
      rows: [
        row({ number: 1, title: "fix(security): bump a" }),
        row({ number: 2, title: "fix(security): bump b" }),
        row({ number: 3, title: "fix(security): bump c" }),
      ],
      selector: { titleContains: "fix(security)" },
      target: 2,
    });

    expect(roster.entries.length).toBe(3);
    expect(roster.capacity).toEqual({ kind: "capped", remaining: 0, target: 2 });
  });

  it("carries GitHub's own code-owner answer through untouched", () => {
    const roster = vulnRosterOf({
      rows: [row({ blockedOn: ["@owner/platform", "@someone"], number: 5, title: "fix(security): bump a" })],
      selector: { titleContains: "fix(security)" },
      target: 10,
    });

    expect(roster.entries[0]!.blockedOn).toEqual(["@owner/platform", "@someone"]);
  });

  it("carries the head, labels and CodeRabbit verdict the digest's evidence marks read", () => {
    const roster = vulnRosterOf({
      rows: [
        landingRowFake({
          codeRabbit: "changes-requested",
          codeRabbitDetail: "2 open threads",
          headOid: "abcabcabcabcabcabcabcabcabcabcabcabcabca",
          labels: ["e2e-local", "dependencies"],
          number: 7,
          title: "fix(security): bump a",
        }),
      ],
      selector: { titleContains: "fix(security)" },
      target: 3,
    });

    expect(roster.entries[0]!.headOid).toBe("abcabcabcabcabcabcabcabcabcabcabcabcabca");
    expect(roster.entries[0]!.labels).toEqual(["e2e-local", "dependencies"]);
    expect(roster.entries[0]!.codeRabbit).toBe("changes-requested");
    expect(roster.entries[0]!.codeRabbitDetail).toBe("2 open threads");
  });

  it("reports the whole cap as room when nothing matches at all", () => {
    const roster = vulnRosterOf({
      rows: [row({ number: 1, title: "feat: unrelated" })],
      selector: { titleContains: "fix(security)" },
      target: 10,
    });

    expect(roster.entries).toEqual([]);
    expect(roster.capacity).toEqual({ kind: "capped", remaining: 10, target: 10 });
  });
});

describe("rosterCapacityLine", () => {
  it("states the open count, the cap and the room left under a cap", () => {
    expect(rosterCapacityLine({ capacity: { kind: "capped", remaining: 3, target: 5 }, open: 2 })).toBe(
      "2 of 5 open — 3 to raise",
    );
  });

  it("states the open count alone when uncapped", () => {
    expect(rosterCapacityLine({ capacity: { kind: "uncapped" }, open: 7 })).toBe("7 open — uncapped");
  });
});
