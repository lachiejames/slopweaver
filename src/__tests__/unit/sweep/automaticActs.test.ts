/**
 * `performAutomaticActs` over plain fake seams: the per-pass cap, that a REFUSED verb leaves its row and the pass
 * moves on, and that an UNWRITTEN ledger row stops the pass and marks it failed.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_ACT_CAP,
  type AutomaticAct,
  type AutomaticActDeps,
  type AutomaticActKind,
  performAutomaticActs,
  rowFingerprint,
} from "../../../cli/commands/sweep/automaticActs.js";
import { registerVerbArgv } from "../../../cli/commands/sweep/registerVerbCall.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import type { SweepJournalRow } from "../../../sweep/journalRow.js";

const KIND: AutomaticActKind = {
  flag: "--close-shipped",
  kind: "close-shipped-board-row",
  said: "I closed a board row whose own witness said shipped.",
  session: "sweep board --close-shipped",
  why: "its own witness says the work is in",
};

function act({ slug }: { slug: string }): AutomaticAct {
  return {
    act: "close",
    call: registerVerbArgv({ rest: [slug, "--home", "/state"], verb: "close" }),
    candidate: { act: "close", path: `/h/${slug}.md`, slug, verdict: "SHIPPED", witness: "all 2 probe(s) pass" },
    reason: "SHIPPED",
    witness: "all 2 probe(s) pass",
  };
}

/**
 * Fake writes recording each act. `refuseOn` names a slug whose verb exits 1 writing nothing, `writeThenFailOn` one
 * whose verb writes and then exits 1, `unreadableOn` one whose files will not read, `failLedgerOn` one whose row fails.
 */
