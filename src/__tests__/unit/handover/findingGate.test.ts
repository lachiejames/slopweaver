import { describe, expect, it } from "vitest";

import type { HandoverDoc } from "../../../handover/doc.js";
import { findingGateLines, findingGateVerdict, findingRowForBranch } from "../../../handover/findingGate.js";
import type { RunEvent } from "../../../handover/ledger.js";
import type { RulingEvidence } from "../../../handover/ruling.js";

/** A finding row nobody has ruled on — the state an acme-admin pull request went up in. */
const finding = (over: Partial<HandoverDoc> & { slug: string }): HandoverDoc => ({
  anchor: undefined,
  artifact: undefined,
  askedIso: "2026-09-02T06:14:01Z",
  baseBranch: undefined,
  blockedBy: [],
  branch: undefined,
  doneWhen: [],
  evidence: ["owner/repo#16360", "owner/repo#16384"],
  kind: "ask",
  notDoneReason: undefined,
  observedBy: "session-40",
  registeredBy: undefined,
  registeredRun: undefined,
  origin: "finding",
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
  supervisorState: undefined,
  summary: "watchPr.sh dies silent",
  ...over,
});

const NO_JOURNALS = new Map<string, readonly RunEvent[]>();

/** The journal of a run started on a branch, which is how a row claims one it never declared. */
const startedOn = ({ branch, slug }: { branch: string; slug: string }): Map<string, readonly RunEvent[]> =>
  new Map([[slug, [{ atIso: "2026-09-02T07:00:00.000Z", branch, docHash: "h", kind: "started" }]]]);

/** A ruling recorded because the owner ruled on the finding — the only kind that clears this gate. */
const LIVE_RULING: RunEvent = {
  anchor: "https://example.invalid/p9",
  atIso: "2026-09-10T00:00:00.000Z",
  decidedIso: "2026-09-10T00:00:00.000Z",
  kind: "ruling",
  ruling: "yes, raise it",
};

/** The answer a reconstruction is copied out of, and the reconstruction itself. */
const ANSWERED: RunEvent = { answer: "OWNER RULED: ship it", atIso: "2026-09-04T00:00:00.000Z", kind: "answered" };
const BACKFILLED_RULING: RunEvent = {
  anchor: "journal:runs/watchpr-dies.jsonl#2026-09-04T00:00:00.000Z",
  atIso: "2026-09-13T00:00:00.000Z",
  backfilledFrom: "2026-09-04T00:00:00.000Z",
  decidedIso: "2026-09-04T00:00:00.000Z",
  kind: "ruling",
  ruling: "OWNER RULED: ship it",
};

/** The evidence a `clear` verdict carries when the row's permission came from its front-matter. */
const AUTHORED: RulingEvidence = { anchor: "https://example.invalid/p9", from: "authored", words: "yes, raise it" };

describe("findingRowForBranch", () => {
  it("matches the slug itself, the default branch a spawn gives a run", () => {
    const row = finding({ slug: "watchpr-dies" });
    expect(findingRowForBranch({ branch: "watchpr-dies", docs: [row], journals: NO_JOURNALS })).toBe(row);
  });

  it("matches a declared branch that differs from the slug", () => {
    const row = finding({ branch: "fix/watchpr", slug: "watchpr-dies" });
    expect(findingRowForBranch({ branch: "fix/watchpr", docs: [row], journals: NO_JOURNALS })).toBe(row);
  });

  it("matches the branch the run journal recorded at start", () => {
    const row = finding({ slug: "watchpr-dies" });
    const journals = startedOn({ branch: "wt/watchpr", slug: "watchpr-dies" });
    expect(findingRowForBranch({ branch: "wt/watchpr", docs: [row], journals })).toBe(row);
  });

  it("never matches by resemblance — a branch that merely contains the slug is not the row's", () => {
    const row = finding({ slug: "watchpr-dies" });
    expect(findingRowForBranch({ branch: "watchpr-dies-v2", docs: [row], journals: NO_JOURNALS })).toBeUndefined();
  });

  it("ignores the owner's own asks entirely, whatever branch they name", () => {
    const own = finding({ evidence: [], observedBy: undefined, origin: undefined, slug: "own-ask" });
    expect(findingRowForBranch({ branch: "own-ask", docs: [own], journals: NO_JOURNALS })).toBeUndefined();
  });
});

