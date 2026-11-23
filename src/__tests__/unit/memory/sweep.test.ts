/**
 * The triage view.
 *
 * Two properties get the most attention here, because both are the kind of defect that passes a naive test:
 *
 *  - **the two age sources are never blended.** A leaf that declares `metadata.modified` AND has a filesystem
 *    mtime is given two timestamps far apart, so an implementation that quietly preferred the wrong one — or
 *    averaged them, or dropped the label — produces a different number and fails.
 *  - **the inbound-link count is exact.** One leaf is linked from two others (one of them twice) and from
 *    itself; the others from nobody. Asserting `2` and `0` rather than "greater than zero" is what makes a
 *    per-occurrence count, a self-counting count and an always-zero count all fail.
 *
 * Everything in the fixture is invented. This is a public repository, and a fixture is the easiest place for a
 * private string to arrive unnoticed.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkMemoryCorpus } from "../../../memory/check.js";
import { buildMemoryCorpus } from "../../../memory/corpus.js";
import { readMemoryCorpus } from "../../../memory/store.js";
import { sweepMemoryCorpus } from "../../../memory/sweep.js";
import { renderMemorySweepHuman, renderMemorySweepJson } from "../../../memory/sweepRender.js";
import type { MemorySourceFile } from "../../../memory/types.js";
import { parseOwnJson } from "../../parseOwnJson.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** The clock every age below is measured against. Fixed, so a day never rolls over mid-suite. */
const NOW = Date.parse("2026-03-02T00:00:00.000Z");

/** Sixty days before {@link NOW} across a non-leap February. */
const SIXTY_DAYS_AGO = "2026-01-01T00:00:00.000Z";

/** Twenty-nine days before {@link NOW}. */
const TWENTY_NINE_DAYS_AGO = Date.parse("2026-02-01T00:00:00.000Z");

/** One day before {@link NOW} — the mtime `hub.md` must NOT be aged by, since it declares `modified`. */
const ONE_DAY_AGO = Date.parse("2026-03-01T00:00:00.000Z");

const ROOT = `# Index

- [Hub](hub.md) — the one everything points at
- [Side](INDEX-side.md) — a topic index
`;

const SIDE = `# Side

- [Edge](edge.md) — routed only from here
`;

/** Declares `modified`, so its age must come from the field and not from its (much newer) mtime. */
const HUB = `---
name: hub
description: the memory several others depend on
metadata:
  type: reference
  modified: ${SIXTY_DAYS_AGO}
---

Nothing here links out. A self-reference to [[hub]] must not count as inbound.
`;

/** No `modified`, so its age must come from mtime — and it links to the hub TWICE, which is still one linker. */
const EDGE = `---
name: edge
description: routed from the topic index only
metadata:
  type: project
---

See [[hub]], and again [[hub]].
`;

/** No `modified` and no mtime, so it can say nothing about its age — which the row must state, not guess. */
const LONELY = `---
name: lonely
description: nothing routes this one
metadata:
  type: feedback
---

Also see [[hub]].
`;

/** Unrouted AND old: the row that proves `--stale-after` reorders rather than filters. */
const ANCIENT = `---
name: ancient
description: unrouted and long untouched
metadata:
  type: user
  modified: 2025-01-01T00:00:00.000Z
---

Nothing to see.
`;

/**
 * The corpus. `hub.md` gets both a declared date and a conflicting mtime; `edge.md` gets an mtime only;
 * `lonely.md` and `ancient.md` get no mtime at all, which is what a caller with text but no file looks like.
 */
function fixture(): readonly MemorySourceFile[] {
  return [
    { file: "MEMORY.md", text: ROOT },
    { file: "INDEX-side.md", text: SIDE },
    { file: "hub.md", mtimeMs: ONE_DAY_AGO, text: HUB },
    { file: "edge.md", mtimeMs: TWENTY_NINE_DAYS_AGO, text: EDGE },
    { file: "lonely.md", text: LONELY },
    { file: "ancient.md", text: ANCIENT },
  ];
}

/** The sweep of {@link fixture}, at {@link NOW}. */
function sweepFixture({ staleAfterDays }: { staleAfterDays: number | null }): ReturnType<typeof sweepMemoryCorpus> {
  return sweepMemoryCorpus({ corpus: buildMemoryCorpus({ files: fixture() }), now: NOW, staleAfterDays });
}

