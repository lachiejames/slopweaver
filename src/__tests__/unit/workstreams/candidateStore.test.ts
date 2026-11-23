import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import type { CandidateCatalog } from "../../../workstreams/candidateCatalog.js";
import { CandidatesErrors } from "../../../workstreams/candidateErrors.js";
import {
  readCandidateCatalog,
  readDefinitionRows,
  readReactionRows,
  writeCandidates,
} from "../../../workstreams/candidateStore.js";
import { recordDefinition } from "../../../workstreams/definitionStore.js";
import { recordReactions } from "../../../workstreams/reactionStore.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { isEmptyRegister } from "../../../workstreams/store/register.js";
import type { StoredWorkstream, WorkstreamRegisterSnapshot } from "../../../workstreams/store/types.js";
import { SYNTHETIC_STATED, writeStatedCandidatesFile } from "../../statedCandidatesFixture.js";
import { inMemoryWorkstreamStore } from "../../workstreamStoreFake.js";

import { validCandidates } from "./candidatesFixture.js";
import { registerWorkstreams } from "./registerWorkstreamsFixture.js";
import { countingMintId, failingStore, seededStore } from "./storeRegisterFixture.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

const NOW = "2026-10-02T13:30:00.000Z";

/** A throwaway home the store may write into — never the ambient home. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-ws-store-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** Write the fixture's mined candidates under `home`, and read back the one catalog every verb reads. */
function seeded({ home }: { home: string }): CandidateCatalog {
  unwrap(writeCandidates({ home, value: validCandidates() }));
  return unwrap(readCandidateCatalog({ home }));
}

describe("readCandidateCatalog", () => {
  it("reads a home with neither a stated nor a mined file as an empty catalog, with no mine to name", () => {
    const catalog = unwrap(readCandidateCatalog({ home: scratch() }));
    expect([catalog.candidates, catalog.mined, catalog.channels]).toEqual([[], null, {}]);
  });

  it("reads a home with no mined file as the stated outcomes alone, with no mine to name", () => {
    const home = scratch();
    writeStatedCandidatesFile({ home });
    const catalog = unwrap(readCandidateCatalog({ home }));
    expect(catalog.candidates.map((one) => one.id)).toEqual(SYNTHETIC_STATED.map((one) => one.id));
    expect([catalog.mined, catalog.channels]).toEqual([null, {}]);
  });

  it("refuses a stated file that will not validate, rather than drawing the mined candidates alone", () => {
    const home = scratch();
    unwrap(writeCandidates({ home, value: validCandidates() }));
    writeStatedCandidatesFile({ home, document: { candidates: [], formerNames: {}, schemaVersion: 2 } });
    const refused = unwrapErr(readCandidateCatalog({ home }));
    expect([refused.code, refused.message]).toEqual([
      "CANDIDATES_INVALID",
      `the stated candidates in ${join(home, "workstreams", "stated-candidates.json")} do not validate — schemaVersion: Invalid input: expected 1`,
    ]);
  });

  it("reads the stated outcomes first, then exactly what writeCandidates stored", () => {
    const home = scratch();
    writeStatedCandidatesFile({ home });
    const written = unwrap(writeCandidates({ home, value: validCandidates() }));
    expect(written.path).toBe(join(home, "workstreams", "candidates.json"));
    const catalog = unwrap(readCandidateCatalog({ home }));
    expect(catalog.candidates).toEqual([...SYNTHETIC_STATED, ...written.file.candidates]);
    expect(catalog.mined).toEqual({
      minedFrom: written.file.minedFrom,
      minedIso: written.file.minedIso,
      minedSources: written.file.minedSources,
    });
    expect(catalog.channels).toEqual(written.file.channels);
  });

  it("refuses a mined file that will not parse, rather than drawing the stated outcomes alone", () => {
    const home = scratch();
    mkdirSync(join(home, "workstreams"), { recursive: true });
    writeFileSync(join(home, "workstreams", "candidates.json"), "{ not json");
    expect(unwrapErr(readCandidateCatalog({ home })).code).toBe("CANDIDATES_UNREADABLE");
  });

  it("refuses a mine that reuses a stated outcome's id, and writes nothing", () => {
    const home = scratch();
    writeStatedCandidatesFile({ home });
    const value = validCandidates();
    (value["candidates"] as { id: string }[])[0]!.id = SYNTHETIC_STATED[0]!.id;
    expect(unwrapErr(writeCandidates({ home, value })).code).toBe("CANDIDATES_INVALID");
    expect(unwrap(readCandidateCatalog({ home })).mined).toBe(null);
  });
});

