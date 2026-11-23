/**
 * The archive pass — the pure trim, the order it keeps, what it leaves alone — and the verb around it,
 * driven through injected seams.
 */
import { describe, expect, it } from "vitest";

import {
  archiveBriefingForm,
  archiveDocument,
  earlierNotesOf,
  joinArchives,
  keepForOvershoot,
} from "../../../briefing/archive.js";
import { HISTORY_MAX_SECTIONS, SECTION_MAX_NOTES } from "../../../briefing/caps.js";
import {
  type BriefingArchiveDeps,
  defaultArchivePath,
  runBriefingArchive,
} from "../../../cli/commands/briefing/archiveRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";

/** `count` notes, each carrying its own index so order is checkable. */
function notes({ count }: { count: number }): readonly { headline: readonly { kind: "text"; text: string }[] }[] {
  return Array.from({ length: count }, (_, index) => ({ headline: [{ kind: "text", text: `note ${String(index)}` }] }));
}

/** `count` sections, each carrying its own index. */
function sections({ count }: { count: number }): readonly { summary: string; notes: readonly unknown[] }[] {
  return Array.from({ length: count }, (_, index) => ({ notes: notes({ count: 1 }), summary: `day ${String(index)}` }));
}

const NOW = "2026-09-03T05:00:00.000Z";

describe("archiveBriefingForm", () => {
  it("leaves a form within the caps untouched, with empty overflow", () => {
    const form = {
      earlierToday: { notes: notes({ count: 3 }), summary: "s" },
      header: { lede: [] },
      history: sections({ count: 2 }),
    };
    const archive = archiveBriefingForm({ form });

    expect(archive.form).toEqual(form);
    expect(archive.earlierNotes).toEqual([]);
    expect(archive.historySections).toEqual([]);
  });

  it("reads the form NEWEST-FIRST by default, as sweep-block writes it: keeps the first notes, moves the tail", () => {
    const form = { earlierToday: { notes: notes({ count: 5 }), summary: "s" }, history: [] };
    const archive = archiveBriefingForm({ form, keepNotes: 2 });

    expect(archive.form["earlierToday"]).toEqual({ notes: notes({ count: 2 }), summary: "s" });
    expect(archive.earlierNotes).toEqual(notes({ count: 5 }).slice(2));
  });

  it("trims history from the end by default too", () => {
    const archive = archiveBriefingForm({ form: { history: sections({ count: 6 }) }, keepSections: 4 });

    expect(archive.form["history"]).toEqual(sections({ count: 4 }));
    expect(archive.historySections).toEqual(sections({ count: 6 }).slice(4));
  });

  it("keeps the LAST notes of an oldest-first form and moves the head, in order", () => {
    const form = { earlierToday: { notes: notes({ count: 5 }), summary: "s" }, history: [] };
    const archive = archiveBriefingForm({ form, keepNotes: 2, oldestFirst: true });

    expect(archive.earlierNotes).toEqual(notes({ count: 3 }));
    expect(archive.form["earlierToday"]).toEqual({ notes: notes({ count: 5 }).slice(3), summary: "s" });
  });

  it("keeps an oldest-first form's newest history sections the same way", () => {
    const form = { history: sections({ count: 6 }) };
    const archive = archiveBriefingForm({ form, keepSections: 4, oldestFirst: true });

    expect(archive.historySections).toEqual(sections({ count: 2 }));
    expect(archive.form["history"]).toEqual(sections({ count: 6 }).slice(2));
  });

  it("defaults to the schema's own caps", () => {
    const form = {
      earlierToday: { notes: notes({ count: SECTION_MAX_NOTES + 7 }), summary: "s" },
      history: sections({ count: HISTORY_MAX_SECTIONS + 1 }),
    };
    const archive = archiveBriefingForm({ form });

    expect(archive.earlierNotes.length).toBe(7);
    expect(archive.historySections.length).toBe(1);
  });

  it("touches nothing else in the form", () => {
    const form = {
      alignment: { headline: [], intake: [] },
      earlierToday: { notes: notes({ count: 3 }), summary: "s" },
      history: [],
      recent: [1, 2],
    };
    const archive = archiveBriefingForm({ form, keepNotes: 1 });

    expect(archive.form["alignment"]).toEqual({ headline: [], intake: [] });
    expect(archive.form["recent"]).toEqual([1, 2]);
  });

  it("moves nothing from an oldest-first form within the caps", () => {
    const form = { earlierToday: { notes: notes({ count: 3 }), summary: "s" }, history: sections({ count: 2 }) };
    const archive = archiveBriefingForm({ form, oldestFirst: true });

    expect(archive.form).toEqual(form);
    expect(archive.earlierNotes).toEqual([]);
  });

  it("treats a form that is not an object as empty", () => {
    expect(archiveBriefingForm({ form: 42 })).toEqual({ earlierNotes: [], form: {}, historySections: [] });
  });

  it("stamps the archive document with the instant and the form it came from", () => {
    const archive = archiveBriefingForm({ form: { history: sections({ count: 5 }) }, keepSections: 4 });

    expect(archiveDocument({ archive, archivedAtIso: NOW, formPath: "/s/form.json" })).toEqual({
      archivedAtIso: NOW,
      earlierNotes: [],
      formPath: "/s/form.json",
      historySections: sections({ count: 5 }).slice(4),
    });
  });
});