describe("age, and the source it came from", () => {
  it("ages a leaf that declares `modified` from the field, never from its mtime", () => {
    const row = sweepFixture({ staleAfterDays: null }).rows.find((r) => r.file === "hub.md")!;

    expect(row.ageSource).toBe("declared");
    // 60 from the declared field. Its mtime is one day old, so a blend of any kind lands somewhere else.
    expect(row.ageDays).toBe(60);
    expect(row.declaredModifiedIso).toBe(SIXTY_DAYS_AGO);
    expect(row.fileModifiedIso).toBe("2026-03-01T00:00:00.000Z");
  });

  it("ages a leaf with no declared field from its mtime, and labels it as such", () => {
    const row = sweepFixture({ staleAfterDays: null }).rows.find((r) => r.file === "edge.md")!;

    expect(row.ageSource).toBe("mtime");
    expect(row.ageDays).toBe(29);
    expect(row.declaredModifiedIso).toBe(null);
    expect(row.fileModifiedIso).toBe("2026-02-01T00:00:00.000Z");
  });

  it("reports no age at all rather than inventing one, when a leaf has neither source", () => {
    const row = sweepFixture({ staleAfterDays: null }).rows.find((r) => r.file === "lonely.md")!;

    expect(row.ageSource).toBe("none");
    expect(row.ageDays).toBe(null);
    expect(row.declaredModifiedIso).toBe(null);
    expect(row.fileModifiedIso).toBe(null);
  });

  it("falls through to mtime when the declared value is not a timestamp, and says mtime", () => {
    const files = fixture().map((f) => (f.file === "hub.md" ? { ...f, text: HUB.replace(SIXTY_DAYS_AGO, "soon") } : f));

    const row = sweepMemoryCorpus({ corpus: buildMemoryCorpus({ files }), now: NOW, staleAfterDays: null }).rows.find(
      (r) => r.file === "hub.md",
    )!;

    expect(row.ageSource).toBe("mtime");
    expect(row.ageDays).toBe(1);
    // The unreadable value is still reported verbatim rather than swallowed — it is the evidence.
    expect(row.declaredModifiedIso).toBe("soon");
  });

  it("keeps a future timestamp negative rather than flooring it to zero", () => {
    const files = fixture().map((f) =>
      f.file === "hub.md" ? { ...f, text: HUB.replace(SIXTY_DAYS_AGO, "2026-03-12T00:00:00.000Z") } : f,
    );

    const row = sweepMemoryCorpus({ corpus: buildMemoryCorpus({ files }), now: NOW, staleAfterDays: null }).rows.find(
      (r) => r.file === "hub.md",
    )!;

    expect(row.ageDays).toBe(-10);
  });
});

describe("inbound links", () => {
  it("counts distinct linking memories, not occurrences, and never the leaf itself", () => {
    const rows = sweepFixture({ staleAfterDays: null }).rows;

    // edge.md links twice, lonely.md once, hub.md to itself. Two OTHER memories depend on it.
    expect(rows.find((r) => r.file === "hub.md")!.inboundLinks).toBe(2);
  });

  it("counts zero for a leaf nothing links to", () => {
    const rows = sweepFixture({ staleAfterDays: null }).rows;

    expect(rows.find((r) => r.file === "edge.md")!.inboundLinks).toBe(0);
    expect(rows.find((r) => r.file === "lonely.md")!.inboundLinks).toBe(0);
    expect(rows.find((r) => r.file === "ancient.md")!.inboundLinks).toBe(0);
  });

  it("resolves a link written against the declared name as well as the filename stem", () => {
    const files = [
      { file: "MEMORY.md", text: "# Index\n\n- [Target](build_command.md) — a leaf\n" },
      {
        file: "build_command.md",
        text: "---\nname: build-command\ndescription: a leaf whose name and filename differ\n---\n\nBody.\n",
      },
      {
        file: "caller.md",
        text: "---\nname: caller\ndescription: links by declared name\n---\n\nSee [[build-command]].\n",
      },
    ];

    const sweep = sweepMemoryCorpus({ corpus: buildMemoryCorpus({ files }), now: NOW, staleAfterDays: null });

    expect(sweep.rows.find((r) => r.file === "build_command.md")!.inboundLinks).toBe(1);
  });
});

describe("what a row carries", () => {
  it("carries the description, the type and the routing index", () => {
    const row = sweepFixture({ staleAfterDays: null }).rows.find((r) => r.file === "edge.md")!;

    expect(row.name).toBe("edge");
    expect(row.description).toBe("routed from the topic index only");
    expect(row.declaredType).toBe("project");
    expect(row.routedBy).toEqual(["INDEX-side.md"]);
  });

  it("reports an unrouted leaf as routed by nothing", () => {
    expect(sweepFixture({ staleAfterDays: null }).rows.find((r) => r.file === "lonely.md")!.routedBy).toEqual([]);
  });

  it("surfaces the checker's findings on the row rather than in a second tool's output", () => {
    const row = sweepFixture({ staleAfterDays: null }).rows.find((r) => r.file === "lonely.md")!;

    expect(row.findings.map((f) => f.check)).toEqual(["orphan"]);
  });

  it("carries no findings for a leaf the checker has nothing to say about", () => {
    const row = sweepFixture({ staleAfterDays: null }).rows.find((r) => r.file === "edge.md")!;

    expect(row.findings).toEqual([]);
  });
});

