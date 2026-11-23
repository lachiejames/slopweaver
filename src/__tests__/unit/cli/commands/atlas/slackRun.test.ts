import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { HuddleRow, UnreadableWindow } from "../../../../../atlas/slack.js";
import type { AtlasSlackDeps } from "../../../../../cli/commands/atlas/slackRun.js";
import { readThreadCursors, runAtlasSlack } from "../../../../../cli/commands/atlas/slackRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { StructureBronzeRow } from "../../../../../corpus/structures/types.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

/** Every scratch home this file minted, removed after each test — see `testing.md` § temp-dir cleanup. */
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, registered for cleanup. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-atlas-"));
  homes.push(home);
  return home;
}

/** A Slack channel structure row. */
function row({
  id,
  isMember,
  isPrivate = false,
}: {
  id: string;
  isMember: boolean;
  isPrivate?: boolean;
}): StructureBronzeRow {
  return {
    attrs: { archived: false, isMember, private: isPrivate },
    fetchedAtIso: "2026-08-08T00:00:00.000Z",
    identity: { name: id.toLowerCase(), nativeId: id },
    kind: "channel",
    provenance: ["slack.conversations.list"],
    raw: {},
    relations: [],
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/** The injected edges, with collectors for what the verb wrote. */
function harness({
  rows = [row({ id: "C1", isMember: true }), row({ id: "C2", isMember: false, isPrivate: true })],
  cursors = new Map<string, string>(),
  ingested = new Map<string, string>(),
  huddles = [],
  warnings = [],
  unreadableWindows = [],
}: {
  rows?: readonly StructureBronzeRow[];
  cursors?: ReadonlyMap<string, string>;
  ingested?: ReadonlyMap<string, string>;
  huddles?: readonly HuddleRow[];
  warnings?: readonly string[];
  unreadableWindows?: readonly UnreadableWindow[];
} = {}) {
  const out: string[] = [];
  const diag: string[] = [];
  // Typed as the contract so the callback parameters INHERIT their types rather than restating them —
  // which is what `named-object-params` asks for, and is checked by the compiler rather than by a marker.
  const deps: AtlasSlackDeps = {
    bronzeScan: () => ({ huddles, readTo: ingested, unreadableWindows }),
    structureRows: () => ({ rows, warnings }),
    threadCursors: () => cursors,
    writeDiagnostic: (line) => {
      diag.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diag, out };
}

describe("runAtlasSlack", () => {
  it("prints the map and exits OK", () => {
    const h = harness();

    const code = runAtlasSlack({ deps: h.deps, rest: [] });

    expect(code).toBe(EXIT_OK);
    expect(h.out.join("\n")).toContain("slack atlas: 2 conversation(s) known");
    expect(h.out.join("\n")).toContain("expected readable        : 1 of 2");
  });

  it("emits ONE parseable JSON document under --json", () => {
    const h = harness();

    runAtlasSlack({ deps: h.deps, rest: ["--json"] });

    expect(h.out.length).toBe(1);
    const parsed = parseOwnJson<{ counts: { total: number } }>({ text: h.out[0]! });
    expect(parsed.counts.total).toBe(2);
  });

  it("keeps diagnostics OFF the data channel, so a pipe sees only the document", () => {
    const h = harness({ warnings: ["a store warning"] });

    runAtlasSlack({ deps: h.deps, rest: ["--json"] });

    expect(h.out.join("")).not.toContain("a store warning");
    expect(h.diag.join(" ")).toContain("a store warning");
  });

  it("refuses an unknown flag with usage, before reading anything", () => {
    const h = harness();

    const code = runAtlasSlack({ deps: h.deps, rest: ["--nope"] });

    expect(code).toBe(EXIT_USAGE);
    expect(h.diag.join(" ")).toContain("usage: slopweaver atlas slack");
  });

  it("says what to run when no channels are known, rather than printing an empty map", () => {
    const h = harness({ rows: [] });

    const code = runAtlasSlack({ deps: h.deps, rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(h.diag.join(" ")).toContain("refresh --source slack");
  });

  it("lists only the readable, never-looked-at channels under --never-read", () => {
    const h = harness();

    runAtlasSlack({ deps: h.deps, rest: ["--never-read"] });

    const printed = h.out.join("\n");
    expect(printed).toContain("readable, live, never looked at (1) — joined first:");
    expect(printed).toContain("C1");
    expect(printed).not.toContain("C2  ");
  });

  it("turns a thread cursor into the read-to timestamp a re-read consumes", () => {
    const h = harness({ cursors: new Map([["C1:1785000000.000001", "1785913155.614319"]]) });

    runAtlasSlack({ deps: h.deps, rest: ["--json"] });

    const parsed = parseOwnJson<{ channels: { id: string; coverage: { ts?: string } }[] }>({ text: h.out[0]! });
    expect(parsed.channels.find((c) => c.id === "C1")!.coverage.ts).toBe("1785913155.614319");
  });
});

describe("an unreadable bronze window", () => {
  // The defect: `atlas slack` printed `<n> conversation(s) known / ever read <m>` over the two window files
  // it could read and silently dropped a multi-gigabyte compacted one holding 99.9% of the corpus. Every assertion
  // here is on a line that did not exist then — the shortfall is the witness the silent version had none of.
  const window: UnreadableWindow = {
    file: "compact.jsonl",
    message: "Cannot create a string longer than 0x1fffffe8 characters",
  };

  it("marks the headline PARTIAL and names the window, rather than printing the census bare", () => {
    const h = harness({ unreadableWindows: [window] });

    const code = runAtlasSlack({ deps: h.deps, rest: [] });

    const printed = h.out.join("\n");
    expect(code).toBe(EXIT_OK);
    expect(printed).toContain("slack atlas: 2 conversation(s) known  <- PARTIAL, see SHORTFALL below");
    expect(printed).toContain("SHORTFALL: 1 bronze window(s) could NOT be read");
    expect(printed).toContain("  compact.jsonl — Cannot create a string longer than 0x1fffffe8 characters");
  });

  it("says neither thing when every window read, so the marker means what it says", () => {
    const h = harness();

    runAtlasSlack({ deps: h.deps, rest: [] });

    const printed = h.out.join("\n");
    expect(printed).toContain("slack atlas: 2 conversation(s) known");
    expect(printed).not.toContain("PARTIAL");
    expect(printed).not.toContain("SHORTFALL");
  });

  it("carries the shortfall in the --json document, which is what another program reads", () => {
    const h = harness({ unreadableWindows: [window] });

    runAtlasSlack({ deps: h.deps, rest: ["--json"] });

    const parsed = parseOwnJson<{ unreadableWindows: UnreadableWindow[] }>({ text: h.out[0]! });
    expect(parsed.unreadableWindows).toEqual([window]);
  });

  it("emits an empty shortfall under --json rather than omitting the field", () => {
    // Present-and-empty, so a consumer reading `unreadableWindows.length` tells "checked, none" apart from
    // "this build did not check" — the same reason the headline states all four counts unconditionally.
    const h = harness();

    runAtlasSlack({ deps: h.deps, rest: ["--json"] });

    const parsed = parseOwnJson<{ unreadableWindows: UnreadableWindow[] }>({ text: h.out[0]! });
    expect(parsed.unreadableWindows).toEqual([]);
  });

  it("also warns on STDERR, so a pipeline reading only the fields it wants still sees it", () => {
    const h = harness({ unreadableWindows: [window] });

    runAtlasSlack({ deps: h.deps, rest: ["--json"] });

    expect(h.diag.join(" ")).toContain(
      "bronze window unreadable: compact.jsonl — Cannot create a string longer than 0x1fffffe8 characters",
    );
  });
});

describe("coverage sources", () => {
  it("counts a channel INGESTED without threads as read — the cursor store alone misses it", () => {
    // The defect this fixes, found by running the tool: three alert channels the owner is a MEMBER of were
    // reported never-read. Alert channels are top-level-only, so they never gain a thread cursor, and two of
    // the three had in fact been ingested.
    const h = harness({ ingested: new Map([["C1", "1785913155.614319"]]) });

    runAtlasSlack({ deps: h.deps, rest: ["--json"] });

    const parsed = parseOwnJson<{ counts: { everRead: number } }>({ text: h.out[0]! });
    expect(parsed.counts.everRead).toBe(1);
  });

  it("takes the NEWER of the two sources, so neither can understate coverage", () => {
    const h = harness({
      cursors: new Map([["C1:1785000000.000001", "1785000000.000002"]]),
      ingested: new Map([["C1", "1786000000.000009"]]),
    });

    runAtlasSlack({ deps: h.deps, rest: ["--json"] });

    const parsed = parseOwnJson<{ channels: { id: string; coverage: { ts?: string } }[] }>({ text: h.out[0]! });
    expect(parsed.channels.find((c) => c.id === "C1")!.coverage.ts).toBe("1786000000.000009");
  });
});

describe("readThreadCursors", () => {
  it("reads the cursor file the refresh lane maintains", () => {
    const home = scratchHome();
    const path = stateHomePaths({ home }).corpus.slackThreads;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ "C1:1.000001": "2.000002" }));

    expect(readThreadCursors({ home }).get("C1:1.000001")).toBe("2.000002");
  });

  it("returns EMPTY for an absent file, which understates coverage rather than inventing it", () => {
    const home = scratchHome();

    expect(readThreadCursors({ home }).size).toBe(0);
  });

  it("returns EMPTY for a corrupt file rather than throwing mid-report", () => {
    const home = scratchHome();
    const path = stateHomePaths({ home }).corpus.slackThreads;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");

    expect(readThreadCursors({ home }).size).toBe(0);
  });
});