describe("findingGateVerdict", () => {
  it("is clear with no row when no finding claims the branch", () => {
    expect(findingGateVerdict({ branch: "feature", docs: [], journals: NO_JOURNALS })).toEqual({
      kind: "clear",
      row: undefined,
      ruling: undefined,
    });
  });

  it("is unruled for a finding the owner has not spoken on", () => {
    const row = finding({ slug: "watchpr-dies" });
    expect(findingGateVerdict({ branch: "watchpr-dies", docs: [row], journals: NO_JOURNALS })).toEqual({
      kind: "unruled",
      row,
    });
  });

  it("is clear once the owner's ruling and its anchor are on the row", () => {
    const row = finding({ ruling: "yes, raise it", rulingAnchor: "https://example.invalid/p9", slug: "watchpr-dies" });
    expect(findingGateVerdict({ branch: "watchpr-dies", docs: [row], journals: NO_JOURNALS })).toEqual({
      kind: "clear",
      row,
      ruling: AUTHORED,
    });
  });

  it("is clear on a ruling recorded as an EVENT, carrying that event as the permit", () => {
    const row = finding({ slug: "watchpr-dies" });
    const journals = new Map<string, readonly RunEvent[]>([["watchpr-dies", [LIVE_RULING]]]);
    expect(findingGateVerdict({ branch: "watchpr-dies", docs: [row], journals })).toEqual({
      kind: "clear",
      row,
      ruling: { decidedIso: "2026-09-10T00:00:00.000Z", event: LIVE_RULING, from: "register" },
    });
  });

  it("stays UNRULED when the only ruling was reconstructed from an answer — history is not permission", () => {
    const row = finding({ slug: "watchpr-dies" });
    const journals = new Map<string, readonly RunEvent[]>([["watchpr-dies", [ANSWERED, BACKFILLED_RULING]]]);
    expect(findingGateVerdict({ branch: "watchpr-dies", docs: [row], journals })).toEqual({ kind: "unruled", row });
  });

  it("keeps a live permit that a later-appended backfill would otherwise have displaced", () => {
    const row = finding({ slug: "watchpr-dies" });
    const journals = new Map<string, readonly RunEvent[]>([
      ["watchpr-dies", [ANSWERED, LIVE_RULING, BACKFILLED_RULING]],
    ]);
    expect(findingGateVerdict({ branch: "watchpr-dies", docs: [row], journals })).toEqual({
      kind: "clear",
      row,
      ruling: { decidedIso: "2026-09-10T00:00:00.000Z", event: LIVE_RULING, from: "register" },
    });
  });

  it("is declined when the owner settled the row against it, even if a ruling was once recorded", () => {
    const row = finding({
      ruling: "yes",
      rulingAnchor: "https://example.invalid/p9",
      settlement: "declined",
      settlementReason: "no memory of asking",
      settlementWitness: "https://example.invalid/pr/16658",
      slug: "watchpr-dies",
    });
    expect(findingGateVerdict({ branch: "watchpr-dies", docs: [row], journals: NO_JOURNALS })).toEqual({
      kind: "declined",
      row,
    });
  });
});

describe("findingGateLines", () => {
  it("prints nothing and does not refuse for a branch no finding claims", () => {
    expect(
      findingGateLines({
        action: "open a pull request on staging",
        verdict: { kind: "clear", row: undefined, ruling: undefined },
      }),
    ).toEqual({
      lines: [],
      refused: false,
    });
  });

  it("refuses an unruled finding, naming the row, its origin, and the verb that clears it", () => {
    const row = finding({ slug: "watchpr-dies" });
    const printed = findingGateLines({ action: "open a pull request on staging", verdict: { kind: "unruled", row } });

    expect(printed.refused).toBe(true);
    expect(printed.lines).toEqual([
      "refused: finding-unruled: cannot open a pull request on staging for watchpr-dies until the owner has ruled on it",
      "  the finding gate is the rule that a row a SESSION registered from what it observed, rather than " +
        "something the owner asked for, does not reach a teammate until the owner has seen it",
      "  watchpr-dies is a fleet finding, not something the owner asked for — observed by session-40 from owner/repo#16360, owner/repo#16384",
      "  a teammate must not receive work the owner has not seen — present the finding to the owner, then record their word:",
      '  slopweaver handover rule watchpr-dies --anchor <where the owner said it> --words "<the owner\'s words>"',
      '  or, if the owner says no: slopweaver handover settle watchpr-dies --as declined --witness <anchor> --reason "<the owner\'s words>"',
    ]);
  });

  // The reader decodes a quoted item's `\n`, and the origin line must stay one line.
  it("prints a multi-line evidence item and observer on the origin's one line, so neither can pose as a line of its own", () => {
    const row = finding({ evidence: ["legit\nFORGED ROW"], observedBy: "session-40\nFORGED", slug: "watchpr-dies" });
    const printed = findingGateLines({ action: "open a pull request on staging", verdict: { kind: "unruled", row } });

    expect(printed.lines[2]).toBe(
      "  watchpr-dies is a fleet finding, not something the owner asked for — observed by session-40 FORGED from legit FORGED ROW",
    );
    expect(printed.lines.every((line) => !line.includes("\n"))).toBe(true);
  });

  it("refuses a declined finding with their own reason on the line", () => {
    const row = finding({
      settlement: "declined",
      settlementReason: "no memory of asking",
      settlementWitness: "https://example.invalid/pr/16658",
      slug: "watchpr-dies",
    });
    const printed = findingGateLines({ action: "ask a teammate to review #7", verdict: { kind: "declined", row } });

    expect(printed.refused).toBe(true);
    expect(printed.lines[0]).toBe("refused: finding-declined: cannot ask a teammate to review #7 for watchpr-dies");
    expect(printed.lines[3]).toBe(
      "  the owner settled it declined: no memory of asking (https://example.invalid/pr/16658)",
    );
  });

  it("says a ruled finding is proceeding, with the anchor, so the permit is visible in the log", () => {
    const row = finding({ ruling: "yes", rulingAnchor: "https://example.invalid/p9", slug: "watchpr-dies" });
    expect(
      findingGateLines({
        action: "open a pull request on staging",
        verdict: { kind: "clear", row, ruling: AUTHORED },
      }),
    ).toEqual({
      lines: ["finding gate: watchpr-dies carries the owner's ruling (https://example.invalid/p9) — proceeding"],
      refused: false,
    });
  });
});

