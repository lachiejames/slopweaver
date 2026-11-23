/**
 * The `self` job's shape and its reporting. Two properties here are design guards rather than behaviour checks:
 * the job declares itself `cursorless`, and the summary NAMES how each file was dated — a run that resolved
 * most of its corpus from mtime has not dated it, and has to say so.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { dateSelfFiles, readSelfAuthor, selfIngestJob, selfIngestNotes } from "../../../../corpus/self/ingest.js";
import type { SelfFile } from "../../../../corpus/self/scan.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const FILE: SelfFile = {
  absPath: "/dev/state/daily/monday.md",
  controlBytesStripped: 0,
  mtimeIso: "2026-08-05T00:00:00.000Z",
  relPath: "daily/monday.md",
  root: "/dev/state",
  rootName: "state",
  text: "## Heading\nbody",
};

describe("dateSelfFiles", () => {
  it("uses the git date when the root's history knows the path", () => {
    const dated = dateSelfFiles({
      files: [FILE],
      gitDatesByRoot: new Map([["/dev/state", new Map([["daily/monday.md", "2026-07-19T10:00:00+10:00"]])]]),
    });

    expect(dated[0]!.tsIso).toBe("2026-07-19T10:00:00+10:00");
    expect(dated[0]!.timeSource).toBe("git");
  });

  it("falls back to mtime for a root with no history at all, and marks it", () => {
    const dated = dateSelfFiles({ files: [FILE], gitDatesByRoot: new Map([["/dev/state", new Map()]]) });

    expect(dated[0]!.tsIso).toBe("2026-08-05T00:00:00.000Z");
    expect(dated[0]!.timeSource).toBe("mtime");
  });

  it("falls back for an untracked file inside a root that DOES have history", () => {
    const dated = dateSelfFiles({
      files: [FILE],
      gitDatesByRoot: new Map([["/dev/state", new Map([["other/tracked.md", "2026-07-19T10:00:00+10:00"]])]]),
    });

    expect(dated[0]!.timeSource).toBe("mtime");
  });

  it("keys the git map by ROOT, so one root's history never dates another root's file", () => {
    const other: SelfFile = { ...FILE, root: "/dev/notes", rootName: "notes" };
    const dated = dateSelfFiles({
      files: [other],
      gitDatesByRoot: new Map([["/dev/state", new Map([["daily/monday.md", "2026-07-19T10:00:00+10:00"]])]]),
    });

    expect(dated[0]!.timeSource).toBe("mtime");
  });

  it("dates nothing for no files", () => {
    expect(dateSelfFiles({ files: [], gitDatesByRoot: new Map() })).toEqual([]);
  });
});

describe("selfIngestNotes", () => {
  it("names the counts and the evidence breakdown", () => {
    expect(
      selfIngestNotes({ controlBytesStripped: 0, recordCount: 30, skips: [], timeSources: ["git", "git", "mtime"] }),
    ).toEqual([
      "saw 3 entr(ies): read 3 file(s) into 30 section record(s)",
      "declined: 0 entr(ies) — every entry the walk saw was read",
      "event time by file: git 2, mtime 1",
    ]);
  });

  it("says so plainly when a run read nothing", () => {
    expect(selfIngestNotes({ controlBytesStripped: 0, recordCount: 0, skips: [], timeSources: [] })).toEqual([
      "saw 0 entr(ies): read 0 file(s) into 0 section record(s)",
      "declined: 0 entr(ies) — every entry the walk saw was read",
      "event time by file: nothing (no files read)",
    ]);
  });

  // The defect this whole change exists to remove: a run that read 2 of 5 entries used to print only the 2,
  // so the three it declined were invisible rather than merely uninteresting.
  it("counts declined entries in `saw` and names each reason", () => {
    expect(
      selfIngestNotes({
        controlBytesStripped: 0,
        recordCount: 4,
        skips: [
          { detail: "", reason: "unsupported-extension", relPath: "notes/c.org" },
          { detail: "", reason: "unsupported-extension", relPath: "notes/d.rst" },
          { detail: "", reason: "symlink", relPath: "notes/link.md" },
        ],
        timeSources: ["mtime", "mtime"],
      }),
    ).toEqual([
      "saw 5 entr(ies): read 2 file(s) into 4 section record(s)",
      "declined: 3 entr(ies) across 2 reason(s)",
      "  unsupported-extension [policy]: 2 — not one of the extensions the corpus is read from",
      "  symlink [policy]: 1 — a symlink — never followed, so a link out of a root cannot widen the scan and one back in cannot loop",
      "event time by file: mtime 2",
    ]);
  });

  // Dogfooding caught this: the escape hatch was carried on the skip's `detail`, which the summary never
  // rendered. A real 18MB file was refused with "larger than the per-file ceiling" and nothing else, so the
  // operator was told a guardrail had fired and given no way past it — a hard block wearing a hatch's
  // clothes. The earlier unit test asserted `detail`, a field no user ever sees, and passed throughout.
  it("names the escape hatch in the line the operator actually reads", () => {
    const notes = selfIngestNotes({
      controlBytesStripped: 0,
      recordCount: 0,
      skips: [{ detail: "18874368 bytes exceeds the ceiling", reason: "too-large", relPath: "notes/huge.md" }],
      timeSources: [],
    });

    expect(notes.some((line) => line.includes("SLOPWEAVER_ALLOW_LARGE_FILES=1"))).toBe(true);
    expect(notes).toContain("    notes/huge.md");
  });

  // Policy declines routinely run to thousands, so naming them would bury the two lines worth reading.
  it("does not name examples for a policy decline", () => {
    const notes = selfIngestNotes({
      controlBytesStripped: 0,
      recordCount: 0,
      skips: [{ detail: "", reason: "unsupported-extension", relPath: "notes/photo.png" }],
      timeSources: [],
    });

    expect(notes.some((line) => line.includes("notes/photo.png"))).toBe(false);
  });

  it("reports stripped control bytes only when some were stripped", () => {
    const notes = selfIngestNotes({ controlBytesStripped: 7, recordCount: 1, skips: [], timeSources: ["mtime"] });
    expect(notes).toContain("sanitised: 7 control byte(s) stripped across the files read");
  });
});

/**
 * Two of these cases do REAL filesystem work — `mkdtempSync` plus a directory scan — so they are not on
 * vitest's default 5s budget. Measured: they time out under a loaded machine (load average 63,
 * fifteen concurrent sessions) while passing in milliseconds alone, which reddens a push for a reason that
 * has nothing to do with the diff. Same reasoning, and the same fix, as `stateHome.guard.test.ts`'s own
 * explicit budget: state the bound so the gate fails for a finding rather than for the machine being busy.
 */
