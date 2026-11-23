/**
 * `slopweaver ruling` end to end over plain injected seams and a throwaway home: record refuses beside an earlier
 * ruling and prints it, then files on a disposition; list reads by category; seed plans and applies from synthetic
 * state documents; view publishes the one page. Synthetic words only.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runRulingWithDeps } from "../../../../../cli/commands/ruling/run.js";
import type { RulingDeps } from "../../../../../cli/commands/ruling/shared.js";
import { publisherWith, recordingWriter } from "../../../../pagePublisherFake.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, fake seams over it, and what they printed and published. */
function harness(): {
  home: string;
  deps: RulingDeps;
  out: string[];
  errors: string[];
  written: ReturnType<typeof recordingWriter>["written"];
} {
  const home = mkdtempSync(join(tmpdir(), "ruling-run-"));
  homes.push(home);
  const out: string[] = [];
  const errors: string[] = [];
  // A refused record still drew an id, so each attempt takes the next one.
  const ids = ["1", "2", "3", "4", "5"].map((digit) => `ruling-${digit.repeat(12)}`);
  const { writer, written } = recordingWriter();
  const deps: RulingDeps = {
    home: () => home,
    logger: {
      error: ({ msg }) => {
        errors.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    newId: () => ids.shift()!,
    nowIso: () => "2026-01-10T00:00:00.000Z",
    publish: publisherWith({ writer }),
  };
  return { deps, errors, home, out, written };
}

/** Run one `ruling` invocation. */
function run({ deps, words }: { deps: RulingDeps; words: readonly string[] }): Promise<number> {
  return runRulingWithDeps({ argv: ["node", "slopweaver", "ruling", ...words], deps });
}

const RECORD = ["record", "--category", "landing", "--decided-on", "2026-01-05"];

describe("ruling record and list", () => {
  it("starts a category only when asked, refuses beside an earlier ruling and prints it, then files a replacement", async () => {
    const { deps, out, errors, home } = harness();
    expect(await run({ deps, words: [...RECORD, "--words", "two passes, no third"] })).toBe(2);
    expect(errors.join("\n")).toContain("pass --new-category to start it");

    expect(await run({ deps, words: [...RECORD, "--words", "two passes, no third", "--new-category"] })).toBe(0);
    expect(out).toContain("ruling: filed ruling-222222222222 in landing");

    errors.length = 0;
    expect(await run({ deps, words: [...RECORD, "--words", "one pass is enough"] })).toBe(2);
    expect(errors).toContain("    two passes, no third");
    expect(errors).toContain("  ruling-222222222222 · decided 2026-01-05");

    out.length = 0;
    const replace = [...RECORD, "--words", "one pass is enough", "--replaces", "ruling-222222222222"];
    expect(await run({ deps, words: replace })).toBe(0);
    expect(out).toStrictEqual(["ruling: filed ruling-444444444444 in landing", "  replaces ruling-222222222222"]);

    out.length = 0;
    expect(await run({ deps, words: ["list"] })).toBe(0);
    expect(out).toStrictEqual([
      "## landing",
      "ruling-444444444444 · landing · decided 2026-01-05",
      "    one pass is enough",
    ]);

    out.length = 0;
    expect(await run({ deps, words: ["list", "--all", "--json"] })).toBe(0);
    expect(out.map((line) => (JSON.parse(line) as { replacedBy?: string }).replacedBy)).toStrictEqual([
      "ruling-444444444444",
      undefined,
    ]);
    expect(readFileSync(join(home, "rulings.jsonl"), "utf8").split("\n")).toHaveLength(3);
  });

  it("refuses a record missing its words before touching the register", async () => {
    const { deps, errors } = harness();
    expect(await run({ deps, words: ["record", "--category", "landing", "--decided-on", "2026-01-05"] })).toBe(2);
    expect(errors[0]).toContain("--category, --words and --decided-on are each required");
  });

  it("refuses an unknown verb with every usage line", async () => {
    const { deps, errors } = harness();
    expect(await run({ deps, words: ["rewrite"] })).toBe(2);
    expect(errors[0]).toBe("unknown ruling verb rewrite");
  });

  it("reports a malformed register as an error and leaves it as it was", async () => {
    const { deps, errors, home } = harness();
    writeFileSync(join(home, "rulings.jsonl"), "{}\n");
    expect(await run({ deps, words: ["list"] })).toBe(1);
    expect(errors[0]).toContain("is not a ruling row");
    expect(readFileSync(join(home, "rulings.jsonl"), "utf8")).toBe("{}\n");
  });
});

describe("ruling seed", () => {
  it("plans, then applies, then applies again filing nothing twice", async () => {
    const { deps, out, errors, home } = harness();
    const state = join(home, "state.md");
    writeFileSync(
      state,
      [
        "### RULINGS",
        "- RULED 2026-01-02, the owner, talk:00000000-0000-4000-8000-00000000000d: keep the store local.",
        "- STEER 2026-01-02, the owner: not a ruling.",
      ].join("\n"),
    );
    expect(await run({ deps, words: ["seed", "--from", state, "--plan"] })).toBe(0);
    expect(out[0]).toBe(`${state}: 1 RULINGS section(s), 1 ruling(s), 1 skipped, 0 blocker(s)`);
    const candidate = out.find((line) => line.startsWith("CANDIDATE "))!.split(" ");
    expect(out).toContain("    keep the store local.");

    const decisions = join(home, "decisions.jsonl");
    writeFileSync(
      decisions,
      `${JSON.stringify({ alongside: false, category: "privacy", replaces: [], seedKey: candidate[2] })}\n`,
    );
    out.length = 0;
    const applied = await run({ deps, words: ["seed", "--from", state, "--decisions", decisions, "--apply"] });
    expect(errors).toStrictEqual([]);
    expect(applied).toBe(0);
    expect(out[0]).toBe(`ruling seed: filed 1, 0 already filed (${join(home, "rulings.jsonl")})`);
    out.length = 0;
    expect(await run({ deps, words: ["seed", "--from", state, "--decisions", decisions, "--apply"] })).toBe(0);
    expect(out[0]).toBe(`ruling seed: filed 0, 1 already filed (${join(home, "rulings.jsonl")})`);

    out.length = 0;
    expect(await run({ deps, words: ["list", "--category", "privacy"] })).toBe(0);
    expect(out[1]).toBe(`${candidate[1]!} · privacy · decided 2026-01-02 · talk:00000000-0000-4000-8000-00000000000d`);
  });

  it("exits 1 on a plan holding a blocker, and refuses a seed with no mode", async () => {
    const { deps, out, errors, home } = harness();
    const state = join(home, "state.md");
    writeFileSync(state, "### RULINGS\n- not a dated row\n");
    expect(await run({ deps, words: ["seed", "--from", state, "--plan"] })).toBe(1);
    expect(out).toContain(`BLOCKER ${state}:2 — a bullet in a RULINGS section that is not a dated ruling row`);
    expect(await run({ deps, words: ["seed", "--from", state] })).toBe(2);
    expect(errors[0]).toContain("--plan alone or --decisions with --apply");
  });
});

describe("ruling view", () => {
  it("publishes the one page at slug ruling and prints its address", async () => {
    const { deps, out, written } = harness();
    await run({ deps, words: [...RECORD, "--words", "two passes, no third", "--new-category"] });
    out.length = 0;
    expect(await run({ deps, words: ["view"] })).toBe(0);
    expect(written.map((page) => page.slug)).toStrictEqual(["ruling"]);
    expect(written[0]!.document).toContain("two passes, no third");
    expect(out[0]).toContain("ruling view: 1 current ruling(s) at ");
  });
});
