import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { unwrap, unwrapErr } from "#lib/result.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { CandidatesErrors } from "../../../workstreams/candidateErrors.js";
import { readCandidateCatalog, readTitleRows, writeCandidates } from "../../../workstreams/candidateStore.js";
import { parseCandidatesFile } from "../../../workstreams/candidates.js";
import { recordDefinition } from "../../../workstreams/definitionStore.js";
import { appendLedgerRows } from "../../../workstreams/ledgerAppend.js";
import { LEDGER_LOCK_KEY } from "../../../workstreams/ledgerLock.js";
import { applyMarks, NO_PLACEMENT, noteEntry, notePhrasing, placementNote } from "../../../workstreams/placement.js";
import { recordProposal } from "../../../workstreams/proposalStore.js";
import { nextProposalId, type ProposalRow } from "../../../workstreams/proposals.js";
import { recordReactions } from "../../../workstreams/reactionStore.js";
import { recordTitle } from "../../../workstreams/titleStore.js";
import { latestTitles, type TitleRow, titleRowSchema } from "../../../workstreams/titles.js";
import { recordWhoFirst } from "../../../workstreams/whoFirstStore.js";

import { validCandidates } from "./candidatesFixture.js";
import { registerWorkstreams } from "./registerWorkstreamsFixture.js";
import { countingMintId, failingStore, mintedId, seededStore } from "./storeRegisterFixture.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

const NOW = "2026-10-03T05:30:00.000Z";

/** A throwaway home holding the fixture candidates — never the ambient home. */
function seeded(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-ws-ledgers-"));
  cleanups.push(() => {
    rmSync(home, { force: true, recursive: true });
  });
  unwrap(writeCandidates({ home, value: validCandidates() }));
  return home;
}

/** The ledger's lines as written, or `null` when the file was never created. */
function ledger({ home, name }: { home: string; name: string }): readonly string[] | null {
  const path = join(home, "workstreams", name);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8").trim().split("\n");
}

/** A titles.jsonl row with only the fields the fold reads varied. */
function titleRow({ candidate, title }: { candidate: string; title: string }): TitleRow {
  return { bySession: "s", candidate, iso: NOW, name: "mined", title, via: "word" };
}

/** A proposals.jsonl row with only its id varied. */
function proposalRow({ id }: { id: string }): ProposalRow {
  return {
    anchor: null,
    bySession: "s",
    from: null,
    id,
    iso: NOW,
    relation: "own",
    title: "t",
    via: "word",
    why: null,
  };
}

describe("the pure ledger folds", () => {
  it("lets the latest title per candidate stand", () => {
    const rows = [
      titleRow({ candidate: "c-001", title: "first" }),
      titleRow({ candidate: "c-002", title: "other" }),
      titleRow({ candidate: "c-001", title: "second" }),
    ];
    expect([...latestTitles({ rows })]).toEqual([
      ["c-001", "second"],
      ["c-002", "other"],
    ]);
  });

  it("numbers the next proposal one past the highest, three digits at least", () => {
    expect(nextProposalId({ rows: [] })).toBe("p-001");
    expect(nextProposalId({ rows: [proposalRow({ id: "p-009" }), proposalRow({ id: "p-002" })] })).toBe("p-010");
  });

  it("dates a note by its day, and appends the owner's reason to a placing note", () => {
    const candidate = unwrap(parseCandidatesFile({ value: validCandidates() })).candidates[1]!;
    expect(noteEntry({ nowIso: NOW, text: "x" })).toEqual({
      date: "2026-10-03",
      done: false,
      href: null,
      kind: "note",
      milestoneId: null,
      text: "x",
    });
    expect(placementNote({ candidate, reason: "same team", word: "same-as" })).toBe(
      `The owner named mined candidate c-002 "${candidate.name}" as this workstream: same team`,
    );
    expect(NO_PLACEMENT.reason).toBe(null);
  });
});

/** The subject an earlier register stored placement notes under, spelled as a pattern's source. */
const STORED_SUBJECT = /He/u.source;

/** The steer placement note an earlier register stored, spelled as a pattern's source. */
const STORED_STEER = /He accepted this as the steer he had already given/u.source;

