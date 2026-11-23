import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CYCLE_RECONCILE_FLAG_NAMES, parseReconcileOptions } from "../../../cli/commands/cycle/core.js";
import {
  cycleReconcileCommand,
  cycleReconcileJson,
  publishCycleReconcile,
} from "../../../cli/commands/cycle/reconcileRun.js";
import { reconcileForm, reconcileLines } from "../../../cycle/render.js";
import type { CycleProposal, CycleReconcileReport } from "../../../cycle/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TABLE_MAX_ROWS } from "../../../outbound/artifact/schema.js";

const proposal = (over: Partial<CycleProposal> = {}): CycleProposal => ({
  action: "close-with-comment",
  daysSinceMoved: 31,
  evidence: [{ fact: "the pull request is merged", url: "https://github.com/example-org/example-repo/pull/101" }],
  headline: "EXA-1 has a merged pull request and is still open.",
  oneWordReplies: ["close", "keep", "later"],
  priority: "Medium",
  subject: "EXA-1",
  url: "https://linear.app/example/issue/exa-1",
  ...over,
});

const report = (over: Partial<CycleReconcileReport> = {}): CycleReconcileReport => ({
  couldNotSee: [],
  generatedAtIso: "2026-09-01T00:00:00.000Z",
  home: "/tmp/example",
  owner: "Example Owner",
  proposals: [proposal()],
  proposalsOnly: true,
  scan: {
    assignedEver: 5,
    liveProjectsLed: 1,
    openInCurrentCycle: 3,
    staleInCurrentCycle: 2,
    teamsWithCurrentCycle: 1,
  },
  wrote: false,
  ...over,
});

describe("reconcileForm", () => {
  it("maps Linear's own priority onto severity rather than reading the title", () => {
    const urgent = reconcileForm({ report: report({ proposals: [proposal({ priority: "Urgent" })] }) });
    const high = reconcileForm({ report: report({ proposals: [proposal({ priority: "High" })] }) });
    const rest = reconcileForm({ report: report({ proposals: [proposal({ priority: "Medium" })] }) });
    expect(JSON.stringify(urgent)).toContain('"severity":"red"');
    expect(JSON.stringify(high)).toContain('"severity":"orange"');
    expect(JSON.stringify(rest)).toContain('"severity":"green"');
  });

  it("says in the lead that nothing is written until the owner answers", () => {
    expect(reconcileForm({ report: report() })["lead"]).toBe("Nothing is written until you answer.");
  });

  it("caps the table at the artifact's own row limit rather than emitting an invalid card", () => {
    const many = Array.from({ length: 40 }, (_unused, index) => proposal({ subject: `EXA-${String(index)}` }));
    const items = reconcileForm({ report: report({ proposals: many }) })["items"];
    expect(Array.isArray(items)).toBe(true);
    expect((items as readonly unknown[]).length).toBe(TABLE_MAX_ROWS);
    expect(TABLE_MAX_ROWS).toBe(10);
  });

  it("carries every proposal's one-word replies into the below-fold paragraph", () => {
    expect(JSON.stringify(reconcileForm({ report: report() }))).toContain("Reply `close`, `keep`, `later`.");
  });
});

describe("reconcileLines", () => {
  it("ends every report by stating that nothing was sent or closed", () => {
    const lines = reconcileLines({ report: report() });
    expect(lines.at(-1)).toBe(
      "  nothing was sent and nothing was closed in Linear or GitHub — this verb only ever proposes",
    );
  });

  it("says so plainly when there is nothing to propose", () => {
    const lines = reconcileLines({ report: report({ proposals: [] }) });
    expect(lines).toContain("  nothing to propose — no stale item and no overdue project update");
  });

  it("prints what the pass could not see", () => {
    const lines = reconcileLines({ report: report({ couldNotSee: ["a stated gap"] }) });
    expect(lines).toContain("      · a stated gap");
  });
});