function fakes({
  refuseOn,
  writeThenFailOn,
  unreadableOn,
  failLedgerOn,
}: { refuseOn?: string; writeThenFailOn?: string; unreadableOn?: string; failLedgerOn?: string } = {}): {
  deps: AutomaticActDeps;
  ran: string[];
  ledger: SweepJournalRow[];
  autonomy: string[];
  diagnostics: string[];
} {
  const ran: string[] = [];
  const ledger: SweepJournalRow[] = [];
  const autonomy: string[] = [];
  const diagnostics: string[] = [];
  return {
    autonomy,
    deps: {
      appendLedger: ({ row }) => {
        if (row.slug === failLedgerOn) {
          return err({ message: "the ledger would not write" });
        }
        ledger.push(row);
        return ok(undefined);
      },
      nowIso: () => "2026-11-11T07:00:00.000Z",
      // The row's files read as the verbs that ran over them, so a verb that wrote changes what this answers.
      observe: ({ act: observed }) => {
        const slug = observed.candidate.slug;
        if (slug === unreadableOn) {
          return err({ message: "EACCES" });
        }
        const wrote = ran.includes(slug) && slug !== refuseOn;
        return ok(wrote ? `${slug} written` : `${slug} untouched`);
      },
      recordAutonomy: ({ row }) => {
        autonomy.push(`${row.subject} ${row.kind} ${row.bySession}`);
        return Promise.resolve(undefined);
      },
      runVerb: ({ act: performed }) => {
        const slug = performed.candidate.slug;
        ran.push(slug);
        const fails = slug === refuseOn || slug === writeThenFailOn || slug === unreadableOn;
        return Promise.resolve(fails ? 1 : 0);
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    ledger,
    ran,
  };
}

describe("rowFingerprint", () => {
  it("reads a creation, an append and a removal each as a change, and an untouched pair as the same", () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-fingerprint-"));
    try {
      const doc = join(root, "row.md");
      const journal = join(root, "row.jsonl");
      writeFileSync(doc, "---\nslug: row\n---\n", "utf8");
      const read = (): string => unwrap(rowFingerprint({ paths: [doc, journal] }));
      const absent = read();
      expect(read()).toBe(absent);
      writeFileSync(journal, '{"kind":"started"}\n', "utf8");
      const created = read();
      appendFileSync(journal, '{"kind":"closed"}\n', "utf8");
      const appended = read();
      rmSync(doc);
      const removed = read();
      expect(new Set([absent, created, appended, removed]).size).toBe(4);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("performAutomaticActs", () => {
  it("runs each act's verb and journals it on both ledgers, with the act's own reason", async () => {
    const { deps, ledger, autonomy, diagnostics } = fakes();
    const done = await performAutomaticActs({ acts: [act({ slug: "a" }), act({ slug: "b" })], deps, kind: KIND });
    expect(done).toEqual({ acted: ["a", "b"], attempted: 2, stopped: false });
    expect(ledger.map((row) => [row.slug, row.verdict, row.act, row.session, row.verbLine])).toEqual([
      ["a", "SHIPPED", "close", "sweep board --close-shipped", "slopweaver handover close a --home /state"],
      ["b", "SHIPPED", "close", "sweep board --close-shipped", "slopweaver handover close b --home /state"],
    ]);
    expect(autonomy).toEqual([
      "a close-shipped-board-row sweep board --close-shipped",
      "b close-shipped-board-row sweep board --close-shipped",
    ]);
    expect(diagnostics).toEqual([
      "sweep board: --close-shipped acted on 2 of 2 row(s) — slopweaver sweep list names each",
    ]);
  });

  it("leaves a row whose verdict the verb refused and acts on every row after it", async () => {
    const { deps, ran, ledger, diagnostics } = fakes({ refuseOn: "b" });
    const done = await performAutomaticActs({
      acts: [act({ slug: "a" }), act({ slug: "b" }), act({ slug: "c" })],
      deps,
      kind: KIND,
    });
    expect(done).toEqual({ acted: ["a", "c"], attempted: 3, stopped: false });
    expect(ran).toEqual(["a", "b", "c"]);
    expect(ledger.map((row) => row.slug)).toEqual(["a", "c"]);
    expect(diagnostics[0]).toBe(
      "sweep board: --close-shipped left b: `handover close` exited 1, its own lines above name why",
    );
  });

  it("stops at an unwritten ledger row, printing the act, and reports the pass stopped", async () => {
    const { deps, ran, autonomy, diagnostics } = fakes({ failLedgerOn: "a" });
    const done = await performAutomaticActs({ acts: [act({ slug: "a" }), act({ slug: "b" })], deps, kind: KIND });
    expect(done).toEqual({ acted: ["a"], attempted: 1, stopped: true });
    expect(ran).toEqual(["a"]);
    expect(autonomy).toEqual([]);
    expect(diagnostics.slice(0, 1)).toEqual([
      "sweep board: --close-shipped acted on a, but the ledger would not write — the act was:",
    ]);
    expect(diagnostics).toContain("sweep board: --close-shipped stopped — an act it could not record is printed above");
  });

  // `handover settle` can write the row, then fail mirroring it and exit non-zero.
  it("journals a verb that wrote and then exited non-zero, and stops the pass on it", async () => {
    const { deps, ran, ledger, diagnostics } = fakes({ writeThenFailOn: "a" });
    const done = await performAutomaticActs({ acts: [act({ slug: "a" }), act({ slug: "b" })], deps, kind: KIND });
    expect(done).toEqual({ acted: ["a"], attempted: 1, stopped: true });
    expect(ran).toEqual(["a"]);
    expect(ledger.map((row) => [row.slug, row.verdict])).toEqual([["a", "SHIPPED"]]);
    expect(diagnostics.slice(0, 2)).toEqual([
      "sweep board: --close-shipped wrote a and then failed: `handover close` exited 1 after its write",
      "sweep board: --close-shipped stopped — an act wrote and then failed; it is journalled, and its own lines above name the failure",
    ]);
  });

  it("stops, printing the act, when a non-zero exit leaves the row's files unreadable", async () => {
    const { deps, ledger, diagnostics } = fakes({ unreadableOn: "a" });
    const done = await performAutomaticActs({ acts: [act({ slug: "a" }), act({ slug: "b" })], deps, kind: KIND });
    expect(done).toEqual({ acted: [], attempted: 1, stopped: true });
    expect(ledger).toEqual([]);
    expect(diagnostics.slice(0, 2)).toEqual([
      "sweep board: --close-shipped cannot tell whether a was written: `handover close` exited 1, and its files would not read (EACCES; EACCES) — the act was: slopweaver handover close a --home /state",
      "sweep board: --close-shipped stopped — an act may have written with no record; it is printed above",
    ]);
  });

  it("stops when the autonomy row will not write, since the act then has only half its record", async () => {
    const { deps } = fakes();
    const failing: AutomaticActDeps = { ...deps, recordAutonomy: () => Promise.resolve("the ledger is torn") };
    const done = await performAutomaticActs({
      acts: [act({ slug: "a" }), act({ slug: "b" })],
      deps: failing,
      kind: KIND,
    });
    expect(done).toEqual({ acted: ["a"], attempted: 1, stopped: true });
  });

  it(`acts on at most ${String(AUTOMATIC_ACT_CAP)} rows a pass and names the next pass's`, async () => {
    const { deps, ran, diagnostics } = fakes();
    const many = Array.from({ length: AUTOMATIC_ACT_CAP + 2 }, (_, index) => act({ slug: `row-${String(index)}` }));
    const done = await performAutomaticActs({ acts: many, deps, kind: KIND });
    expect(ran.length).toBe(AUTOMATIC_ACT_CAP);
    expect(done.attempted).toBe(AUTOMATIC_ACT_CAP);
    expect(diagnostics.filter((line) => line.includes("is the next pass's"))).toEqual([
      `sweep board: --close-shipped reached its cap of ${String(AUTOMATIC_ACT_CAP)} — row-25 is the next pass's`,
      `sweep board: --close-shipped reached its cap of ${String(AUTOMATIC_ACT_CAP)} — row-26 is the next pass's`,
    ]);
  });

  it("does nothing and says so over no acts", async () => {
    const { deps, diagnostics } = fakes();
    expect(await performAutomaticActs({ acts: [], deps, kind: KIND })).toEqual({
      acted: [],
      attempted: 0,
      stopped: false,
    });
    expect(diagnostics).toEqual([
      "sweep board: --close-shipped acted on 0 of 0 row(s) — slopweaver sweep list names each",
    ]);
  });
});
