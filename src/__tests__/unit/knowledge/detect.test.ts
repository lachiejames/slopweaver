/**
 * The recall wave's pure halves: how many detectives a set of counts comes to, and what their briefs say.
 *
 * The discovery case is the one that matters. A wave without it can only ever return what the worker's own
 * words already reach, and recall search stems without synonyms — so the test asserts it is present when
 * nothing matched, when everything matched, and when the ceiling is one.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectArgs, waveLines, writeBriefs, writeWaveRecord } from "../../../cli/commands/knowledge/detect.js";
import { renderRecallBrief } from "../../../knowledge/detect/brief.js";
import { planRecallWave, type TermCount } from "../../../knowledge/detect/plan.js";

/** Counts as the register answers them. */
const count = (over: Partial<TermCount> = {}): TermCount => ({ term: "staging", total: 3, traces: 1, ...over });

describe("planRecallWave", () => {
  it("plans one lead per term that matched, plus the discovery lead last", () => {
    const wave = planRecallWave({
      counts: [count(), count({ term: "k6", total: 1, traces: 1 })],
    });
    expect(wave.leads.map((lead) => lead.term)).toEqual(["staging", "k6", null]);
  });

  it("orders the leads by what they match, so a deferred tail is the thinnest", () => {
    const wave = planRecallWave({
      counts: [count({ term: "thin", total: 1 }), count({ term: "fat", total: 40 })],
    });
    expect(wave.leads.map((lead) => lead.term)).toEqual(["fat", "thin", null]);
  });

  it("drops a term the register does not match — there is nothing for that detective to read", () => {
    const wave = planRecallWave({ counts: [count(), count({ term: "kafka", total: 0, traces: 0 })] });
    expect(wave.leads.map((lead) => lead.term)).toEqual(["staging", null]);
  });

  it("is a wave of ONE when nothing matched, and that one is discovery", () => {
    const wave = planRecallWave({ counts: [count({ total: 0, traces: 0 })] });
    expect(wave.leads.map((lead) => lead.term)).toEqual([null]);
    expect(wave.leads.length).toBe(1);
  });

  it("keeps the discovery lead even when the caller has one slot, and defers the rest rather than dropping", () => {
    const wave = planRecallWave({
      counts: [count({ term: "a", total: 9 }), count({ term: "b", total: 8 })],
      slots: 1,
    });
    expect(wave.leads.map((lead) => lead.term)).toEqual([null]);
    expect(wave.deferred.map((lead) => lead.term)).toEqual(["a", "b"]);
  });

  it("says in each lead's reason what the register holds for it, traces counted separately", () => {
    const wave = planRecallWave({ counts: [count({ total: 5, traces: 2 })] });
    expect(wave.leads[0]!.why).toBe('5 claim(s) match "staging", 2 of them traces');
  });
});

describe("detectArgs", () => {
  const parsed = ({ rest }: { rest: readonly string[] }): ReturnType<typeof detectArgs> => {
    const values: Record<string, unknown> = {};
    rest.forEach((token, index) => {
      if (token.startsWith("--") && !token.startsWith("--term")) {
        values[token.slice(2)] = rest[index + 1];
      }
    });
    const positionals = rest.filter((token, index) => !token.startsWith("--") && !rest[index - 1]?.startsWith("--"));
    return detectArgs({
      nowMs: 1789600000000,
      positionals,
      rest,
      roots: { recordSet: "/home/live/slack/detectives", unattached: "/home/detective" },
      values,
    });
  };

  it("collects every --term rather than folding the list to its last value", () => {
    const asked = parsed({ rest: ["a task", "--term", "staging", "--term", "k6"] });
    expect(asked.args?.terms).toEqual(["staging", "k6"]);
  });

  it("refuses a wave with no task and no term, naming both", () => {
    expect(parsed({ rest: [] }).refusals?.length).toBe(2);
  });

  it("refuses a slots value below one", () => {
    const refused = parsed({ rest: ["a task", "--term", "staging", "--slots", "0"] });
    expect(refused.refusals?.[0]).toContain("--slots must be a whole number");
  });

  it("mints an out directory under the detective root when the caller names none", () => {
    const asked = parsed({ rest: ["a task", "--term", "staging"] });
    expect(asked.args?.out).toContain("recall-");
  });

  it("lands the wave in the turn's own record set when --ask names the turn", () => {
    const asked = parsed({ rest: ["a task", "--term", "staging", "--ask", "C0TEST/1789600000.000100"] });
    expect(asked.args!.out).toBe("/home/live/slack/detectives/C0TEST-1789600000.000100/recall-1789600000000");
    expect(asked.args!.outNote).toBe(null);
  });

  it("refuses --ask beside --out rather than picking one", () => {
    const refused = parsed({ rest: ["a task", "--term", "staging", "--ask", "C0TEST/1.2", "--out", "/tmp/wave"] });
    expect(refused.refusals).toEqual(["--ask and --out name two different places — pass one"]);
  });

  it("keeps an out directory the caller did name", () => {
    const asked = parsed({ rest: ["a task", "--term", "staging", "--out", "/tmp/wave"] });
    expect(asked.args?.out).toBe("/tmp/wave");
  });
});

