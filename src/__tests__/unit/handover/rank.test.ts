import { describe, expect, it } from "vitest";

import type { BoardSection } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { boardQueueFacts } from "../../../handover/queueFacts.js";
import { type BoardRow, isOwnerPrHygieneRow, rankOf, rankRows, rowOfDoc, rowOfTag } from "../../../handover/rank.js";
import { registrationSlug } from "../../../review/boardAtHead.js";

const NOW = "2026-08-31T12:10:00Z";

const doc = (over: Partial<HandoverDoc> & { slug: string }): HandoverDoc => ({
  anchor: undefined,
  artifact: undefined,
  askedIso: undefined,
  baseBranch: undefined,
  blockedBy: [],
  branch: undefined,
  doneWhen: [],
  kind: "doc",
  notDoneReason: undefined,
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
  settlement: undefined,
  settlementReason: undefined,
  settlementWitness: undefined,
  origin: undefined,
  observedBy: undefined,
  registeredBy: undefined,
  registeredRun: undefined,
  evidence: [],
  ruling: undefined,
  rulingAnchor: undefined,
  hisWords: { kind: "absent" },
  hisWordsSteers: [],
  status: "ready",
  statusSummary: undefined,
  supervisorState: undefined,
  summary: undefined,
  ...over,
});

describe("rowOfDoc", () => {
  it("gives an ordinary doc the doc band and no waiting time", () => {
    const row = rowOfDoc({ doc: doc({ slug: "refactor" }), nowIso: NOW, ruled: false, standing: "ready" });

    expect(row.kind).toBe("doc");
    expect(row.priority).toBe("p2");
    expect(row.waitingHours).toBe(0);
    expect(row.groomed).toBe(false);
  });

  it("counts an ask's wait from the moment the owner said it", () => {
    const row = rowOfDoc({
      doc: doc({ askedIso: "2026-08-30T23:08:43Z", kind: "ask", slug: "stuck-chats" }),
      nowIso: NOW,
      ruled: false,
      standing: "ready",
    });

    expect(row.priority).toBe("p1");
    expect(row.waitingHours).toBe(13);
    expect(row.groomed).toBe(true);
  });

  it("carries the readiness its caller resolved from the board's composed section", () => {
    const inFlight = rowOfDoc({ doc: doc({ slug: "in-flight" }), nowIso: NOW, ruled: false, standing: "in-flight" });
    expect(inFlight.ready).toBe(false);
    expect(rowOfDoc({ doc: doc({ slug: "run-now" }), nowIso: NOW, ruled: false, standing: "ready" }).ready).toBe(true);
  });

  it("carries the ruling its caller read off the journal, and never treats it as placing the row", () => {
    const row = rowOfDoc({ doc: doc({ slug: "ruled" }), nowIso: NOW, ruled: true, standing: "ready" });

    expect([row.ruled, row.groomed]).toEqual([true, false]);
  });

  it("treats a declared priority as having placed the row", () => {
    const row = rowOfDoc({
      doc: doc({ priority: "p0", slug: "urgent" }),
      nowIso: NOW,
      ruled: false,
      standing: "ready",
    });

    expect(row.priority).toBe("p0");
    expect(row.groomed).toBe(true);
  });

  it("falls back to the slug when a row states no summary", () => {
    const row = rowOfDoc({ doc: doc({ slug: "unnamed" }), nowIso: NOW, ruled: false, standing: "ready" });
    expect(row.label).toBe("unnamed");
  });

  it("reads zero hours from an unparseable askedIso rather than a negative or NaN one", () => {
    const row = rowOfDoc({
      doc: doc({ askedIso: "yesterday", kind: "ask", slug: "bad" }),
      nowIso: NOW,
      ruled: false,
      standing: "in-flight",
    });

    expect(row.waitingHours).toBe(0);
  });
});