describe("an INTERNAL door", () => {
  const docs = [finding({ slug: "watchpr-dies" })];

  it("hands an unruled finding to the session's judgement instead of holding it", () => {
    const verdict = findingGateVerdict({ branch: "watchpr-dies", docs, internal: true, journals: NO_JOURNALS });

    expect(verdict.kind).toBe("internal");
  });

  it("still holds the same row on a team-facing door, which is the whole asymmetry", () => {
    const verdict = findingGateVerdict({ branch: "watchpr-dies", docs, internal: false, journals: NO_JOURNALS });

    expect(verdict.kind).toBe("unruled");
  });

  it("defaults to the team-facing answer, so a caller that never thought about it is safe", () => {
    const verdict = findingGateVerdict({ branch: "watchpr-dies", docs, journals: NO_JOURNALS });

    expect(verdict.kind).toBe("unruled");
  });

  it("refuses a DECLINED row on an internal door too — a no is not a silence", () => {
    const declined = [finding({ settlement: "declined", slug: "watchpr-dies" })];
    const verdict = findingGateVerdict({
      branch: "watchpr-dies",
      docs: declined,
      internal: true,
      journals: NO_JOURNALS,
    });

    expect(verdict.kind).toBe("declined");
  });

  it("leaves a RULED row clear on an internal door, naming the owner's ruling as before", () => {
    const ruled = [finding({ ruling: "yes", rulingAnchor: "transcript:abc", slug: "watchpr-dies" })];
    const verdict = findingGateVerdict({
      branch: "watchpr-dies",
      docs: ruled,
      internal: true,
      journals: NO_JOURNALS,
    });

    expect(verdict.kind).toBe("clear");
  });

  it("prints what it is doing and does NOT refuse", () => {
    const verdict = findingGateVerdict({ branch: "watchpr-dies", docs, internal: true, journals: NO_JOURNALS });
    const printed = findingGateLines({ action: "open a pull request on main", verdict });

    expect(printed.refused).toBe(false);
    expect(printed.lines).toEqual([
      "finding gate: watchpr-dies is an unruled fleet finding, and this door reaches nobody but the owner —",
      "  proceeding on this session's judgement under rule 10, recorded in the autonomy ledger",
      "  watchpr-dies is a fleet finding, not something the owner asked for — observed by session-40 from " +
        "owner/repo#16360, owner/repo#16384",
    ]);
  });
});

describe("every refusal says what a finding gate IS", () => {
  it("names it on an unruled refusal", () => {
    const verdict = findingGateVerdict({
      branch: "watchpr-dies",
      docs: [finding({ slug: "watchpr-dies" })],
      journals: NO_JOURNALS,
    });

    expect(findingGateLines({ action: "x", verdict }).lines[1]).toBe(
      "  the finding gate is the rule that a row a SESSION registered from what it observed, rather than " +
        "something the owner asked for, does not reach a teammate until the owner has seen it",
    );
  });

  it("names it on a declined refusal too", () => {
    const verdict = findingGateVerdict({
      branch: "watchpr-dies",
      docs: [finding({ settlement: "declined", slug: "watchpr-dies" })],
      journals: NO_JOURNALS,
    });

    expect(findingGateLines({ action: "x", verdict }).lines[1]).toBe(
      "  the finding gate is the rule that a row a SESSION registered from what it observed, rather than " +
        "something the owner asked for, does not reach a teammate until the owner has seen it",
    );
  });
});