describe("a leaf whose frontmatter is broken", () => {
  /** A memory with nothing usable in its envelope — routed, so it is not merely an orphan. */
  function brokenCorpus(): ReturnType<typeof buildMemoryCorpus> {
    return buildMemoryCorpus({
      files: [
        { file: "MEMORY.md", text: "# Index\n\n- [Broken](broken.md) — a leaf with no frontmatter\n" },
        { file: "broken.md", mtimeMs: TWENTY_NINE_DAYS_AGO, text: "Just a body, no envelope at all.\n" },
      ],
    });
  }

  it("still appears, named by its filename stem, rather than dropping out of the review", () => {
    const row = sweepMemoryCorpus({ corpus: brokenCorpus(), now: NOW, staleAfterDays: null }).rows[0]!;

    expect(row.name).toBe("broken");
    expect(row.description).toBeNull();
    expect(row.declaredType).toBeNull();
    // Root-routed, so its missing Why paragraph is reported beside the broken envelope, in registry order.
    expect(row.findings.map((f) => f.check)).toEqual(["schema", "why-always-loaded-missing"]);
    expect(row.findings[0]!.message).toBe("frontmatter is missing or never closed");
  });

  it("says what is absent instead of printing a blank that reads as empty", () => {
    const lines = renderMemorySweepHuman({
      sweep: sweepMemoryCorpus({ corpus: brokenCorpus(), now: NOW, staleAfterDays: null }),
    });

    expect(lines[4]).toBe("    broken  [no type]  29d mtime  ←0  (broken.md)");
    expect(lines[5]).toBe("      (no description — retrieval has nothing to match on)");
  });
});

describe("agreeing with `memory check`", () => {
  it("covers exactly the leaves the checker judges", () => {
    const corpus = buildMemoryCorpus({ files: fixture() });

    const swept = sweepMemoryCorpus({ corpus, now: NOW, staleAfterDays: null })
      .rows.map((r) => r.file)
      .toSorted();

    expect(swept).toEqual(["ancient.md", "edge.md", "hub.md", "lonely.md"]);
    expect(swept).toEqual(corpus.leaves.map((l) => l.file).toSorted());
  });

  it("marks as unrouted exactly the leaves the checker calls orphans", () => {
    const corpus = buildMemoryCorpus({ files: fixture() });

    const orphanedByCheck = checkMemoryCorpus({ corpus })
      .filter((f) => f.check === "orphan")
      .map((f) => f.file)
      .toSorted();
    const unroutedBySweep = sweepMemoryCorpus({ corpus, now: NOW, staleAfterDays: null })
      .rows.filter((r) => r.routedBy.length === 0)
      .map((r) => r.file)
      .toSorted();

    expect(unroutedBySweep).toEqual(["ancient.md", "lonely.md"]);
    expect(unroutedBySweep).toEqual(orphanedByCheck);
  });
});

describe("ordering, and --stale-after", () => {
  it("groups by routing index — root first, then topic, then unrouted — with no threshold set", () => {
    expect(sweepFixture({ staleAfterDays: null }).rows.map((r) => r.file)).toEqual([
      "hub.md",
      "edge.md",
      "ancient.md",
      "lonely.md",
    ]);
  });

  it("marks nothing when no threshold is set", () => {
    expect(
      sweepFixture({ staleAfterDays: null })
        .rows.filter((r) => r.stale)
        .map((r) => r.file),
    ).toEqual([]);
  });

  it("moves stale rows to the front WITHOUT dropping anything", () => {
    const sweep = sweepFixture({ staleAfterDays: 30 });

    // ancient.md is unrouted, so it sorts last by default; being stale lifts it above edge.md.
    expect(sweep.rows.map((r) => r.file)).toEqual(["hub.md", "ancient.md", "edge.md", "lonely.md"]);
    expect(sweep.rows.filter((r) => r.stale).map((r) => r.file)).toEqual(["hub.md", "ancient.md"]);
    expect(sweep.rows.length).toBe(4);
  });

  it("never marks a leaf whose age is unknown", () => {
    expect(sweepFixture({ staleAfterDays: 0 }).rows.find((r) => r.file === "lonely.md")!.stale).toBe(false);
  });

  it("marks a row exactly at the threshold", () => {
    expect(sweepFixture({ staleAfterDays: 29 }).rows.find((r) => r.file === "edge.md")!.stale).toBe(true);
    expect(sweepFixture({ staleAfterDays: 30 }).rows.find((r) => r.file === "edge.md")!.stale).toBe(false);
  });
});

