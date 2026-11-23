/**
 * `workstreams list` and `workstreams put` over one in-memory store: the version-2 document the list prints is the
 * document put takes back, judged by the baseline it carries. The real store's half is
 * `integration/workstreamStoreBatch.test.ts`'s.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runWorkstreamsList, type WorkstreamsListDeps } from "../../../cli/commands/workstreams/list.js";
import { runWorkstreamsPut, type WorkstreamsPutDeps } from "../../../cli/commands/workstreams/put.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { err, unwrap } from "../../../lib/result.js";
import { WorkstreamStoreErrors } from "../../../workstreams/store/errors.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { fencedWorkstreamStore } from "../../../workstreams/store/register.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";
import { inMemoryWorkstreamStore } from "../../workstreamStoreFake.js";
import { ACME_META, acmeLinked, acmeLocal, acmeOutcome, OWN_DETAIL } from "../../workstreamStoreFixtures.js";

const NOW = "2026-11-09T12:00:00.000Z";
const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway directory these verbs may write into — never the ambient home. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-workstreams-cli-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** What one verb run wrote to each channel, and what it exited with. */
interface Recorded {
  readonly exit: number;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
  /** Every id list the verb asked the roster about, in call order. */
  readonly asked: readonly (readonly string[])[];
}

/** Run `workstreams list` with recording seams; the roster knows one person, `U0FIXTURE1`. */
async function list({ rest, store }: { rest: readonly string[]; store: WorkstreamStore }): Promise<Recorded> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const asked: (readonly string[])[] = [];
  const deps: WorkstreamsListDeps = {
    peopleFor: ({ ids }) => {
      asked.push(ids);
      return ids
        .filter((id) => id === "U0FIXTURE1")
        .map((nativeId) => ({
          avatarUrl: undefined,
          bot: false,
          deactivated: false,
          firstNameUnique: true,
          handle: "acme.lead",
          name: "Acme Lead",
          nameUnique: true,
          nativeId,
          org: undefined,
          title: undefined,
        }));
    },
    store,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  const exit = await runWorkstreamsList({ deps, rest });
  return { asked, diagnostics, exit, out };
}

/** Run `workstreams put` with recording seams. */
async function put({ rest, store }: { rest: readonly string[]; store: WorkstreamStore }): Promise<Recorded> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: WorkstreamsPutDeps = {
    store,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  const exit = await runWorkstreamsPut({ deps, rest });
  return { asked: [], diagnostics, exit, out };
}

/** Write a document into `dir` and return its path. */
function documentFile({ dir, value }: { dir: string; value: unknown }): string {
  const file = join(dir, "document.json");
  writeFileSync(file, JSON.stringify(value));
  return file;
}

/** A closing workstream, handed over. */
function closing(over: Partial<WorkstreamAggregate> = {}): WorkstreamAggregate {
  return {
    detail: { closedOn: null, ending: null, holding: "the acme team runs it", people: [], state: "handed over" },
    entries: [],
    id: "acme-old",
    kind: "closing",
    links: [],
    milestones: [],
    name: "Old thing",
    outcome: "acme ran the old thing",
    status: null,
    workspace: "team",
    ...over,
  };
}

/** One of every kind: an outcome waiting on the owner, a linked one, a local one and a closing one. */
function register(): readonly WorkstreamAggregate[] {
  return [
    acmeOutcome({
      detail: {
        ...OWN_DETAIL,
        people: [
          { part: "pilot lead", slack: "U0FIXTURE1" },
          { part: "reviewer", slack: "U0FIXTURE2" },
        ],
        waitingOn: { on: "you", what: "pick the pilot team" },
      },
    }),
    acmeLinked(),
    acmeLocal({ id: "acme-scratch" }),
    closing(),
  ];
}

/**
 * A store holding `workstreams` and the register document.
 *
 * @returns the store and the home it was written under
 */
async function seeded({ workstreams = register() }: { workstreams?: readonly WorkstreamAggregate[] } = {}): Promise<{
  home: string;
  store: WorkstreamStore;
}> {
  const home = scratch();
  const store = inMemoryWorkstreamStore({ nowIso: NOW });
  unwrap(
    await store.applyBatch({
      deletes: [],
      home,
      meta: { document: ACME_META, expectedRevision: null },
      writes: workstreams.map((aggregate) => ({ aggregate, expectedRevision: null })),
    }),
  );
  return { home, store };
}