describe("rowOfTag", () => {
  it("puts an active Slack tag in the top band without anyone declaring it", () => {
    const row = rowOfTag({
      nowIso: NOW,
      tag: { capturedIso: "2026-08-31T10:10:00Z", id: "C1/1.0", state: "dispatched", userId: "U1" },
    });

    expect(row.priority).toBe("p0");
    expect(row.kind).toBe("tag");
    expect(row.waitingHours).toBe(2);
    expect(row.label).toBe("Slack tag from U1 (dispatched)");
  });

  it("is always ready, because a projected tag is somebody waiting in a thread right now", () => {
    const row = rowOfTag({
      nowIso: NOW,
      tag: { capturedIso: "2026-08-31T10:10:00Z", id: "C1/1.0", state: "dispatched", userId: "U1" },
    });

    expect(row.ready).toBe(true);
  });

  it("is never ruled, since no ruling can reach a projected tag", () => {
    const row = rowOfTag({
      nowIso: NOW,
      tag: { capturedIso: "2026-08-31T10:10:00Z", id: "C1/1.0", state: "dispatched", userId: "U1" },
    });

    expect(row.ruled).toBe(false);
  });

  it("is ungroomed when the stream carried no capture instant", () => {
    const row = rowOfTag({
      nowIso: NOW,
      tag: { capturedIso: undefined, id: "C1/2.0", state: "captured", userId: "U1" },
    });

    expect(row.groomed).toBe(false);
  });
});

const row = (over: Partial<BoardRow> & { id: string }): BoardRow => ({
  groomed: true,
  kind: "doc",
  label: over.id,
  openedIso: undefined,
  priority: "p2",
  ready: true,
  ruled: false,
  standing: "ready",
  waitingHours: 0,
  ...over,
});