describe("earlierNotesOf", () => {
  it("reads a form's earlierToday notes in its own order", () => {
    expect(earlierNotesOf({ form: { earlierToday: { notes: notes({ count: 2 }) } } })).toEqual(notes({ count: 2 }));
  });

  it("reads no notes from a form with no earlierToday, or one that is not an object", () => {
    expect(earlierNotesOf({ form: { history: [] } })).toEqual([]);
    expect(earlierNotesOf({ form: { earlierToday: { summary: "s" } } })).toEqual([]);
    expect(earlierNotesOf({ form: 42 })).toEqual([]);
  });
});

/** `count` notes of exactly `bytes` bytes of JSON each. */
function weighed({ count, bytes }: { count: number; bytes: number }): readonly string[] {
  // A JSON string costs its two quotes beside its characters.
  return Array.from({ length: count }, () => "x".repeat(bytes - 2));
}

describe("keepForOvershoot", () => {
  it("moves one note when the overshoot is under one note's weight", () => {
    expect(keepForOvershoot({ floor: 1, notes: weighed({ bytes: 100, count: 6 }), overBytes: 1 })).toBe(5);
  });

  it("moves as many of the oldest notes as it takes to cover the overshoot, and no more", () => {
    expect(keepForOvershoot({ floor: 1, notes: weighed({ bytes: 100, count: 6 }), overBytes: 250 })).toBe(3);
    expect(keepForOvershoot({ floor: 1, notes: weighed({ bytes: 100, count: 6 }), overBytes: 300 })).toBe(3);
    expect(keepForOvershoot({ floor: 1, notes: weighed({ bytes: 100, count: 6 }), overBytes: 301 })).toBe(2);
  });

  it("never goes below the floor, however large the overshoot", () => {
    expect(keepForOvershoot({ floor: 1, notes: weighed({ bytes: 100, count: 6 }), overBytes: 99_999 })).toBe(1);
  });

  it("answers the count it was given when it is already at the floor, meaning nothing is left to move", () => {
    expect(keepForOvershoot({ floor: 1, notes: weighed({ bytes: 100, count: 1 }), overBytes: 1 })).toBe(1);
    expect(keepForOvershoot({ floor: 1, notes: [], overBytes: 1 })).toBe(0);
  });

  it("still moves one note on an overshoot it could not measure", () => {
    expect(keepForOvershoot({ floor: 1, notes: weighed({ bytes: 100, count: 3 }), overBytes: -5 })).toBe(2);
  });
});

describe("joinArchives", () => {
  it("puts the second pass's overflow — the newer notes — ahead of the first's, and keeps the second's form", () => {
    const all = notes({ count: 6 });
    const first = archiveBriefingForm({ form: { earlierToday: { notes: all } }, keepNotes: 4 });
    const second = archiveBriefingForm({ form: first.form, keepNotes: 2 });
    const joined = joinArchives({ earlier: first, later: second });

    expect(joined.earlierNotes).toEqual(all.slice(2));
    expect(joined.form).toEqual(second.form);
    expect(joined.historySections).toEqual([]);
  });
});