describe("a directory that is not a memory corpus", () => {
  it("lays out nothing and says why, rather than listing whatever markdown it found", () => {
    const files = fixture().filter((f) => f.file !== "MEMORY.md");

    const sweep = sweepMemoryCorpus({ corpus: buildMemoryCorpus({ files }), now: NOW, staleAfterDays: null });

    expect(sweep.rootIndexMissing).toBe(true);
    expect(sweep.rows).toEqual([]);
    expect(renderMemorySweepHuman({ sweep })).toEqual([
      "memory sweep: no MEMORY.md in this directory — it is not a memory corpus, so there is nothing to lay out",
    ]);
  });
});

describe("the human report", () => {
  it("writes each age with the source that produced it, so no number stands unlabelled", () => {
    const lines = renderMemorySweepHuman({ sweep: sweepFixture({ staleAfterDays: null }) });

    expect(lines.filter((line) => line.includes("60d declared")).length).toBe(1);
    expect(lines.filter((line) => line.includes("29d mtime")).length).toBe(1);
    expect(lines.filter((line) => line.includes("age unknown")).length).toBe(1);
    // The bare number must never appear without a source beside it.
    expect(lines.filter((line) => /\b60d(?! declared)/.test(line)).length).toBe(0);
  });

  it("tallies the sources in the header before a single row is read", () => {
    const lines = renderMemorySweepHuman({ sweep: sweepFixture({ staleAfterDays: null }) });

    expect(lines[0]).toBe(
      "memory sweep: 4 memories — age 2 by `modified`, 1 by file mtime, 1 by no date at all; no --stale-after set",
    );
  });

  it("says how many rows the threshold marked", () => {
    const lines = renderMemorySweepHuman({ sweep: sweepFixture({ staleAfterDays: 30 }) });

    expect(lines[0]).toBe(
      "memory sweep: 4 memories — age 2 by `modified`, 1 by file mtime, 1 by no date at all; 2 marked ★ at 30+ days, listed first",
    );
  });

  it("groups rows under the index that routes them, and names the unrouted group", () => {
    const lines = renderMemorySweepHuman({ sweep: sweepFixture({ staleAfterDays: null }) });

    expect(lines.filter((line) => line.startsWith("── "))).toEqual([
      "── routed by MEMORY.md",
      "── routed by INDEX-side.md",
      "── routed by nothing",
    ]);
  });

  it("prints the description in full and the checker's finding under the row it belongs to", () => {
    const lines = renderMemorySweepHuman({ sweep: sweepFixture({ staleAfterDays: null }) });
    const at = lines.findIndex((line) => line.includes("(lonely.md)"));

    expect(lines[at + 1]).toBe("      nothing routes this one");
    expect(lines[at + 2]).toBe(
      "      ⚠ [orphan] no index points at this memory — it is only reachable if its description happens to match",
    );
  });
});

describe("the JSON shape", () => {
  it("carries both timestamps on every row, so a consumer can answer either question", () => {
    const decoded = parseOwnJson<ReturnType<typeof sweepMemoryCorpus>>({
      text: renderMemorySweepJson({ sweep: sweepFixture({ staleAfterDays: 30 }) }),
    });
    const hub = decoded.rows.find((r) => r.file === "hub.md")!;

    expect(decoded.staleAfterDays).toBe(30);
    expect(decoded.rootIndexMissing).toBe(false);
    expect(hub.declaredModifiedIso).toBe(SIXTY_DAYS_AGO);
    expect(hub.fileModifiedIso).toBe("2026-03-01T00:00:00.000Z");
    expect(hub.ageSource).toBe("declared");
  });
});

describe("mtime, read off a real filesystem", () => {
  it("reaches the row from the file's inode, not from anything in the text", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-sweep-"));
    fixtureDirs.push(dir);
    writeFileSync(join(dir, "MEMORY.md"), "# Index\n\n- [Undated](undated.md) — a leaf\n", "utf8");
    writeFileSync(
      join(dir, "undated.md"),
      "---\nname: undated\ndescription: no modified field anywhere in it\n---\n\nBody.\n",
      "utf8",
    );
    const seconds = TWENTY_NINE_DAYS_AGO / 1000;
    utimesSync(join(dir, "undated.md"), seconds, seconds);

    const read = readMemoryCorpus({ dir });
    const sweep = sweepMemoryCorpus({ corpus: read._unsafeUnwrap(), now: NOW, staleAfterDays: null });

    expect(read.isOk()).toBe(true);
    expect(sweep.rows.find((r) => r.file === "undated.md")!.ageSource).toBe("mtime");
    expect(sweep.rows.find((r) => r.file === "undated.md")!.ageDays).toBe(29);
  });
});