describe("workstreams list", () => {
  it("exits expected-empty on an empty register, naming what it found", async () => {
    const run = await list({ rest: ["--home", scratch()], store: inMemoryWorkstreamStore({ nowIso: NOW }) });
    expect(run.exit).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.diagnostics).toEqual([
      "workstreams list: no workstreams yet — the store holds none and no register document",
    ]);
  });

  it("refuses, never answers empty, when the store will not answer", async () => {
    const outage = WorkstreamStoreErrors.unavailable({ doing: "read the workstreams", reason: "connection refused" });
    const store = fencedWorkstreamStore({ fence: () => err(outage), store: inMemoryWorkstreamStore({ nowIso: NOW }) });
    const run = await list({ rest: ["--home", scratch()], store });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics).toEqual([
      "workstreams list: WORKSTREAM_STORE_UNAVAILABLE: the store could not read the workstreams: connection refused",
    ]);
  });

  it("prints one line per workstream with its progress against its own milestones, held-on-the-owner first", async () => {
    const { home, store } = await seeded();
    const run = await list({ rest: ["--home", home], store });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out).toEqual([
      "Acme onboarding  your-call  pilot running  1 of 3 done, next: Pilot live  last moved 2026-11-03  waiting on you: pick the pilot team",
      "Acme audit  moving  the acme platform team  6 of 10, 2 short of audit gate  last moved 2026-11-03",
      "Acme scratch  kept here only",
      "Old thing  done  closed date not recorded  no cited timeline  handed over",
    ]);
  });

  it("says when a closing workstream closed and how much evidence it keeps, or its abandonment", async () => {
    const entries = [
      { date: "2026-09-02", kind: "raised", position: 0, text: "raised" },
      { date: "2026-09-20", kind: "announce", position: 1, text: "handed over" },
    ].map((one, at) => ({
      ...one,
      done: false,
      href: null,
      id: `00000000-0000-4000-8000-00000000010${String(at)}`,
      kind: one.kind as "raised" | "announce",
      milestoneId: null,
    }));
    const closed = await seeded({
      workstreams: [closing({ detail: { ...closing().detail, closedOn: "2026-09-20" }, entries })],
    });
    expect((await list({ rest: ["--home", closed.home], store: closed.store })).out).toEqual([
      "Old thing  done  closed 2026-09-20  2 dated entries  handed over",
    ]);
    const ending = {
      anchor: "talk-call:x#turn_y",
      kind: "abandoned",
      on: "2026-10-02",
      reason: "the tool was dropped",
    };
    const abandoned = await seeded({ workstreams: [closing({ detail: { ...closing().detail, ending } })] });
    expect((await list({ rest: ["--home", abandoned.home], store: abandoned.store })).out).toEqual([
      "Old thing  abandoned 2026-10-02: the tool was dropped",
    ]);
  });

  it("prints the version-2 document under --json, joining the roster for each person once", async () => {
    const { home, store } = await seeded();
    const run = await list({ rest: ["--home", home, "--json"], store });
    expect(run.out.length).toBe(1);
    const document = JSON.parse(run.out[0]!) as {
      baseline: string;
      meta: unknown;
      people: { nativeId: string; name: string }[];
      schemaVersion: number;
      workstreams: { id: string; derived: { lane: string; progressLine: string | null } }[];
    };
    expect(document.schemaVersion).toBe(2);
    expect(document.baseline).toMatch(/^wsb1\.[0-9a-f]{64}$/u);
    expect(document.meta).toEqual(ACME_META);
    expect(document.workstreams.map((one) => [one.id, one.derived.lane, one.derived.progressLine])).toEqual([
      ["acme-onboarding", "your-call", "1 of 3 done, next: Pilot live"],
      ["acme-linked", "moving", "1 of 3 done, next: Pilot live"],
      ["acme-scratch", "kept-here", null],
      ["acme-old", "done", null],
    ]);
    expect(run.asked).toEqual([["U0FIXTURE1", "U0FIXTURE2"]]);
    expect(document.people.map((one) => `${one.nativeId} ${one.name}`)).toEqual(["U0FIXTURE1 Acme Lead"]);
    expect((await list({ rest: ["--home", home], store })).asked).toEqual([]);
  });
});