describe("cycleReconcileCommand", () => {
  it("is wired as a dispatchable verb the manifest can load", async () => {
    expect(await cycleReconcileCommand(["node", "cli", "cycle", "reconcile", "--help"])).toBe(0);
  });
});

describe("parseReconcileOptions", () => {
  const defaultHome = "/tmp/default";

  it("defaults to the human report over the given home", () => {
    const parsed = unwrap(parseReconcileOptions({ defaultHome, rest: [] }));
    expect(parsed.home).toBe(defaultHome);
    expect(parsed.json).toBe(false);
    expect(parsed.form).toBe(false);
    expect(parsed.verify).toBe(false);
  });

  it("takes --home and --now", () => {
    const parsed = unwrap(
      parseReconcileOptions({ defaultHome, rest: ["--home", "/tmp/other", "--now", "2026-09-01T00:00:00.000Z"] }),
    );
    expect(parsed.home).toBe("/tmp/other");
    expect(parsed.nowIso).toBe("2026-09-01T00:00:00.000Z");
  });

  it("refuses --json and --form together, which are different output modes", () => {
    const parsed = parseReconcileOptions({ defaultHome, rest: ["--json", "--form"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toBe("--json and --form are different output modes; pass one");
  });

  it("refuses --post without --dry-run, because this verb never sends", () => {
    const parsed = parseReconcileOptions({ defaultHome, rest: ["--post"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("slopweaver slack post");
  });

  it("accepts --post with --dry-run", () => {
    const parsed = unwrap(parseReconcileOptions({ defaultHome, rest: ["--post", "--dry-run"] }));
    expect(parsed.post).toBe(true);
    expect(parsed.dryRun).toBe(true);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseReconcileOptions({ defaultHome, rest: ["--close-everything"] }))).toEqual([
      "unknown flag: --close-everything",
    ]);
  });
});

describe("cycle reconcile --write", () => {
  const defaultHome = "/tmp/default";
  const homes: string[] = [];

  afterEach(() => {
    homes.splice(0).forEach((home) => {
      rmSync(home, { force: true, recursive: true });
    });
  });

  /** A fresh home, removed after the test. */
  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "cyc-"));
    homes.push(home);
    return home;
  }

  it("parses --write independently of the output mode", () => {
    expect(unwrap(parseReconcileOptions({ defaultHome, rest: [] })).write).toBe(false);
    const both = unwrap(parseReconcileOptions({ defaultHome, rest: ["--form", "--write"] }));
    expect(both.write).toBe(true);
    expect(both.form).toBe(true);
  });

  it("advertises --write on the parser's own flag list, which the help-truth ratchet reads", () => {
    expect(CYCLE_RECONCILE_FLAG_NAMES).toContain("--write");
  });

  it("publishes exactly the --json bytes plus one terminal newline", () => {
    const home = freshHome();
    const written = unwrap(publishCycleReconcile({ home, report: report() }));
    expect(written).toBe(join(home, "live", "hygiene", "cycle-reconcile.json"));
    expect(readFileSync(written, "utf8")).toBe(`${cycleReconcileJson({ report: report() })}\n`);
    expect(cycleReconcileJson({ report: report() })).toBe(JSON.stringify(report(), null, 2));
  });

  it("replaces yesterday's document whole with today's", () => {
    const home = freshHome();
    unwrap(publishCycleReconcile({ home, report: report({ proposals: [proposal(), proposal()] }) }));
    const today = report({ proposals: [] });
    const written = unwrap(publishCycleReconcile({ home, report: today }));
    expect(readFileSync(written, "utf8")).toBe(`${JSON.stringify(today, null, 2)}\n`);
  });

  it("refuses, naming the path, when the document cannot be replaced", () => {
    const home = freshHome();
    const path = join(home, "live", "hygiene", "cycle-reconcile.json");
    mkdirSync(path, { recursive: true });
    expect(unwrapErr(publishCycleReconcile({ home, report: report() }))[0]).toContain(
      `hygiene document ${path} was not replaced, and the previous one stands:`,
    );
  });
});
