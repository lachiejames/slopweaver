/**
 * The fleet-finding record a description review's packet opens `evidence/` with: present only for a branch a
 * finding row claims exactly, carrying fixed fields and never a string the row's author wrote.
 */
import { describe, expect, it } from "vitest";

import type { HandoverDoc } from "../../../../handover/doc.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { findingPacketEvidence } from "../../../../outbound/github/descriptionFindingEvidence.js";
import { ask } from "../../sweep/askDocFixture.js";

/** A finding row whose author-written fields carry installation state: a session id and two home paths. */
const FINDING: HandoverDoc = ask({
  askedIso: "2026-11-21T15:03:52.444Z",
  branch: "a-finding-branch",
  evidence: [
    "/Users/fixture/.slopweaver/orchestration/aaaaaaaa-FIXTURE/artifact.md",
    "/Users/fixture/.slopweaver/orchestration/bbbbbbbb-FIXTURE/artifact.md",
  ],
  observedBy: "00000000-0000-4000-8000-FIXTURE00001",
  origin: "finding",
  slug: "a-finding-row",
});

const NO_JOURNALS = new Map<string, readonly RunEvent[]>();

/** The exact bytes the record is committed as. */
const EXPECTED_RECORD = [
  "{",
  '  "evidenceRecords": 2,',
  '  "observedBy": "agent",',
  '  "origin": "finding",',
  '  "registeredOn": "2026-11-21",',
  '  "schemaVersion": 1,',
  '  "what": "A visible agent session observed this problem and registered it on the board as a fleet finding."',
  "}",
  "",
].join("\n");

describe("findingPacketEvidence", () => {
  it("writes the fixed-field record for the branch a finding row declares", () => {
    const record = unwrap(
      findingPacketEvidence({ branch: "a-finding-branch", docs: [FINDING], journals: NO_JOURNALS }),
    );
    expect(record).toStrictEqual({ contents: EXPECTED_RECORD, name: "fleet-finding.json" });
  });

  it("copies no session id and no path the row's author wrote", () => {
    const record = unwrap(
      findingPacketEvidence({ branch: "a-finding-branch", docs: [FINDING], journals: NO_JOURNALS }),
    );
    expect(FINDING.observedBy).toBe("00000000-0000-4000-8000-FIXTURE00001");
    expect(FINDING.evidence[0]).toContain("/Users/fixture/");
    expect(record!.contents).not.toContain("FIXTURE");
    expect(record!.contents).not.toContain("/Users/");
    expect(record!.contents).not.toContain("a-finding-row");
  });

  it("matches the branch a run journal recorded at start, when the row declares none", () => {
    const row = { ...FINDING, branch: undefined };
    const journals = new Map<string, readonly RunEvent[]>([
      ["a-finding-row", [{ atIso: "2026-11-21T16:00:00.000Z", branch: "started-here", docHash: "h", kind: "started" }]],
    ]);
    const record = unwrap(findingPacketEvidence({ branch: "started-here", docs: [row], journals }));
    expect(record!.name).toBe("fleet-finding.json");
  });

  it("writes nothing for a similar branch, a row that is not a finding, or an empty board", () => {
    const similar = findingPacketEvidence({ branch: "a-finding-branch-2", docs: [FINDING], journals: NO_JOURNALS });
    const owners = findingPacketEvidence({
      branch: "a-finding-branch",
      docs: [{ ...FINDING, origin: undefined }],
      journals: NO_JOURNALS,
    });
    const empty = findingPacketEvidence({ branch: "a-finding-branch", docs: [], journals: NO_JOURNALS });
    expect([unwrap(similar), unwrap(owners), unwrap(empty)]).toStrictEqual([undefined, undefined, undefined]);
  });

  it("refuses a matched finding with no registered instant rather than inventing a day", () => {
    const failure = unwrapErr(
      findingPacketEvidence({
        branch: "a-finding-branch",
        docs: [{ ...FINDING, askedIso: undefined }],
        journals: NO_JOURNALS,
      }),
    );
    expect(failure.code).toBe("PREPARATION_FAILED");
    expect(failure.message).toContain("finding row a-finding-row carries no askedIso instant");
  });

  it("refuses a 31st of February the board's instant check admits, since no seen day could match it", () => {
    const askedIso = "2026-02-31T15:03:52.444Z";
    const failure = unwrapErr(
      findingPacketEvidence({ branch: "a-finding-branch", docs: [{ ...FINDING, askedIso }], journals: NO_JOURNALS }),
    );
    expect(Number.isNaN(Date.parse(askedIso))).toBe(false);
    expect(failure.code).toBe("PREPARATION_FAILED");
    expect(failure.message).toContain("whose day 2026-02-31 is not a real calendar day");
  });
});
