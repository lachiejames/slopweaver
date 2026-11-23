import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import type { Opportunity } from "../../../silver/opportunity.js";
import { scanOpportunities } from "../../../silver/opportunityScan.js";

const T = "2024-06-01T00:00:00Z";
const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "t",
  tsIso: T,
  url: "u",
  ...over,
});

describe("scanOpportunities", () => {
  it("flags a cross-cutting CONCRETE reference spanning ≥3 containers", () => {
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [
        rec({ container: "c1", refs: ["TEAM-1"], sourceId: "#1" }),
        rec({ container: "c2", refs: ["TEAM-1"], sourceId: "#2" }),
        rec({ container: "c3", refs: ["TEAM-1"], sourceId: "#3" }),
      ],
    });
    const crossCut = opportunities.find((o) => o.kind === "cross-cutting" && o.subject === "TEAM-1")!;
    expect(crossCut.summary).toBe("TEAM-1 is referenced across 3 distinct containers");
    expect(crossCut.evidenceCount).toBe(1);
  });

  it("flags a referenced, unresolved, TITLED item as a blocker", () => {
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [
        rec({ container: "c1", sourceId: "#10", text: "this is blocked on review", title: "Payment retry" }),
        rec({ container: "c2", refs: ["#10"], sourceId: "#11" }),
      ],
    });
    const blocker = opportunities.find((o) => o.kind === "blocker")!;
    expect(blocker.subject).toBe("#10");
    expect(blocker.summary).toBe('#10 ("Payment retry") is referenced and reads unresolved across 1 container(s)');
  });

  it("does not flag duplication within a single source", () => {
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [
        rec({ sourceId: "#1", title: "Fix the login flow" }),
        rec({ sourceId: "#2", title: "Fix the login flow" }),
      ],
    });
    expect(opportunities.filter((o) => o.kind === "duplication")).toEqual([]);
  });

  it("does not flag a pre-window record stale merely because it predates the corpus window", () => {
    // An old-but-valid target, cited only by another OLD record — no recent citer, so not a live blocker.
    // A fresh unrelated record sets the corpus-newest baseline (so the old ones read as far in the past).
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [
        rec({
          container: "c1",
          sourceId: "#old",
          text: "done and shipped",
          title: "Old but done",
          tsIso: "2024-01-01T00:00:00Z",
        }),
        rec({ container: "c2", refs: ["#old"], sourceId: "#alsoOld", tsIso: "2024-01-02T00:00:00Z" }),
        rec({ container: "c3", sourceId: "#fresh", tsIso: "2026-06-01T00:00:00Z" }),
      ],
    });
    expect(opportunities.filter((o) => o.kind === "blocker")).toEqual([]);
  });

  it("flags a stale target only when a RECENT record still cites it (someone is waiting)", () => {
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [
        rec({
          container: "c1",
          sourceId: "#old",
          text: "done and shipped",
          title: "Stale target",
          tsIso: "2024-01-01T00:00:00Z",
        }),
        rec({ container: "c2", refs: ["#old"], sourceId: "#recent", tsIso: "2026-06-01T00:00:00Z" }),
      ],
    });
    expect(opportunities.filter((o) => o.kind === "blocker").map((o) => o.subject)).toEqual(["#old"]);
  });

  it("does not flag a FRESH target stale even when cited by an old record", () => {
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [
        rec({
          container: "c1",
          sourceId: "#fresh",
          text: "current doc",
          title: "Fresh doc",
          tsIso: "2026-06-10T00:00:00Z",
        }),
        rec({ container: "c2", refs: ["#fresh"], sourceId: "#oldCiter", tsIso: "2024-01-01T00:00:00Z" }),
      ],
    });
    expect(opportunities.filter((o) => o.kind === "blocker")).toEqual([]);
  });
});