describe("readReactionRows", () => {
  it("reads an absent ledger as no reactions yet", () => {
    expect(unwrap(readReactionRows({ home: scratch() }))).toEqual([]);
  });

  it("refuses a ledger with a malformed row rather than skipping it", () => {
    const home = scratch();
    mkdirSync(join(home, "workstreams"), { recursive: true });
    writeFileSync(join(home, "workstreams", "reactions.jsonl"), '{"candidate":"c-001"}\n');
    const refused = unwrapErr(readReactionRows({ home }));
    expect(refused.code).toBe("CANDIDATES_UNREADABLE");
    expect(refused.message).toContain("line 1: ");
  });
});

/** What every reaction in this file is asked with, but the picks, the words and where they came from. */
const BASE = { anchor: null, bySession: "test", heard: null, nowIso: NOW, reason: null, via: "console" } as const;

/** A store and the catalog a reaction is judged against, under one throwaway home. */
interface Seat {
  readonly catalog: CandidateCatalog;
  readonly home: string;
  /** One seam for every write this seat makes, so no two writes mint the same id, as `randomUUID` never does. */
  readonly mintId: () => string;
  readonly store: WorkstreamStore;
}

/**
 * A home with the fixture's mined candidates, and a store holding the fixture register, or nothing.
 *
 * @param empty whether the store starts empty rather than holding the fixture register
 * @returns the seat
 */
async function seat({ empty = false }: { empty?: boolean } = {}): Promise<Seat> {
  const home = scratch();
  let store: WorkstreamStore = inMemoryWorkstreamStore({ nowIso: NOW });
  if (!empty) {
    store = await seededStore();
  }
  return { catalog: seeded({ home }), home, mintId: countingMintId(), store };
}

/** What the store holds now. */
async function held({ store }: { store: WorkstreamStore }): Promise<WorkstreamRegisterSnapshot> {
  return unwrap(await store.read({ home: "" }));
}

/** One workstream the store holds, by id. */
async function heldOne({ id, store }: { id: string; store: WorkstreamStore }): Promise<StoredWorkstream> {
  return (await held({ store })).workstreams.find((one) => one.id === id)!;
}