describe("a placement note stored in its former spelling", () => {
  const candidate = unwrap(parseCandidatesFile({ value: validCandidates() })).candidates[1]!;
  const words = ["same-as", "milestone-of", "outcome-of", "covered-by"] as const;

  it("reads as the note placementNote writes now, for every placing word and the steer", () => {
    expect(words.length).toBeGreaterThan(0);
    const stored = words.map((word) =>
      placementNote({ candidate, reason: "same team", word }).replace(/^The owner/u, STORED_SUBJECT),
    );
    expect(stored.map((text) => notePhrasing({ text }))).toEqual(
      words.map((word) => placementNote({ candidate, reason: "same team", word })),
    );
    expect(notePhrasing({ text: `${STORED_STEER}: the pool steer` })).toBe(
      placementNote({ candidate, reason: "the pool steer", word: "steer" }),
    );
    expect(notePhrasing({ text: "Hello there" })).toBe("Hello there");
  });

  it("is not appended again by a retry, while a note with another reason still is", () => {
    const current = placementNote({ candidate, reason: "same team", word: "same-as" });
    const base = registerWorkstreams().find((one) => one.id === "merge-gate")!;
    const aggregate = {
      ...base,
      entries: [
        ...base.entries,
        {
          ...noteEntry({ nowIso: NOW, text: current.replace(/^The owner/u, STORED_SUBJECT) }),
          id: mintedId({ n: 90 }),
          position: base.entries.length,
        },
      ],
    };
    const unminted = (): string => {
      throw new Error("a retry minted an id");
    };
    const again = applyMarks({
      aggregate,
      marks: { milestones: [], notes: [noteEntry({ nowIso: NOW, text: current })] },
      mintId: unminted,
    });
    expect(unwrap(again)).toBe(aggregate);
    const other = placementNote({ candidate, reason: "another team", word: "same-as" });
    const appended = applyMarks({
      aggregate,
      marks: { milestones: [], notes: [noteEntry({ nowIso: NOW, text: other })] },
      mintId: countingMintId(),
    });
    expect(
      unwrap(appended)
        .entries.map((one) => one.text)
        .slice(-1),
    ).toEqual([other]);
  });
});