describe("writeBriefs and waveLines", () => {
  it("writes one brief per detective and names its report beside it", () => {
    const out = mkdtempSync(join(tmpdir(), "sw-recall-wave-"));
    try {
      const wave = planRecallWave({ counts: [{ term: "staging", total: 2, traces: 1 }] });
      const briefs = writeBriefs({
        args: {
          json: false,
          out,
          outNote: null,
          slots: undefined,
          task: "why does the pool exhaust",
          terms: ["staging"],
        },
        wave,
      });
      expect(briefs.length).toBe(2);
      expect(readFileSync(briefs[0]!.brief, "utf8")).toContain("Recall detective 1 of 2");
      expect(readFileSync(briefs[1]!.brief, "utf8")).toContain("DISCOVERY detective");
      const lines = waveLines({ briefs, outNote: null, task: "why does the pool exhaust", wave });
      expect(lines[0]).toBe('2 recall detective(s) for "why does the pool exhaust"');
      expect(lines.at(-1)).toContain("knowledge recalled");
    } finally {
      rmSync(out, { force: true, recursive: true });
    }
  });

  it("says how many leads the ceiling deferred, so a wave never drops one silently", () => {
    const out = mkdtempSync(join(tmpdir(), "sw-recall-wave-"));
    try {
      const wave = planRecallWave({
        counts: [
          { term: "a", total: 9, traces: 0 },
          { term: "b", total: 8, traces: 0 },
        ],
        slots: 1,
      });
      const briefs = writeBriefs({
        args: { json: false, out, outNote: null, slots: 1, task: "a task", terms: ["a", "b"] },
        wave,
      });
      expect(waveLines({ briefs, outNote: null, task: "a task", wave }).join("\n")).toContain(
        "2 lead(s) deferred past the ceiling",
      );
    } finally {
      rmSync(out, { force: true, recursive: true });
    }
  });
});

describe("writeWaveRecord", () => {
  it("writes the wave's shape beside its briefs, dated so a freeze can window it", () => {
    const out = mkdtempSync(join(tmpdir(), "sw-recall-wave-"));
    try {
      const args = { json: false, out, outNote: null, slots: undefined, task: "a task", terms: ["staging"] };
      const wave = planRecallWave({ counts: [{ term: "staging", total: 2, traces: 1 }] });
      const briefs = writeBriefs({ args, wave });
      writeWaveRecord({ args, briefs, recordedAtIso: "2026-09-17T01:02:03.000Z", wave });
      const record = JSON.parse(readFileSync(join(out, "wave.json"), "utf8")) as Record<string, unknown>;
      expect(record["kind"]).toBe("recall-wave");
      expect(record["recordedAtIso"]).toBe("2026-09-17T01:02:03.000Z");
      expect(record["detectives"]).toBe(2);
      expect(record["assignments"]).toEqual([
        { briefPath: join(out, "detective-1.md"), reportPath: join(out, "report-1.md"), term: "staging" },
        { briefPath: join(out, "detective-2.md"), reportPath: join(out, "report-2.md"), term: null },
      ]);
    } finally {
      rmSync(out, { force: true, recursive: true });
    }
  });
});

describe("renderRecallBrief", () => {
  const brief = ({ term }: { term: string | null }): string =>
    renderRecallBrief({
      context: { index: 1, reportPath: "/tmp/wave/report-1.md", task: "why does the staging pool exhaust", total: 2 },
      lead: { term, total: 3, traces: 1, why: "3 claim(s) match" },
    });

  it("tells a detective it may never say a leg can be skipped", () => {
    expect(brief({ term: "staging" })).toContain("You never tell the worker to skip a leg.");
  });

  it("carries the accounting command the worker runs afterwards", () => {
    expect(brief({ term: "staging" })).toContain(
      "slopweaver knowledge recalled <claim-id> --outcome held|broke|unchecked",
    );
  });

  it("tells a term detective which term it opens on", () => {
    expect(brief({ term: "staging" })).toContain('Your lead: the term "staging"');
  });

  it("tells the discovery detective it has no term, and why", () => {
    const text = brief({ term: null });
    expect(text).toContain("You are the DISCOVERY detective");
    expect(text).toContain("has NO synonyms");
  });

  it("names where the report goes, so the wave's own files are the contract", () => {
    expect(brief({ term: null })).toContain("/tmp/wave/report-1.md");
  });

  it("forbids spawning and posting, because a detective is a leaf", () => {
    expect(brief({ term: null })).toContain("You never spawn another agent");
  });

  it("forbids the worker's `turn` verbs the harness relays to every leaf", () => {
    expect(brief({ term: null })).toContain("You never run a `turn` verb");
  });
});