describe("recordReactions", () => {
  it("records a no on a fresh install without starting a register", async () => {
    const { catalog, home, mintId, store } = await seat({ empty: true });
    const receipt = unwrap(
      await recordReactions({
        ...BASE,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-001", reaction: "no" }],
        store,
      }),
    );
    expect(receipt.rows.map((row) => [row.candidate, row.reaction])).toEqual([["c-001", "no"]]);
    expect(unwrap(readReactionRows({ home }))).toHaveLength(1);
    expect(isEmptyRegister({ snapshot: await held({ store }) })).toBe(true);
  });

  it("starts the register with the first yes on a fresh install, its definition of done the one picked before it", async () => {
    const { catalog, home, mintId, store } = await seat({ empty: true });
    const defined = unwrap(
      await recordDefinition({
        bySession: "test",
        candidateId: "c-002",
        home,
        mintId,
        nowIso: "2026-10-02T13:00:00.000Z",
        optionId: "owned-and-read",
        store,
        via: "console",
        words: undefined,
      }),
    );
    expect([defined.appended, defined.appliedTo]).toEqual([true, null]);
    const receipt = unwrap(
      await recordReactions({
        ...BASE,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-002", reaction: "yes" }],
        store,
      }),
    );
    expect(receipt.promoted).toEqual([{ as: "postmortems-that-happen", candidate: "c-002" }]);
    const register = await held({ store });
    expect(register.meta!.document.initiatives).toEqual([]);
    expect(register.meta!.document.grouping.label).toBe("Proposed from your words");
    const tile = register.workstreams[0]!;
    expect([tile.kind, tile.outcome, tile.milestones.at(-1)!.id, tile.milestones.at(-1)!.name]).toEqual([
      "standing",
      "Each postmortem has a named owner and the on-call lead has read it",
      "done",
      "Each postmortem has a named owner and the on-call lead has read it",
    ]);
  });

  it("refuses a register the store will not read, rather than starting a fresh one over it", async () => {
    const { catalog, home, mintId, store } = await seat();
    const refused = unwrapErr(
      await recordReactions({
        ...BASE,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-002", reaction: "yes" }],
        store: failingStore({ fail: "read", store }),
      }),
    );
    expect(refused.code).toBe("REGISTER_REFUSED");
    expect((await held({ store })).workstreams.map((one) => [one.id, one.revision])).toEqual(
      registerWorkstreams()
        .map((one) => [one.id, 1])
        .toSorted(([a], [b]) => String(a).localeCompare(String(b))),
    );
  });

  it("appends one row per pick, naming the candidate as it was answered and keeping the words as heard", async () => {
    const { catalog, home, mintId, store } = await seat();
    const receipt = unwrap(
      await recordReactions({
        ...BASE,
        catalog,
        heard: "not a workstream",
        home,
        mintId,
        picks: [{ candidate: "c-001", reaction: "no" }],
        store,
      }),
    );
    const row = {
      anchor: null,
      bySession: "test",
      candidate: "c-001",
      coveredBy: null,
      heard: "not a workstream",
      iso: NOW,
      milestoneOf: null,
      name: catalog.candidates.find((one) => one.id === "c-001")!.name,
      outcomeOf: null,
      owner: null,
      promotedAs: null,
      reaction: "no",
      reason: null,
      sameAs: null,
      steer: null,
      supersededBy: null,
      via: "console",
    };
    expect(receipt).toEqual({ alreadyHeld: [], ended: [], placed: [], promoted: [], rows: [row] });
    const lines = readFileSync(join(home, "workstreams", "reactions.jsonl"), "utf8").split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(row);
    expect(lines[1]).toBe("");
  });

  it("names each Slack channel a promoted workstream cites in the register document, keeping the document's own", async () => {
    const { catalog, home, mintId, store } = await seat();
    const receipt = unwrap(
      await recordReactions({
        ...BASE,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-002", reaction: "yes" }],
        store,
      }),
    );
    expect(receipt.promoted).toEqual([{ as: "postmortems-that-happen", candidate: "c-002" }]);
    expect((await held({ store })).meta!.document.channels).toEqual({
      C0SYNINCIDENTS: "#incidents",
      C0SYNPLATFORM: "#platform-squad",
    });
  });

  it("writes a done candidate as a closing workstream keeping its evidence, naming the channel its entries cite", async () => {
    const { catalog, home, mintId, store } = await seat();
    const receipt = unwrap(
      await recordReactions({
        ...BASE,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-002", reaction: "done" }],
        store,
      }),
    );
    expect(receipt.promoted).toEqual([{ as: "postmortems-that-happen", candidate: "c-002" }]);
    const register = await held({ store });
    expect(register.meta!.document.channels).toEqual({
      C0SYNINCIDENTS: "#incidents",
      C0SYNPLATFORM: "#platform-squad",
    });
    const closing = register.workstreams.find((one) => one.id === "postmortems-that-happen")!;
    const detail = closing.detail as { closedOn: string; people: readonly { slack: string }[] };
    expect([
      closing.kind,
      detail.closedOn,
      closing.outcome,
      detail.people.map((one) => one.slack),
      closing.entries.map((one) => one.date),
    ]).toEqual([
      "closing",
      "2026-10-02",
      "Every incident gets a written postmortem",
      ["U0SYNTESTAAA1"],
      ["2026-07-02", "2026-07-09"],
    ]);
  });

  it("refuses a pick naming no candidate, and records nothing", async () => {
    const { catalog, home, mintId, store } = await seat();
    const refused = unwrapErr(
      await recordReactions({
        ...BASE,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-999", reaction: "yes" }],
        store,
      }),
    );
    expect(refused).toEqual(CandidatesErrors.reactionRefused({ problems: ["no candidate has the id c-999"] }));
    expect(unwrap(readReactionRows({ home }))).toEqual([]);
  });
});

describe("recordDefinition", () => {
  /** A seat with a yes on c-002 already promoted. */
  async function accepted(): Promise<Seat> {
    const one = await seat();
    unwrap(
      await recordReactions({
        ...BASE,
        catalog: one.catalog,
        home: one.home,
        mintId: one.mintId,
        picks: [{ candidate: "c-002", reaction: "yes" }],
        store: one.store,
      }),
    );
    return one;
  }

  it("renames the promoted workstream's done milestone to a definition picked after the yes, and a repeat writes nothing", async () => {
    const { home, mintId, store } = await accepted();
    const ask = {
      bySession: "test",
      candidateId: "c-002",
      home,
      mintId,
      nowIso: "2026-10-02T14:00:00.000Z",
      optionId: undefined,
      store,
      via: "console",
      words: "every incident has a postmortem someone owns",
    } as const;
    const first = unwrap(await recordDefinition(ask));
    expect([first.appended, first.appliedTo]).toEqual([true, "postmortems-that-happen"]);
    const after = await held({ store });
    const again = unwrap(await recordDefinition({ ...ask, nowIso: "2026-10-02T15:00:00.000Z" }));
    expect([again.appended, again.appliedTo, again.row.iso]).toEqual([
      false,
      "postmortems-that-happen",
      "2026-10-02T14:00:00.000Z",
    ]);
    expect(await held({ store })).toEqual(after);
    expect(unwrap(readDefinitionRows({ home }))).toHaveLength(1);
    const tile = after.workstreams.find((one) => one.id === "postmortems-that-happen")!;
    expect(tile.outcome).toBe("every incident has a postmortem someone owns");
    expect(tile.milestones.at(-1)!.name).toBe("every incident has a postmortem someone owns");
  });

  it("refuses an option the candidate does not offer, and records nothing", async () => {
    const { home, mintId, store } = await accepted();
    const refused = unwrapErr(
      await recordDefinition({
        bySession: "test",
        candidateId: "c-002",
        home,
        mintId,
        nowIso: NOW,
        optionId: "no-such-option",
        store,
        via: "console",
        words: undefined,
      }),
    );
    expect(refused).toEqual(
      CandidatesErrors.definitionRefused({
        problems: ["c-002 offers no option no-such-option; it offers written-within-a-week, owned-and-read"],
      }),
    );
    expect(unwrap(readDefinitionRows({ home }))).toEqual([]);
  });

  it("refuses both an option and words at once", async () => {
    const { home, mintId, store } = await accepted();
    const refused = unwrapErr(
      await recordDefinition({
        bySession: "test",
        candidateId: "c-002",
        home,
        mintId,
        nowIso: NOW,
        optionId: "owned-and-read",
        store,
        via: "console",
        words: "mine",
      }),
    );
    expect(refused.message).toBe(
      "no definition recorded — give exactly one of --option <id>, --text <their words> or --all [--first <id>]",
    );
  });
});

