/**
 * What `handover start` says about a run opening with no behavioural probe, and what it refuses outright.
 *
 * The probe gap WARNS here rather than refusing, and the number is the whole argument: measured:
 * 158 of the board's 301 `ready` docs would be refused at `start` the instant a refusal landed. `finish`
 * still refuses, unchanged — what moves is when the session is told.
 *
 * The parse fault DOES refuse, and its blast radius was three docs, every one of them already broken.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isContextError, runContext, startRun } from "../../../cli/commands/handover/lifecycle.js";
import { openRunProbeGapLines } from "../../../cli/commands/handover/startGates.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";

// register-class: probe-missing-or-malformed-at-write-time (docs/recurring-failure-register/bindings.md)

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => {
    cleanup();
  });
});

/** One doc parsed from front matter, with no filesystem beyond the path it is told it has. */
function docWith({ frontMatter }: { frontMatter: string }) {
  return parseHandoverDoc({
    path: "/board/a-doc.md",
    text: `---\nslug: a-doc\nstatus: ready\nblockedBy: []\n${frontMatter}\n---\n# body\n`,
  });
}

/** A temp handovers dir holding one doc, plus an empty runs dir alongside it. */
function fixture({ frontMatter }: { frontMatter: string }): { handoverDir: string; runsDir: string; slug: string } {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-openrun-"));
  const handoverDir = join(root, "handovers");
  const runsDir = join(root, "runs");
  const slug = "a-doc";
  mkdirSync(handoverDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(handoverDir, `${slug}.md`), `---\nslug: ${slug}\n${frontMatter}\n---\n# doc\n`);
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return { handoverDir, runsDir, slug };
}

describe("openRunProbeGapLines", () => {
  it("names the finding and both remedies when the doc declares no probe at all", () => {
    const lines = openRunProbeGapLines({ doc: docWith({ frontMatter: 'summary: "does a thing"\ndoneWhen: []' }) });
    expect(lines[0]).toBe(
      "handover start: open-run-declares-no-probe — a-doc declares no probe that would fail if its claim were false.",
    );
    expect(lines[1]).toContain("`handover finish` REFUSES this");
    expect(lines[4]).toContain("probeWaiver:");
    expect(lines[4]).toContain("/board/a-doc.md");
  });

  it("warns on a structural-only probe too, because shape passing is what the rule is about", () => {
    const lines = openRunProbeGapLines({
      doc: docWith({ frontMatter: 'summary: "does a thing"\ndoneWhen:\n  - path: src/thing.ts' }),
    });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("open-run-declares-no-probe");
  });

  it("names the owner-ask phrase when the summary quotes one, which changes what the author owes", () => {
    const lines = openRunProbeGapLines({
      doc: docWith({ frontMatter: 'summary: "the owner asked for this to stop happening"\ndoneWhen: []' }),
    });
    expect(lines[0]).toContain("records an owner ask");
  });

  it("prints a waived doc as ONE line rather than staying silent about it", () => {
    const lines = openRunProbeGapLines({
      doc: docWith({
        frontMatter: 'summary: "a Notion page"\ndoneWhen: []\nprobeWaiver: "the deliverable is a Notion page"',
      }),
    });
    expect(lines).toStrictEqual([
      "handover start: open-run-declares-no-probe — WAIVED: the deliverable is a Notion page",
    ]);
  });

  it("says nothing at all when the doc already declares a behavioural probe", () => {
    const lines = openRunProbeGapLines({
      doc: docWith({ frontMatter: 'summary: "does a thing"\ndoneWhen:\n  - command: slopweaver store read --dry-run' }),
    });
    expect(lines).toStrictEqual([]);
  });
});

describe("startRun on a doc whose front matter did not parse", () => {
  it("REFUSES, rather than opening a run whose probes were never read", () => {
    const { handoverDir, runsDir, slug } = fixture({
      frontMatter: 'status: ready\nsummary: "x"\ndoneWhen:\n  - path: /abs/package.json',
    });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }
    expect(context.doc.problems).toHaveLength(1);
    const code = startRun({
      all: [context.doc],
      branch: "work",
      context,
      dependencyDone: () => false,
      home: dirname(runsDir),
      nowIso: "2026-09-02T00:00:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).not.toBe(EXIT_OK);
  });

  it("still OPENS a probeless doc, because the gap warns and never blocks", () => {
    const { handoverDir, runsDir, slug } = fixture({ frontMatter: 'status: ready\nsummary: "x"\ndoneWhen: []' });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }
    const code = startRun({
      all: [context.doc],
      branch: "work",
      context,
      dependencyDone: () => false,
      home: dirname(runsDir),
      nowIso: "2026-09-02T00:00:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).toBe(EXIT_OK);
  });
});