const REAL_FILESYSTEM_SCAN_MS = 60_000;

describe("readSelfAuthor", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const dir of homes.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("attributes to the default author on an install with no profile", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-self-author-absent-"));
    homes.push(home);

    expect(unwrap(readSelfAuthor({ home }))).toBe("me");
  });

  it("answers the profile's own read error for a corrupt profile.json, never the default", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-self-author-corrupt-"));
    homes.push(home);
    writeFileSync(join(home, "profile.json"), "{");

    const error = unwrapErr(readSelfAuthor({ home }));
    expect(error.code).toBe("PROFILE_UNREADABLE");
    expect(error.path).toBe(join(home, "profile.json"));
  });
});

describe("selfIngestJob", { timeout: REAL_FILESYSTEM_SCAN_MS }, () => {
  const window = { since: "1970-01-01", until: "2026-08-06" };
  const fixtureDirs: string[] = [];

  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("declares itself cursorless, so no watermark is ever written for a source with no cursor", () => {
    const job = selfIngestJob({ home: "/nowhere", roots: ["/dev/state"], window });

    expect(job.cursorless).toBe(true);
  });

  it("is the self source, and labels how many roots it will scan", () => {
    const job = selfIngestJob({ home: "/nowhere", roots: ["/dev/state", "/dev/notes"], window });

    expect(job.source).toBe("self");
    expect(job.label).toBe("self (2 root(s))");
  });

  it("runs over a real empty root, reporting zero rather than failing", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-self-job-home-"));
    const root = mkdtempSync(join(tmpdir(), "slopweaver-self-job-root-"));
    fixtureDirs.push(home, root);

    const outcome = await selfIngestJob({ home, roots: [root], window }).run();

    expect(outcome.isOk()).toBe(true);
    expect(outcome.isOk() ? outcome.value.records.length : -1).toBe(0);
    expect(outcome.isOk() ? outcome.value.notes : []).toContain(
      "saw 0 entr(ies): read 0 file(s) into 0 section record(s)",
    );
  });

  it("refuses a corrupt profile.json instead of attributing every record to the default author", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-self-job-home3-"));
    const root = mkdtempSync(join(tmpdir(), "slopweaver-self-job-root3-"));
    fixtureDirs.push(home, root);
    writeFileSync(join(home, "profile.json"), "{");

    const outcome = await selfIngestJob({ home, roots: [root], window }).run();

    const reasons = unwrapErr(outcome);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(join(home, "profile.json"));
    expect(reasons[0]).toContain("No self record was ingested.");
  });

  it("surfaces an unreadable root as a warning rather than a failure", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-self-job-home2-"));
    fixtureDirs.push(home);

    const outcome = await selfIngestJob({ home, roots: [join(home, "absent")], window }).run();

    expect(outcome.isOk()).toBe(true);
    expect(outcome.isOk() ? outcome.value.warnings.length : -1).toBe(1);
  });
});