describe("rankRows", () => {
  it("orders by band first, so a tag outranks an ask outranks a doc", () => {
    const ranked = rankRows({
      rows: [row({ id: "d", priority: "p2" }), row({ id: "t", priority: "p0" }), row({ id: "a", priority: "p1" })],
    });

    expect(ranked.map((entry) => entry.id)).toEqual(["t", "a", "d"]);
  });

  it("puts a placed row ahead of an unplaced one in the same band", () => {
    const ranked = rankRows({ rows: [row({ groomed: false, id: "aaa" }), row({ groomed: true, id: "zzz" })] });

    expect(ranked.map((entry) => entry.id)).toEqual(["zzz", "aaa"]);
  });

  it("puts the longest wait first within a band", () => {
    const ranked = rankRows({
      rows: [row({ id: "new", waitingHours: 1 }), row({ id: "old", waitingHours: 13 })],
    });

    expect(ranked.map((entry) => entry.id)).toEqual(["old", "new"]);
  });

  it("breaks a total tie by id, so the order is reproducible", () => {
    const ranked = rankRows({ rows: [row({ id: "b" }), row({ id: "a" })] });

    expect(ranked.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("returns an empty list unchanged", () => {
    expect(rankRows({ rows: [] })).toEqual([]);
  });
});

describe("rankRows — the owner's landing work first within p1", () => {
  /** A landing registration's slug, exactly as `registrationSlug` writes it. */
  const LAND_A = registrationSlug({
    row: { headOid: "4d43359aaaa", number: 16339, repoSlug: "acme/acme-admin" },
  });
  const LAND_B = registrationSlug({
    row: { headOid: "b7a8ba3bbbb", number: 1328, repoSlug: "lachiejames/slopweaver" },
  });

  /** A default-band ask, the shape `handover register --ask` files. */
  const ask = (over: Partial<BoardRow> & { id: string }): BoardRow => row({ kind: "ask", priority: "p1", ...over });

  it("keeps every p0 tag ahead of a p1 landing row", () => {
    const ranked = rankRows({
      rows: [ask({ id: LAND_A, waitingHours: 900 }), row({ id: "C0/1.0", kind: "tag", priority: "p0" })],
    });

    expect(ranked.map((entry) => entry.id)).toEqual(["C0/1.0", LAND_A]);
  });

  it("puts a landing row ahead of an older ordinary p1 ask", () => {
    const ranked = rankRows({
      rows: [ask({ id: "stuck-chat", waitingHours: 40 }), ask({ id: LAND_A, waitingHours: 1 })],
    });

    expect(ranked.map((entry) => entry.id)).toEqual([LAND_A, "stuck-chat"]);
  });

  it("keeps age, then slug, between two landing rows", () => {
    const ranked = rankRows({
      rows: [ask({ id: LAND_A, waitingHours: 2 }), ask({ id: LAND_B, waitingHours: 9 }), ask({ id: "zzz-ask" })],
    });

    expect(ranked.map((entry) => entry.id)).toEqual([LAND_B, LAND_A, "zzz-ask"]);
  });

  it("leaves p2 below p1 and ranks a landing slug on a doc row as an ordinary doc", () => {
    const ranked = rankRows({
      rows: [row({ id: LAND_A, waitingHours: 50 }), ask({ id: "an-ask" }), row({ id: "a-doc", waitingHours: 60 })],
    });

    expect(ranked.map((entry) => entry.id)).toEqual(["an-ask", "a-doc", LAND_A]);
  });

  it("does not lift a hand-filed narrower row that only shares the prefix", () => {
    const narrower = `${LAND_A}-cr`;
    const ranked = rankRows({ rows: [ask({ id: narrower }), ask({ id: "older", waitingHours: 5 })] });

    expect(isOwnerPrHygieneRow({ row: ask({ id: narrower }) })).toBe(false);
    expect(ranked.map((entry) => entry.id)).toEqual(["older", narrower]);
  });

  it("does not lift a landing row whose author declared another band", () => {
    expect(isOwnerPrHygieneRow({ row: ask({ id: LAND_A, priority: "p0" }) })).toBe(false);
    expect(isOwnerPrHygieneRow({ row: ask({ id: LAND_A }) })).toBe(true);
  });
});

describe("rankRows — a row the owner ruled on, ahead of age, inside its band", () => {
  /** A default-band ask, the shape `handover register --ask` files. */
  const ask = (over: Partial<BoardRow> & { id: string }): BoardRow => row({ kind: "ask", priority: "p1", ...over });

  it("puts a ruled row ahead of an unruled one that is groomed and has waited longer", () => {
    const ranked = rankRows({
      rows: [ask({ id: "finding", waitingHours: 900 }), ask({ groomed: false, id: "owner-ruling", ruled: true })],
    });

    expect(ranked.map((entry) => entry.id)).toEqual(["owner-ruling", "finding"]);
  });

  it("never lifts a ruled row across a band the owner set", () => {
    const ranked = rankRows({ rows: [ask({ id: "parked", priority: "p3", ruled: true }), ask({ id: "p1-ask" })] });

    expect(ranked.map((entry) => entry.id)).toEqual(["p1-ask", "parked"]);
  });

  it("keeps the owner's landing row ahead of a ruled p1 ask", () => {
    const land = registrationSlug({
      row: { headOid: "4d43359aaaa", number: 16339, repoSlug: "acme/acme-admin" },
    });
    const ranked = rankRows({ rows: [ask({ id: "owner-ruling", ruled: true, waitingHours: 50 }), ask({ id: land })] });

    expect(ranked.map((entry) => entry.id)).toEqual([land, "owner-ruling"]);
  });

  it("orders two ruled rows by grooming, then age, then id", () => {
    const ranked = rankRows({
      rows: [
        ask({ groomed: false, id: "a-unplaced", ruled: true, waitingHours: 99 }),
        ask({ id: "c-new", ruled: true, waitingHours: 1 }),
        ask({ id: "b-tie", ruled: true, waitingHours: 1 }),
        ask({ id: "d-old", ruled: true, waitingHours: 40 }),
      ],
    });

    expect(ranked.map((entry) => entry.id)).toEqual(["d-old", "b-tie", "c-new", "a-unplaced"]);
  });
});

describe("boardQueueFacts and rankRows — the one order (P0)", () => {
  /**
   * One composed row, its tags declared and read whole unless said otherwise.
   *
   * @returns the model the facts read
   */
  const model = ({
    slug,
    tags = [],
    blockedBy = [],
    section = "WAITING ON OWNER",
    tagsIncomplete = false,
  }: {
    slug: string;
    tags?: readonly (readonly [string, string])[];
    blockedBy?: readonly string[];
    section?: BoardSection;
    tagsIncomplete?: boolean;
  }) => ({
    doc: doc({ blockedBy, slug }),
    section,
    tags: {
      tags: tags.map(([key, value]) => ({ key, source: "declared" as const, value })),
      unrecognised: [],
    },
    tagsIncomplete,
  });
  const PRIORITIES = ["onboarding-flow", "iso-certification"];
  const vanta = ({ slug, controls }: { slug: string; controls?: string }) =>
    model({
      slug,
      tags: [
        ["workstream", "iso-certification"],
        ["priority", "p1"],
        ...(controls === undefined ? [] : [["controls-resolved", controls] as const]),
      ],
    });
  const MODELS = [
    model({ slug: "stale-p1" }),
    vanta({ controls: "3", slug: "vanta-3" }),
    vanta({ slug: "vanta-uncounted" }),
    model({ slug: "nag-proposal", tags: [["workstream", "onboarding-flow"]] }),
    vanta({ controls: "8", slug: "vanta-8" }),
    model({ blockedBy: ["blocks-vanta"], slug: "vanta-held", tags: [["workstream", "iso-certification"]] }),
    model({ slug: "blocks-vanta" }),
    model({ blockedBy: ["blocks-nag"], slug: "nag-held", tags: [["workstream", "onboarding-flow"]] }),
    model({ slug: "blocks-nag" }),
    model({ slug: "done-vanta", section: "DONE", tags: [["workstream", "iso-certification"]] }),
  ];

  const NONE_DEFERRED: ReadonlySet<string> = new Set();

  it("reads a blocker by the highest priority it blocks, and a priority row by rank, band and count", () => {
    const facts = boardQueueFacts({ deferred: NONE_DEFERRED, models: MODELS, priorities: PRIORITIES });
    expect([
      facts.get("blocks-nag"),
      facts.get("blocks-vanta"),
      facts.get("vanta-8"),
      facts.get("vanta-uncounted"),
      facts.get("stale-p1"),
      facts.get("done-vanta"),
    ]).toEqual([
      { band: "blocker", priorityRank: 0 },
      { band: "blocker", priorityRank: 1 },
      { band: "priority", boardBand: 1, controlsResolved: 8, priorityRank: 1 },
      { band: "priority", boardBand: 1, priorityRank: 1 },
      undefined,
      undefined,
    ]);
  });

  it("names no priority for a row whose tags did not read whole, so it blocks nothing either", () => {
    const facts = boardQueueFacts({
      deferred: NONE_DEFERRED,
      models: [
        { ...model({ blockedBy: ["b"], slug: "a", tags: [["workstream", "onboarding-flow"]] }), tagsIncomplete: true },
      ],
      priorities: PRIORITIES,
    });
    expect([...facts]).toEqual([]);
  });

  it("ranks the board by the facts: blockers, then the nag proposal, then Vanta by controls, then the rest", () => {
    const facts = boardQueueFacts({ deferred: NONE_DEFERRED, models: MODELS, priorities: PRIORITIES });
    const rows = MODELS.filter((one) => one.section !== "DONE").map((one) => row({ id: one.doc.slug }));
    expect(rankRows({ facts, rows }).map((entry) => entry.id)).toEqual([
      "blocks-nag",
      "blocks-vanta",
      "nag-held",
      "nag-proposal",
      "vanta-8",
      "vanta-3",
      "vanta-uncounted",
      "vanta-held",
      "stale-p1",
    ]);
  });

  it("keeps the board's own order with no priorities", () => {
    const rows = [row({ id: "b", priority: "p1" }), row({ id: "a", priority: "p2" })];
    const facts = boardQueueFacts({ deferred: NONE_DEFERRED, models: MODELS, priorities: [] });
    expect(rankRows({ facts, rows }).map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("ranks a priority card the owner put off with the rest, as the Queue draws it, while a blocker they put off stays one", () => {
    const facts = boardQueueFacts({
      deferred: new Set(["vanta-8", "blocks-nag"]),
      models: MODELS,
      priorities: PRIORITIES,
    });
    expect([facts.get("vanta-8"), facts.get("blocks-nag"), facts.get("vanta-3")]).toEqual([
      undefined,
      { band: "blocker", priorityRank: 0 },
      { band: "priority", boardBand: 1, controlsResolved: 3, priorityRank: 1 },
    ]);
  });

  it("ranks a row the owner put off last, earliest put off first, while a blocker they put off keeps its place", () => {
    // The counterexample: a p0 priority ask the owner put off, beside a p3 ask they did not. The Queue draws it last.
    const deferred = new Map([
      ["vanta-8", "2026-10-19T10:00:00.000Z"],
      ["stale-p1", "2026-10-19T09:00:00.000Z"],
      ["blocks-nag", "2026-10-19T08:00:00.000Z"],
    ]);
    const facts = boardQueueFacts({ deferred: new Set(deferred.keys()), models: MODELS, priorities: PRIORITIES });
    const rows = [
      row({ id: "vanta-8", priority: "p0" }),
      row({ id: "stale-p1", priority: "p1" }),
      row({ id: "blocks-nag", priority: "p2" }),
      row({ id: "unranked", priority: "p3" }),
    ];
    expect(rankRows({ deferred, facts, rows }).map((entry) => entry.id)).toEqual([
      "blocks-nag",
      "unranked",
      "stale-p1",
      "vanta-8",
    ]);
  });
});

describe("rankOf", () => {
  it("is 1-based", () => {
    const ranked = [row({ id: "a" }), row({ id: "b" })];

    expect(rankOf({ id: "b", ranked })).toBe(2);
  });

  it("is undefined for a row the list does not hold", () => {
    expect(rankOf({ id: "missing", ranked: [row({ id: "a" })] })).toBeUndefined();
  });
});