describe("every ledger writer validates the row it appends", () => {
  it("records a title once, and refuses a blank session with nothing written", async () => {
    const home = seeded();
    const store = await seededStore();
    const asked = {
      candidateId: "c-002",
      home,
      mintId: countingMintId(),
      nowIso: NOW,
      store,
      title: "Every incident written up",
      via: "word",
    } as const;
    const refused = unwrapErr(await recordTitle({ ...asked, bySession: "   " }));
    expect([refused.code, ledger({ home, name: "titles.jsonl" })]).toEqual(["AMENDMENT_REFUSED", null]);
    const first = unwrap(await recordTitle({ ...asked, bySession: "seat" }));
    const again = unwrap(await recordTitle({ ...asked, bySession: "seat" }));
    expect([first.appended, again.appended, ledger({ home, name: "titles.jsonl" })!.length]).toEqual([true, false, 1]);
  });

  it("refuses a proposal with a blank title, creating no ledger, then numbers the first p-001", async () => {
    const home = seeded();
    const asked = { anchor: null, bySession: "seat", from: null, relation: "own", via: "word", why: null } as const;
    const refused = unwrapErr(await recordProposal({ asked: { ...asked, title: "  " }, home, nowIso: NOW }));
    expect([refused.code, ledger({ home, name: "proposals.jsonl" })]).toEqual(["AMENDMENT_REFUSED", null]);
    const row = unwrap(await recordProposal({ asked: { ...asked, title: "DB load testing" }, home, nowIso: NOW }));
    expect([row.id, row.title]).toEqual(["p-001", "DB load testing"]);
  });

  it("refuses a title or definition over a register that will not read, before any row is written", async () => {
    const home = seeded();
    const store = failingStore({ fail: "read", store: await seededStore() });
    const asked = {
      bySession: "seat",
      candidateId: "c-002",
      home,
      mintId: countingMintId(),
      nowIso: NOW,
      store,
      via: "word",
    } as const;
    const titled = unwrapErr(await recordTitle({ ...asked, title: "Every incident written up" }));
    const defined = unwrapErr(
      await recordDefinition({ ...asked, optionId: undefined, words: "written within a week" }),
    );
    expect([titled.code, defined.code]).toEqual(["REGISTER_REFUSED", "REGISTER_REFUSED"]);
    expect([ledger({ home, name: "titles.jsonl" }), ledger({ home, name: "definitions.jsonl" })]).toEqual([null, null]);
  });

  it("starts a new line after a last row left without its newline, so both rows still read", async () => {
    const home = seeded();
    const store = await seededStore();
    const kept = titleRow({ candidate: "c-001", title: "Old title" });
    writeFileSync(join(home, "workstreams", "titles.jsonl"), JSON.stringify(kept));
    const asked = {
      bySession: "seat",
      candidateId: "c-002",
      home,
      mintId: countingMintId(),
      nowIso: NOW,
      store,
      title: "New title",
      via: "word",
    } as const;
    unwrap(await recordTitle(asked));
    expect([...latestTitles({ rows: unwrap(readTitleRows({ home })) })]).toEqual([
      ["c-001", "Old title"],
      ["c-002", "New title"],
    ]);
  });

  it("refuses to append through a ledger link that points nowhere, and leaves the link as it found it", async () => {
    const home = seeded();
    const path = join(home, "workstreams", "proposals.jsonl");
    symlinkSync(join(home, "gone", "proposals.jsonl"), path);
    const asked = { anchor: null, bySession: "seat", from: null, relation: "own", via: "word", why: null } as const;
    const refused = unwrapErr(
      await recordProposal({ asked: { ...asked, title: "DB load testing" }, home, nowIso: NOW }),
    );
    expect([refused.code, lstatSync(path).isSymbolicLink()]).toEqual(["CANDIDATES_WRITE_FAILED", true]);
  });

  it("refuses a whole batch when one row breaks the ledger's schema, creating no ledger", () => {
    const home = seeded();
    const path = join(home, "workstreams", "titles.jsonl");
    const refused = unwrapErr(
      appendLedgerRows({
        path,
        refusal: CandidatesErrors.amendmentRefused,
        rows: [
          titleRow({ candidate: "c-001", title: "Kept" }),
          { ...titleRow({ candidate: "c-002", title: "x" }), via: "fax" },
        ],
        schema: titleRowSchema,
      }),
    );
    expect([refused.code, existsSync(path)]).toEqual(["AMENDMENT_REFUSED", false]);
  });

  it("refuses a row its schema accepts but JSON cannot carry, creating no ledger", () => {
    const home = seeded();
    const path = join(home, "workstreams", "counts.jsonl");
    const refused = unwrapErr(
      appendLedgerRows({
        path,
        refusal: CandidatesErrors.amendmentRefused,
        rows: [{ count: 1n }],
        schema: z.object({ count: z.bigint() }),
      }),
    );
    expect([refused.code, existsSync(path)]).toEqual(["AMENDMENT_REFUSED", false]);
    expect(refused.message).toContain("BigInt");
  });

  // A first keep on a fresh install appends before any workstreams directory exists, so the append makes it.
  it("makes a missing ledger directory, and refuses where a directory holds the ledger's name", () => {
    const home = seeded();
    const row = titleRow({ candidate: "c-001", title: "Kept" });
    const asked = { refusal: CandidatesErrors.amendmentRefused, rows: [row], schema: titleRowSchema } as const;
    const orphan = join(home, "gone", "titles.jsonl");
    unwrap(appendLedgerRows({ ...asked, path: orphan }));
    const folder = join(home, "workstreams", "titles.jsonl");
    mkdirSync(folder);
    const shadowed = unwrapErr(appendLedgerRows({ ...asked, path: folder }));
    expect([readFileSync(orphan, "utf8"), shadowed.code]).toEqual([
      `${JSON.stringify(row)}\n`,
      "CANDIDATES_WRITE_FAILED",
    ]);
  });

  it("refuses to append to a read-only ledger, leaving its rows exactly as they were", async () => {
    const home = seeded();
    const store = await seededStore();
    const path = join(home, "workstreams", "titles.jsonl");
    const kept = `${JSON.stringify(titleRow({ candidate: "c-001", title: "Old title" }))}\n`;
    writeFileSync(path, kept, { mode: 0o400 });
    const asked = {
      bySession: "seat",
      candidateId: "c-002",
      home,
      mintId: countingMintId(),
      nowIso: NOW,
      store,
      via: "word",
    } as const;
    const refused = unwrapErr(await recordTitle({ ...asked, title: "New title" }));
    expect([refused.code, readFileSync(path, "utf8")]).toEqual(["CANDIDATES_WRITE_FAILED", kept]);
  });

  it("refuses a title naming no candidate or saying nothing, and a proposal beside an unknown candidate", async () => {
    const home = seeded();
    const asked = {
      bySession: "seat",
      home,
      mintId: countingMintId(),
      nowIso: NOW,
      store: await seededStore(),
      via: "word",
    } as const;
    const unknown = unwrapErr(await recordTitle({ ...asked, candidateId: "c-999", title: "x" }));
    const blank = unwrapErr(await recordTitle({ ...asked, candidateId: "c-002", title: "   " }));
    const proposal = {
      anchor: null,
      bySession: "seat",
      from: "c-999",
      relation: "own",
      via: "word",
      why: null,
    } as const;
    const beside = unwrapErr(
      await recordProposal({ asked: { ...proposal, title: "DB load testing" }, home, nowIso: NOW }),
    );
    expect([blank.message, beside.message]).toEqual([
      "nothing recorded — a title says something",
      "nothing recorded — no candidate has the id c-999",
    ]);
    expect(unknown.code).toBe("AMENDMENT_REFUSED");
    expect([ledger({ home, name: "titles.jsonl" }), ledger({ home, name: "proposals.jsonl" })]).toEqual([null, null]);
  });

  it("refuses a proposal beside a candidate no mine has proposed yet, as an unknown candidate", async () => {
    const home = mkdtempSync(join(tmpdir(), "sw-ws-ledgers-"));
    cleanups.push(() => {
      rmSync(home, { force: true, recursive: true });
    });
    const asked = { anchor: null, bySession: "seat", from: "c-001", relation: "own", via: "word", why: null } as const;
    const refused = unwrapErr(
      await recordProposal({ asked: { ...asked, title: "DB load testing" }, home, nowIso: NOW }),
    );
    expect([refused.code, refused.message]).toEqual([
      "AMENDMENT_REFUSED",
      "nothing recorded — no candidate has the id c-001",
    ]);
  });

  // The proof the cutover owes: a retried retitle writes nothing new, and the workstream keeps every id it held.
  it("renames the workstream a yes promoted, notes the mined name once, and touches no workstream that is gone", async () => {
    const home = seeded();
    const store = await seededStore();
    const mintId = countingMintId();
    const catalog = unwrap(readCandidateCatalog({ home }));
    const stamp = {
      anchor: null,
      bySession: "seat",
      heard: null,
      home,
      mintId,
      reason: null,
      store,
      via: "word",
    } as const;
    unwrap(await recordReactions({ ...stamp, catalog, nowIso: NOW, picks: [{ candidate: "c-002", reaction: "yes" }] }));
    const promoted = unwrap(await store.read({ home })).workstreams.find(
      (one) => one.id === "postmortems-that-happen",
    )!;
    const asked = { bySession: "seat", candidateId: "c-002", home, mintId, nowIso: NOW, store, via: "word" } as const;
    const renamed = unwrap(await recordTitle({ ...asked, title: "Postmortems" }));
    const once = unwrap(await store.read({ home })).workstreams.find((one) => one.id === "postmortems-that-happen")!;
    const again = unwrap(await recordTitle({ ...asked, title: "Postmortems" }));
    const workstream = unwrap(await store.read({ home })).workstreams.find(
      (one) => one.id === "postmortems-that-happen",
    )!;
    expect([renamed.appliedTo, again.appliedTo, workstream.name]).toEqual([
      "postmortems-that-happen",
      "postmortems-that-happen",
      "Postmortems",
    ]);
    expect(workstream.entries.filter((one) => one.text.startsWith("The owner retitled"))).toEqual([
      {
        date: "2026-10-03",
        done: false,
        href: null,
        id: mintedId({ n: 3 }),
        kind: "note",
        milestoneId: null,
        position: 2,
        text: 'The owner retitled this from the mined name "Postmortems that happen"',
      },
    ]);
    expect(workstream.entries.slice(0, promoted.entries.length)).toEqual(promoted.entries);
    expect([once.revision, workstream.revision]).toEqual([promoted.revision + 1, promoted.revision + 1]);
    expect(new Set(workstream.entries.map((one) => one.id)).size).toBe(workstream.entries.length);
    const gone = await seededStore();
    expect(unwrap(await recordTitle({ ...asked, store: gone, title: "Postmortems, owned" })).appliedTo).toBe(null);
  });

  it("refuses who-first with a blank session, with nothing written", async () => {
    const home = seeded();
    const refused = unwrapErr(
      await recordWhoFirst({
        bySession: " ",
        candidateId: "c-003",
        home,
        nowIso: NOW,
        people: ["Jasper"],
        team: null,
        via: "word",
      }),
    );
    expect([refused.code, ledger({ home, name: "who-first.jsonl" })]).toEqual(["AMENDMENT_REFUSED", null]);
  });
});