describe("writeCandidates, against definitions", () => {
  it("refuses a re-mine renaming a candidate a definition was recorded for", async () => {
    const home = scratch();
    unwrap(writeCandidates({ home, value: validCandidates() }));
    unwrap(
      await recordDefinition({
        bySession: "test",
        candidateId: "c-003",
        home,
        mintId: countingMintId(),
        nowIso: NOW,
        optionId: undefined,
        store: inMemoryWorkstreamStore({ nowIso: NOW }),
        via: "console",
        words: "the WAF blocks",
      }),
    );
    const value = validCandidates();
    (value["candidates"] as { name: string }[])[2]!.name = "Something else";
    expect(unwrapErr(writeCandidates({ home, value })).code).toBe("CANDIDATES_INVALID");
  });
});

describe("recordReactions, an abandoned word", () => {
  const ANCHOR = "talk-call:x#turn_y";
  const REASON = "we dropped the tool in the end";
  const ENDING = { anchor: ANCHOR, kind: "abandoned", on: "2026-10-02", reason: REASON };

  it("ends the workstream a candidate is held under, keeping its story, and writes the reason on the row", async () => {
    const { catalog, home, mintId, store } = await seat();
    const before = await heldOne({ id: "merge-gate", store });
    const receipt = unwrap(
      await recordReactions({
        ...BASE,
        anchor: ANCHOR,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-001", reaction: "abandoned" }],
        reason: REASON,
        store,
        via: "word",
      }),
    );
    expect(receipt.ended).toEqual([{ as: "merge-gate", candidate: "c-001" }]);
    expect(receipt.promoted).toEqual([]);
    const gate = await heldOne({ id: "merge-gate", store });
    expect([gate.detail, gate.entries, gate.links, gate.revision]).toEqual([
      { ...before.detail, ending: ENDING },
      before.entries,
      before.links,
      2,
    ]);
    expect(unwrap(readReactionRows({ home }))[0]!.reason).toBe(REASON);
  });

  it("promotes a candidate the register does not hold already ended", async () => {
    const { catalog, home, mintId, store } = await seat();
    const receipt = unwrap(
      await recordReactions({
        ...BASE,
        anchor: ANCHOR,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-002", reaction: "abandoned" }],
        reason: REASON,
        store,
        via: "word",
      }),
    );
    const promoted = { as: "postmortems-that-happen", candidate: "c-002" };
    expect([receipt.promoted, receipt.ended]).toEqual([[promoted], [promoted]]);
    const tile = await heldOne({ id: "postmortems-that-happen", store });
    const detail = tile.detail as { ending: unknown; statusNote: string };
    expect([detail.ending, detail.statusNote]).toEqual([
      ENDING,
      "the owner's word abandoned on 2026-10-02, from the mined candidates",
    ]);
  });

  it("refuses an abandoned word with no reason, and records nothing", async () => {
    const { catalog, home, mintId, store } = await seat();
    const refused = unwrapErr(
      await recordReactions({
        ...BASE,
        anchor: ANCHOR,
        catalog,
        home,
        mintId,
        picks: [{ candidate: "c-001", reaction: "abandoned" }],
        store,
        via: "word",
      }),
    );
    expect(refused).toEqual(
      CandidatesErrors.reactionRefused({
        problems: ["c-001 is abandoned, which needs why (--reason) and where the owner said it (--anchor)"],
      }),
    );
    expect(unwrap(readReactionRows({ home }))).toEqual([]);
  });
});
