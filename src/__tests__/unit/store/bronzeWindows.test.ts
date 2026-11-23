import { describe, expect, it } from "vitest";

import type { BronzeFileStat } from "../../../corpus/bronzeStorage.js";
import { bronzeBytes, planBronzeWindows } from "../../../store/bronzeWindows.js";

const HOME = "/home";

/** Bronze read order for a source: the canonical file first, then window files by name. */
const FILES: readonly BronzeFileStat[] = [
  { bytes: 6899158625, path: "/home/corpus/bronze/slack/compact.jsonl" },
  { bytes: 10, path: "/home/corpus/bronze/slack/2026-09-15_2026-09-20.jsonl" },
  { bytes: 20, path: "/home/corpus/bronze/slack/2026-09-20_2026-09-21.jsonl" },
];

describe("planBronzeWindows", () => {
  it("omits the canonical file under the windows scope and keeps read order", () => {
    const plan = planBronzeWindows({ files: FILES, home: HOME, scope: "windows", source: "slack" });
    expect(plan.read.map((file) => file.path)).toEqual([
      "/home/corpus/bronze/slack/2026-09-15_2026-09-20.jsonl",
      "/home/corpus/bronze/slack/2026-09-20_2026-09-21.jsonl",
    ]);
    expect(plan.omitted.map((file) => file.path)).toEqual(["/home/corpus/bronze/slack/compact.jsonl"]);
  });

  it("reads everything under the full scope, omitting nothing", () => {
    const plan = planBronzeWindows({ files: FILES, home: HOME, scope: "full", source: "slack" });
    expect(plan.read).toEqual(FILES);
    expect(plan.omitted).toEqual([]);
  });

  it("keeps a NESTED compact.jsonl, because only the source's own canonical path is the omitted one", () => {
    // Bronze listing is recursive. Dropping by basename would omit real records while reporting the
    // omission as the canonical file — a coverage loss disguised as a cost decision.
    const nested: readonly BronzeFileStat[] = [
      { bytes: 5, path: "/home/corpus/bronze/slack/compact.jsonl" },
      { bytes: 7, path: "/home/corpus/bronze/slack/archive/compact.jsonl" },
    ];
    const plan = planBronzeWindows({ files: nested, home: HOME, scope: "windows", source: "slack" });
    expect(plan.read.map((file) => file.path)).toEqual(["/home/corpus/bronze/slack/archive/compact.jsonl"]);
    expect(plan.omitted.map((file) => file.path)).toEqual(["/home/corpus/bronze/slack/compact.jsonl"]);
  });

  it("omits nothing for a source that has never been compacted", () => {
    const windows: readonly BronzeFileStat[] = [
      { bytes: 3, path: "/home/corpus/bronze/gmail/2026-09-18_2026-09-19.jsonl" },
    ];
    const plan = planBronzeWindows({ files: windows, home: HOME, scope: "windows", source: "gmail" });
    expect(plan.read).toEqual(windows);
    expect(plan.omitted).toEqual([]);
  });

  it("plans an empty source as empty under both scopes", () => {
    expect(planBronzeWindows({ files: [], home: HOME, scope: "windows", source: "fathom" })).toEqual({
      omitted: [],
      read: [],
    });
    expect(planBronzeWindows({ files: [], home: HOME, scope: "full", source: "fathom" })).toEqual({
      omitted: [],
      read: [],
    });
  });
});

describe("bronzeBytes", () => {
  it("totals the sizes of the files it is given", () => {
    expect(bronzeBytes({ files: FILES })).toBe(6899158655);
  });

  it("is zero over no files", () => {
    expect(bronzeBytes({ files: [] })).toBe(0);
  });
});