describe("every ledger writer refuses before it appends", () => {
  /** One call to each writer, all naming c-002 in the same home. */
  async function everyWriter({ home }: { home: string }): Promise<readonly string[]> {
    const store = await seededStore();
    const asked = { bySession: "seat", candidateId: "c-002", home, nowIso: NOW, via: "word" } as const;
    const registered = { ...asked, mintId: countingMintId(), store };
    const proposal = { anchor: null, bySession: "seat", from: null, relation: "own", via: "word", why: null } as const;
    return [
      unwrapErr(await recordTitle({ ...registered, title: "Postmortems" })).code,
      unwrapErr(await recordDefinition({ ...registered, optionId: undefined, words: "written within a week" })).code,
      unwrapErr(await recordProposal({ asked: { ...proposal, title: "DB load testing" }, home, nowIso: NOW })).code,
      unwrapErr(await recordWhoFirst({ ...asked, people: ["Jasper"], team: null })).code,
    ];
  }

  // The proof the cutover owes: the ledgers' lock is their own, never the key the retired register's fence takes.
  it("refuses every writer while another holds the ledgers, with nothing written", async () => {
    expect(LEDGER_LOCK_KEY).toBe("workstreams-ledgers");
    expect(LEDGER_LOCK_KEY).not.toBe("workstreams-register");
    const home = seeded();
    const held = unwrap(acquireOperationLock({ home, key: LEDGER_LOCK_KEY, nowIso: NOW }));
    cleanups.push(() => {
      held.release();
    });
    expect(await everyWriter({ home })).toEqual(["REGISTER_BUSY", "REGISTER_BUSY", "REGISTER_BUSY", "REGISTER_BUSY"]);
    expect(LEDGERS.map((name) => ledger({ home, name }))).toEqual([null, null, null, null]);
  });

  it("lets every writer run while the retired register's key is held, since the ledgers never take it", async () => {
    const home = seeded();
    const held = unwrap(acquireOperationLock({ home, key: "workstreams-register", nowIso: NOW }));
    cleanups.push(() => {
      held.release();
    });
    const titled = unwrap(
      await recordTitle({
        bySession: "seat",
        candidateId: "c-002",
        home,
        mintId: countingMintId(),
        nowIso: NOW,
        store: await seededStore(),
        title: "Postmortems",
        via: "word",
      }),
    );
    expect([titled.appended, ledger({ home, name: "titles.jsonl" })!.length]).toEqual([true, 1]);
  });

  it("refuses every writer over its own ledger holding a line that will not read, leaving the line as it was", async () => {
    const home = seeded();
    LEDGERS.forEach((name) => {
      writeFileSync(join(home, "workstreams", name), "{ not json\n");
    });
    expect(await everyWriter({ home })).toEqual([
      "CANDIDATES_UNREADABLE",
      "CANDIDATES_UNREADABLE",
      "CANDIDATES_UNREADABLE",
      "CANDIDATES_UNREADABLE",
    ]);
    expect(LEDGERS.map((name) => ledger({ home, name }))).toEqual([
      ["{ not json"],
      ["{ not json"],
      ["{ not json"],
      ["{ not json"],
    ]);
  });

  it("refuses who-first for a candidate that was never mined", async () => {
    const home = seeded();
    const refused = unwrapErr(
      await recordWhoFirst({
        bySession: "seat",
        candidateId: "c-999",
        home,
        nowIso: NOW,
        people: ["Jasper"],
        team: null,
        via: "word",
      }),
    );
    expect([refused.code, ledger({ home, name: "who-first.jsonl" })]).toEqual(["AMENDMENT_REFUSED", null]);
  });
});

/** The four amendment ledgers, in the order {@link everyWriter}'s writers append to them. */
const LEDGERS = ["titles.jsonl", "definitions.jsonl", "proposals.jsonl", "who-first.jsonl"] as const;
