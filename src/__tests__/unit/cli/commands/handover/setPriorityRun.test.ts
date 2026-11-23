/**
 * `handover set-priority` — the verb that states the band a board row ranks in, and the backfill that writes every
 * undeclared row's kind default down (every board row carries a priority).
 *
 * The plan half is pure (`priorityPlan`). The round trip runs the REAL verb over a throwaway board, because what
 * the verb exists to produce is a doc whose `priority:` parses back — and, for the backfill, a doc whose marker
 * keeps `rank.ts` from reading the written default as a judgement.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { priorityPlan } from "../../../../../cli/commands/handover/setPriorityPlan.js";
import { runHandoverSetPriority } from "../../../../../cli/commands/handover/setPriorityRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { rowOfDoc } from "../../../../../handover/rank.js";

/** A clean row's text, with an optional extra front-matter block appended exactly as given. */
function rowText({ slug, kind, extra }: { slug: string; kind: "ask" | "doc"; extra: readonly string[] }): string {
  const asked = kind === "ask" ? ["askedIso: 2026-10-02T11:27:38.595Z"] : [];
  return [
    "---",
    `slug: ${slug}`,
    `kind: ${kind}`,
    "summary: a row the Queue draws a card for",
    "status: ready",
    ...asked,
    "artifact: null",
    ...extra,
    "---",
    "",
    "# body",
    "",
  ].join("\n");
}

describe("priorityPlan", () => {
  const doc = ({ kind, extra }: { kind: "ask" | "doc"; extra: readonly string[] }) =>
    parseHandoverDoc({ path: "/h/a.md", text: rowText({ extra, kind, slug: "a" }) });

  it("backfills a row declaring nothing with its kind's default, marked as a default", () => {
    expect(priorityPlan({ doc: doc({ extra: [], kind: "doc" }), request: { kind: "backfill" } })).toEqual({
      edit: {
        remove: [],
        set: [
          { key: "priority", value: "p2" },
          { key: "priorityFrom", value: "default" },
        ],
      },
      kind: "edit",
      priority: "p2",
    });
    expect(priorityPlan({ doc: doc({ extra: [], kind: "ask" }), request: { kind: "backfill" } })).toMatchObject({
      priority: "p1",
    });
  });

  it("never backfills over a band a row already states", () => {
    const stated = doc({ extra: ["priority: p3"], kind: "doc" });
    expect(priorityPlan({ doc: stated, request: { kind: "backfill" } })).toEqual({ kind: "unchanged" });
  });

  it("turns a backfilled default into a choice when somebody states the same band, dropping the marker", () => {
    const defaulted = doc({ extra: ["priority: p2", "priorityFrom: default"], kind: "doc" });
    expect(
      priorityPlan({ doc: defaulted, request: { because: "it is the audit gate", kind: "set", priority: "p2" } }),
    ).toEqual({
      edit: {
        remove: ["priorityFrom"],
        set: [
          { key: "priority", value: "p2" },
          { key: "priorityBecause", value: '"it is the audit gate"' },
        ],
      },
      kind: "edit",
      priority: "p2",
    });
  });

  it("writes nothing when the row already chose that band", () => {
    const chosen = doc({ extra: ["priority: p0"], kind: "doc" });
    expect(priorityPlan({ doc: chosen, request: { because: "again", kind: "set", priority: "p0" } })).toEqual({
      kind: "unchanged",
    });
  });

  it("refuses a row that does not parse cleanly", () => {
    const broken = doc({ extra: ["priority: p0", "priority: p1"], kind: "doc" });
    expect(priorityPlan({ doc: broken, request: { kind: "backfill" } })).toEqual({
      kind: "refused",
      problem: 'a does not parse cleanly: front-matter declares "priority" more than once — which one is meant?',
    });
  });
});

describe("a backfilled priority ranks as before and grooms nothing", () => {
  it("leaves an undeclared doc ungroomed at its default band, and a chosen one groomed", () => {
    const nowIso = "2026-10-02T12:00:00.000Z";
    const backfilled = parseHandoverDoc({
      path: "/h/a.md",
      text: rowText({ extra: ["priority: p2", "priorityFrom: default"], kind: "doc", slug: "a" }),
    });
    const chosen = parseHandoverDoc({
      path: "/h/b.md",
      text: rowText({ extra: ["priority: p2"], kind: "doc", slug: "b" }),
    });
    expect(backfilled.priorityFrom).toBe("default");
    expect(rowOfDoc({ doc: backfilled, nowIso, ruled: false, standing: "ready" })).toMatchObject({
      groomed: false,
      priority: "p2",
    });
    expect(rowOfDoc({ doc: chosen, nowIso, ruled: false, standing: "ready" })).toMatchObject({
      groomed: true,
      priority: "p2",
    });
  });
});