describe("workstreams put", () => {
  it("takes the list's own document back unedited and rewrites nothing", async () => {
    const { home, store } = await seeded();
    const listed = await list({ rest: ["--home", home, "--json"], store });
    const run = await put({
      rest: ["--file", documentFile({ dir: home, value: JSON.parse(listed.out[0]!) }), "--home", home, "--json"],
      store,
    });
    expect(run.diagnostics).toEqual([]);
    expect(run.exit).toBe(EXIT_OK);
    expect(JSON.parse(run.out[0]!)).toEqual({ deleted: 0, workstreams: 4, written: 0 });
  });

  it("takes an unedited document back over a register with no meta, writing nothing", async () => {
    const home = scratch();
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: null, home }));
    const listed = await list({ rest: ["--home", home, "--json"], store });
    const run = await put({
      rest: ["--file", documentFile({ dir: home, value: JSON.parse(listed.out[0]!) }), "--home", home, "--json"],
      store,
    });
    expect([run.exit, run.diagnostics]).toEqual([EXIT_OK, []]);
    expect(JSON.parse(run.out[0]!)).toEqual({ deleted: 0, workstreams: 1, written: 0 });
  });

  it("refuses an unedited document as stale when another writer lands before it is confirmed current", async () => {
    const home = scratch();
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: null, home }));
    const listed = JSON.parse((await list({ rest: ["--home", home, "--json"], store })).out[0]!) as unknown;
    let reads = 0;
    const racing: WorkstreamStore = {
      ...store,
      read: async (request) => {
        reads += 1;
        if (reads === 2) {
          unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-another" }), expectedRevision: null, home }));
        }
        return store.read(request);
      },
    };
    const run = await put({
      rest: ["--file", documentFile({ dir: home, value: listed }), "--home", home],
      store: racing,
    });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics.length).toBe(1);
    expect(run.diagnostics[0]).toContain("workstreams put: WORKSTREAM_BASELINE_STALE: the register moved since");
  });

  it("refuses an unedited document as stale when another writer moves only a revision before it is confirmed", async () => {
    const home = scratch();
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: null, home }));
    const listed = JSON.parse((await list({ rest: ["--home", home, "--json"], store })).out[0]!) as unknown;
    let reads = 0;
    const racing: WorkstreamStore = {
      ...store,
      read: async (request) => {
        reads += 1;
        if (reads === 2) {
          unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: 1, home }));
        }
        return store.read(request);
      },
    };
    const run = await put({
      rest: ["--file", documentFile({ dir: home, value: listed }), "--home", home],
      store: racing,
    });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics.length).toBe(1);
    expect(run.diagnostics[0]).toContain("workstreams put: WORKSTREAM_BASELINE_STALE: the register moved since");
    expect(unwrap(await store.read({ home })).workstreams.map((one) => [one.id, one.revision])).toEqual([
      ["acme-scratch", 2],
    ]);
  });

  it("seeds an empty register from a document that carries no baseline", async () => {
    const home = scratch();
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const document = { meta: ACME_META, schemaVersion: 2, workstreams: register() };
    const run = await put({ rest: ["--file", documentFile({ dir: home, value: document }), "--home", home], store });
    expect(run.out).toEqual(["workstreams put: the register holds 4 workstreams — 4 written, 0 deleted"]);
    expect(unwrap(await store.read({ home })).workstreams.map((one) => one.id)).toEqual([
      "acme-linked",
      "acme-old",
      "acme-onboarding",
      "acme-scratch",
    ]);
  });

  it("refuses a document read before another writer moved the register, and keeps their change", async () => {
    const { home, store } = await seeded();
    const listed = JSON.parse((await list({ rest: ["--home", home, "--json"], store })).out[0]!) as Record<
      string,
      unknown
    >;
    unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-another" }), expectedRevision: null, home }));
    const run = await put({ rest: ["--file", documentFile({ dir: home, value: listed }), "--home", home], store });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("workstreams put: WORKSTREAM_BASELINE_STALE: the register moved since");
    expect(unwrap(await store.read({ home })).workstreams.map((one) => one.id)).toContain("acme-another");
  });

  it("refuses as stale, writing nothing of its own, when another writer lands between its read and its commit", async () => {
    const { home, store } = await seeded();
    const listed = JSON.parse((await list({ rest: ["--home", home, "--json"], store })).out[0]!) as {
      workstreams: { name: string }[];
    };
    const edited = { ...listed, workstreams: listed.workstreams.map((one) => ({ ...one, name: `${one.name} (ed)` })) };
    const racing: WorkstreamStore = {
      ...store,
      applyBatch: async (request) => {
        unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-another" }), expectedRevision: null, home }));
        return store.applyBatch(request);
      },
    };
    const run = await put({
      rest: ["--file", documentFile({ dir: home, value: edited }), "--home", home],
      store: racing,
    });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics.length).toBe(1);
    expect(run.diagnostics[0]).toContain("workstreams put: WORKSTREAM_BASELINE_STALE: the register moved since");
    const after = unwrap(await store.read({ home })).workstreams;
    expect(after.map((one) => one.id)).toContain("acme-another");
    expect(after.filter((one) => one.name.endsWith("(ed)"))).toEqual([]);
  });

  it("refuses as stale when another writer moves only a revision between its read and its commit", async () => {
    const { home, store } = await seeded();
    const listed = JSON.parse((await list({ rest: ["--home", home, "--json"], store })).out[0]!) as {
      workstreams: { name: string }[];
    };
    const edited = { ...listed, workstreams: listed.workstreams.map((one) => ({ ...one, name: `${one.name} (ed)` })) };
    const racing: WorkstreamStore = {
      ...store,
      applyBatch: async (request) => {
        unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: 1, home }));
        return store.applyBatch(request);
      },
    };
    const run = await put({
      rest: ["--file", documentFile({ dir: home, value: edited }), "--home", home],
      store: racing,
    });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics.length).toBe(1);
    expect(run.diagnostics[0]).toContain("workstreams put: WORKSTREAM_BASELINE_STALE: the register moved since");
    const after = unwrap(await store.read({ home })).workstreams;
    expect(after.find((one) => one.id === "acme-scratch")!.revision).toBe(2);
    expect(after.filter((one) => one.name.endsWith("(ed)"))).toEqual([]);
  });

  it("still refuses as stale when reading the store again after the conflict fails", async () => {
    const { home, store } = await seeded();
    const listed = JSON.parse((await list({ rest: ["--home", home, "--json"], store })).out[0]!) as {
      workstreams: { name: string }[];
    };
    const edited = { ...listed, workstreams: listed.workstreams.map((one) => ({ ...one, name: `${one.name} (ed)` })) };
    let committed = false;
    const racing: WorkstreamStore = {
      ...store,
      applyBatch: async (request) => {
        unwrap(await store.put({ aggregate: acmeLocal({ id: "acme-another" }), expectedRevision: null, home }));
        committed = true;
        return store.applyBatch(request);
      },
      read: async (request) => {
        if (committed) {
          return err(WorkstreamStoreErrors.unavailable({ doing: "read the register", reason: "connection dropped" }));
        }
        return store.read(request);
      },
    };
    const run = await put({
      rest: ["--file", documentFile({ dir: home, value: edited }), "--home", home],
      store: racing,
    });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics).toEqual([
      expect.stringContaining("workstreams put: WORKSTREAM_BASELINE_STALE: the register moved since"),
      "workstreams put: WORKSTREAM_STORE_UNAVAILABLE: the store could not read the register: connection dropped",
    ]);
    expect(run.diagnostics[0]).toContain("the register is now unknown, because reading it again failed");
    const after = unwrap(await store.read({ home })).workstreams;
    expect(after.filter((one) => one.name.endsWith("(ed)"))).toEqual([]);
  });

  it("refuses a document the store's rules refuse as content, writing nothing", async () => {
    const home = scratch();
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const document = { meta: null, schemaVersion: 2, workstreams: [acmeOutcome({ milestones: [] })] };
    const run = await put({ rest: ["--file", documentFile({ dir: home, value: document }), "--home", home], store });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("workstreams put: WORKSTREAM_INVALID");
    expect(unwrap(await store.read({ home })).workstreams).toEqual([]);
  });

  it("refuses a version-1 register as a usage error", async () => {
    const home = scratch();
    const run = await put({
      rest: ["--file", documentFile({ dir: home, value: { schemaVersion: 1, workstreams: [] } }), "--home", home],
      store: inMemoryWorkstreamStore({ nowIso: NOW }),
    });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("schemaVersion");
  });

  it("refuses a missing --file and an unknown flag as usage errors", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const missing = await put({ rest: ["--home", scratch()], store });
    expect(missing.exit).toBe(EXIT_USAGE);
    expect(missing.diagnostics[0]).toBe("workstreams put: --file is required");
    expect((await put({ rest: ["--if-current", "x"], store })).exit).toBe(EXIT_USAGE);
  });
});