describe("scanOpportunities — PR4.8 precision pass", () => {
  /** A wide clique over one token: `containers` records, each in its own container, all referencing it. */
  const clique = ({ token, containers }: { token: string; containers: number }): readonly CorpusRecord[] =>
    Array.from({ length: containers }, (_unused, i) =>
      rec({ container: `c${String(i)}`, refs: [token], sourceId: `#${String(i)}`, url: `u${String(i)}` }),
    );

  it("ranks a crisp CONCRETE cross-ref ABOVE a wide concrete mega-clique (exact scores)", () => {
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [...clique({ containers: 3, token: "TEAM-1" }), ...clique({ containers: 30, token: "TEAM-2" })],
    });
    const crossCut = opportunities.filter((o) => o.kind === "cross-cutting");
    expect(crossCut.map((o) => o.subject)).toEqual(["TEAM-1", "TEAM-2"]);
    expect(crossCut[0]!.score).toBe(2);
    expect(crossCut[1]!.score).toBe(0.3303);
  });

  it("drops a generic-handle mega-clique entirely and counts it as a generic-token drop", () => {
    const { opportunities, drops } = scanOpportunities({
      edges: [],
      records: [...clique({ containers: 35, token: "@gmail" }), ...clique({ containers: 3, token: "TEAM-1" })],
    });
    expect(opportunities.filter((o) => o.kind === "cross-cutting").map((o) => o.subject)).toEqual(["TEAM-1"]);
    expect(drops.genericToken).toBe(1);
    expect(drops.mentionOnly).toBe(0);
  });

  it("drops a bare @mention clique — a shared person is not a shared artifact", () => {
    const { opportunities, drops } = scanOpportunities({
      edges: [],
      records: clique({ containers: 8, token: "@octo-dev" }),
    });
    expect(opportunities.filter((o) => o.kind === "cross-cutting")).toEqual([]);
    expect(drops.mentionOnly).toBe(1);
  });

  it("drops a cited but TITLE-LESS blocker target as noise, and counts it", () => {
    const { opportunities, drops } = scanOpportunities({
      edges: [],
      records: [
        rec({ container: "c1", sourceId: "1712345678.001", text: "this is blocked on review" }),
        rec({ container: "c2", refs: ["1712345678.001"], sourceId: "#11" }),
      ],
    });
    expect(opportunities.filter((o) => o.kind === "blocker")).toEqual([]);
    expect(drops.untitledTarget).toBe(1);
  });

  it("no longer flags a blocker on a bare substring match (`reopened` is not `open`)", () => {
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [
        rec({ container: "c1", sourceId: "#20", text: "reopened after the release", title: "Reopened item" }),
        rec({ container: "c2", refs: ["#20"], sourceId: "#21" }),
      ],
    });
    expect(opportunities.filter((o) => o.kind === "blocker")).toEqual([]);
  });

  it("caps emitted evidence at 12 while `evidenceCount` keeps the true total", () => {
    const { opportunities, drops } = scanOpportunities({
      edges: [],
      records: clique({ containers: 30, token: "TEAM-9" }),
    });
    const crossCut = opportunities.find((o) => o.subject === "TEAM-9")!;
    expect(crossCut.evidence.length).toBe(12);
    expect(crossCut.evidenceCount).toBe(30);
    expect(drops.cappedEvidence).toBe(1);
  });

  it("emits ONE blocker per subject, keeping the widest-breadth instance, and counts the duplicate", () => {
    const { opportunities, drops } = scanOpportunities({
      edges: [],
      records: [
        rec({ container: "c1", sourceId: "#30", text: "blocked on review", title: "Same item", url: "u1" }),
        rec({ container: "c2", sourceId: "#30", text: "blocked on review", title: "Same item", url: "u2" }),
        rec({ container: "c3", refs: ["#30"], sourceId: "#31" }),
        rec({ container: "c4", refs: ["#30"], sourceId: "#32" }),
      ],
    });
    const blockers = opportunities.filter((o) => o.kind === "blocker");
    expect(blockers.map((o) => o.subject)).toEqual(["#30"]);
    expect(blockers[0]!.score).toBe(2);
    expect(drops.duplicateSubject).toBe(1);
  });

  it("breaks a blocker dedupe TIE on content, not scan order (the corpus walk is unsorted)", () => {
    const first = rec({ container: "c1", sourceId: "#40", text: "blocked on review", title: "Aaa", url: "u1" });
    const second = rec({ container: "c1", sourceId: "#40", text: "blocked on review", title: "Bbb", url: "u2" });
    const citer = rec({ container: "c2", refs: ["#40"], sourceId: "#41" });
    const forward = scanOpportunities({ edges: [], records: [first, second, citer] });
    const reversed = scanOpportunities({ edges: [], records: [second, first, citer] });
    const pick = ({ opportunities }: { opportunities: readonly Opportunity[] }): string =>
      opportunities.find((o) => o.kind === "blocker")!.summary;
    expect(pick(forward)).toBe(pick(reversed));
    expect(pick(forward)).toContain('("Aaa")');
  });

  it("drops a cross-source duplication whose shared title is too short to be a real match", () => {
    const { opportunities, drops } = scanOpportunities({
      edges: [],
      records: [
        rec({ source: "github", sourceId: "#1", title: "Sync" }),
        rec({ source: "linear", sourceId: "L-1", title: "Sync" }),
      ],
    });
    expect(opportunities.filter((o) => o.kind === "duplication")).toEqual([]);
    expect(drops.shortTitle).toBe(1);
  });

  it("keeps a cross-source duplication with a substantial shared title", () => {
    const { opportunities, drops } = scanOpportunities({
      edges: [],
      records: [
        rec({ source: "github", sourceId: "#1", title: "Payment retry backoff" }),
        rec({ source: "linear", sourceId: "L-1", title: "Payment retry backoff" }),
      ],
    });
    const dup = opportunities.find((o) => o.kind === "duplication")!;
    expect(dup.subject).toBe("Payment retry backoff");
    expect(dup.evidenceCount).toBe(1);
    expect(drops.shortTitle).toBe(0);
  });

  it("names a duplication by the FIRST record's spelling of the shared title", () => {
    const { opportunities } = scanOpportunities({
      edges: [],
      records: [
        rec({ source: "github", sourceId: "#1", title: "payment-retry backoff", url: "g1" }),
        rec({ source: "linear", sourceId: "L-1", title: "Payment Retry Backoff", url: "l1" }),
      ],
    });
    const dup = opportunities.find((o) => o.kind === "duplication")!;
    expect(dup.subject).toBe("payment-retry backoff");
    expect(dup.evidence).toEqual(["g1", "l1"]);
  });
});