describe("handover set-priority against a real temp board", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }
  });

  function fixture(): { home: string; askPath: string; docPath: string; statedPath: string } {
    const home = mkdtempSync(join(tmpdir(), "set-priority-home-"));
    dirs.push(home);
    mkdirSync(join(home, "handovers"), { recursive: true });
    const askPath = join(home, "handovers", "an-ask.md");
    const docPath = join(home, "handovers", "a-doc.md");
    const statedPath = join(home, "handovers", "a-stated.md");
    writeFileSync(askPath, rowText({ extra: [], kind: "ask", slug: "an-ask" }), "utf8");
    writeFileSync(docPath, rowText({ extra: [], kind: "doc", slug: "a-doc" }), "utf8");
    writeFileSync(statedPath, rowText({ extra: ["priority: p0"], kind: "doc", slug: "a-stated" }), "utf8");
    return { askPath, docPath, home, statedPath };
  }

  const argv = ({ home, rest }: { home: string; rest: readonly string[] }): readonly string[] => [
    "node",
    "slopweaver",
    "handover",
    "set-priority",
    ...rest,
    "--home",
    home,
  ];

  const read = ({ path }: { path: string }) => parseHandoverDoc({ path, text: readFileSync(path, "utf8") });

  it("writes a chosen band that parses back, with its reason beside it", async () => {
    const { home, docPath } = fixture();
    const code = await runHandoverSetPriority(
      argv({ home, rest: ["a-doc", "--priority", "p0", "--because", "the audit gate is Friday"] }),
    );
    expect(code).toBe(EXIT_OK);
    expect(read({ path: docPath }).priority).toBe("p0");
    expect(readFileSync(docPath, "utf8")).toContain('priorityBecause: "the audit gate is Friday"');
  });

  it("backfills nothing without --apply, then every undeclared row with --apply, never a stated one", async () => {
    const { home, askPath, docPath, statedPath } = fixture();
    const stated = readFileSync(statedPath, "utf8");
    const before = readFileSync(docPath, "utf8");
    expect(await runHandoverSetPriority(argv({ home, rest: ["--backfill"] }))).toBe(EXIT_OK);
    expect(readFileSync(docPath, "utf8")).toBe(before);
    expect(await runHandoverSetPriority(argv({ home, rest: ["--backfill", "--apply"] }))).toBe(EXIT_OK);
    expect([read({ path: askPath }).priority, read({ path: askPath }).priorityFrom]).toEqual(["p1", "default"]);
    expect([read({ path: docPath }).priority, read({ path: docPath }).priorityFrom]).toEqual(["p2", "default"]);
    expect(readFileSync(statedPath, "utf8")).toBe(stated);
  });

  it("refuses a missing band, a missing --because, --apply on a named row, and a backfill naming a row", async () => {
    const { home, docPath } = fixture();
    const before = readFileSync(docPath, "utf8");
    expect(await runHandoverSetPriority(argv({ home, rest: ["a-doc", "--priority", "p9", "--because", "x"] }))).toBe(
      EXIT_USAGE,
    );
    expect(await runHandoverSetPriority(argv({ home, rest: ["a-doc", "--priority", "p0"] }))).toBe(EXIT_USAGE);
    expect(
      await runHandoverSetPriority(argv({ home, rest: ["a-doc", "--priority", "p0", "--because", "x", "--apply"] })),
    ).toBe(EXIT_USAGE);
    expect(await runHandoverSetPriority(argv({ home, rest: ["a-doc", "--backfill"] }))).toBe(EXIT_USAGE);
    expect(readFileSync(docPath, "utf8")).toBe(before);
  });

  it("refuses a slug no row claims", async () => {
    const { home } = fixture();
    expect(
      await runHandoverSetPriority(argv({ home, rest: ["no-such-row", "--priority", "p0", "--because", "x"] })),
    ).toBe(EXIT_ERROR);
  });
});