describe("defaultArchivePath", () => {
  it("sits beside the form, named for the instant, with no colon in it", () => {
    expect(defaultArchivePath({ formPath: "/s/form.json", nowIso: NOW })).toBe(
      "/s/briefing-archive-2026-09-03T05-00-00-000Z.json",
    );
  });
});

/** Run the verb over an in-memory file map, capturing both lanes and every write. */
function run({ rest, files }: { rest: readonly string[]; files: Record<string, string> }): {
  code: number;
  out: string[];
  diagnostics: string[];
  writes: { path: string; text: string }[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const writes: { path: string; text: string }[] = [];
  const deps: BriefingArchiveDeps = {
    now: () => NOW,
    readFile: ({ path }) => {
      const text = files[path];
      if (text === undefined) {
        throw new Error("ENOENT");
      }
      return text;
    },
    writeDiagnostic: (line) => diagnostics.push(line),
    writeFile: (write) => writes.push(write),
    writeOut: (line) => out.push(line),
  };
  return { code: runBriefingArchive({ deps, rest }), diagnostics, out, writes };
}

describe("runBriefingArchive", () => {
  const FORM = JSON.stringify({ earlierToday: { notes: notes({ count: 4 }), summary: "s" }, history: [] });

  it("refuses without --form, printing the usage", () => {
    const result = run({ files: {}, rest: [] });

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toBe("briefing archive: --form <path> is required: the form file to trim in place");
  });

  it("refuses a --keep-notes over the schema's cap", () => {
    const result = run({ files: {}, rest: ["--form", "/s/form.json", "--keep-notes", "999"] });

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.diagnostics[0]).toBe(
      `briefing archive: --keep-notes takes a whole number between 1 and ${String(SECTION_MAX_NOTES)} (the schema's own cap)`,
    );
  });

  it("reports an unreadable form and writes nothing", () => {
    const result = run({ files: {}, rest: ["--form", "/s/missing.json"] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.diagnostics[0]).toBe("briefing archive: /s/missing.json: could not read the form — ENOENT");
    expect(result.writes).toEqual([]);
  });

  it("says so and writes nothing when nothing is over the caps", () => {
    const result = run({ files: { "/s/form.json": FORM }, rest: ["--form", "/s/form.json"] });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toEqual([
      `briefing archive: nothing over the caps (${String(SECTION_MAX_NOTES)} notes, ${String(HISTORY_MAX_SECTIONS)} sections); /s/form.json is unchanged`,
    ]);
    expect(result.writes).toEqual([]);
  });

  it("writes the archive file first, then the trimmed form in place", () => {
    const result = run({ files: { "/s/form.json": FORM }, rest: ["--form", "/s/form.json", "--keep-notes", "1"] });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toEqual([
      "briefing archive: 3 earlierToday note(s) and 0 history section(s) moved to /s/briefing-archive-2026-09-03T05-00-00-000Z.json",
    ]);
    expect(result.writes.map((write) => write.path)).toEqual([
      "/s/briefing-archive-2026-09-03T05-00-00-000Z.json",
      "/s/form.json",
    ]);
    expect(JSON.parse(result.writes[1]!.text)).toEqual({
      earlierToday: { notes: notes({ count: 1 }), summary: "s" },
      history: [],
    });
    expect(JSON.parse(result.writes[0]!.text)).toEqual({
      archivedAtIso: NOW,
      earlierNotes: notes({ count: 4 }).slice(1),
      formPath: "/s/form.json",
      historySections: [],
    });
  });

  it("keeps the last notes under --oldest-first, for a form that appends", () => {
    const result = run({
      files: { "/s/form.json": FORM },
      rest: ["--form", "/s/form.json", "--keep-notes", "1", "--oldest-first"],
    });

    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.writes[1]!.text)).toEqual({
      earlierToday: { notes: notes({ count: 4 }).slice(3), summary: "s" },
      history: [],
    });
  });

  it("honours --out and --dry-run", () => {
    const result = run({
      files: { "/s/form.json": FORM },
      rest: ["--form", "/s/form.json", "--keep-notes", "1", "--out", "/elsewhere/a.json", "--dry-run"],
    });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toEqual([
      "briefing archive: 3 earlierToday note(s) and 0 history section(s) would move to /elsewhere/a.json (dry run, nothing written)",
    ]);
    expect(result.writes).toEqual([]);
  });
});
