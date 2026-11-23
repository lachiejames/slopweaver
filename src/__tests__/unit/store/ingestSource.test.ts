/**
 * Which of a source's bronze files a whole-source pass reads, and in what order.
 *
 * Order is the correctness here, not a detail: `content` upserts on `(source, source_id)` and a later
 * capture supersedes completely, so the file written LAST decides what the row holds. The measurement
 * behind the ordering rule is in `corpusPaths.sortBronzeEntries` — a plain sort put `compact.jsonl` last
 * and 60 of 60 re-projected meeting transcripts resolved to their superseded versions with nothing
 * reporting it. So the property asserted below is that resuming drops a PREFIX and never reorders.
 */
import { describe, expect, it } from "vitest";

import type { BronzeFileStat } from "../../../corpus/bronzeStorage.js";
import { sortBronzeEntries } from "../../../corpus/corpusPaths.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { storeErrorLines } from "../../../store/errors.js";
import { planSourceFiles } from "../../../store/ingestSource.js";

/** One source's files, in the order `listBronzeFiles` hands them over. */
const FILES: readonly BronzeFileStat[] = [
  { bytes: 6899158625, path: "/home/corpus/bronze/slack/compact.jsonl" },
  { bytes: 7610945, path: "/home/corpus/bronze/slack/2026-09-03_2026-09-05.jsonl" },
  { bytes: 8128873, path: "/home/corpus/bronze/slack/2026-09-08_2026-09-11.jsonl" },
];

describe("planning which of a source's files to read", () => {
  it("reads every file, in the order given, when nothing asked it to resume", () => {
    expect(unwrap(planSourceFiles({ files: FILES })).read).toEqual(FILES);
  });

  it("skips nothing when nothing asked it to resume", () => {
    expect(unwrap(planSourceFiles({ files: FILES })).skipped).toEqual([]);
  });

  it("resumes at a named basename, dropping exactly the files before it", () => {
    const plan = unwrap(planSourceFiles({ files: FILES, fromFile: "2026-09-08_2026-09-11.jsonl" }));
    expect(plan.read.map((file) => file.path)).toEqual(["/home/corpus/bronze/slack/2026-09-08_2026-09-11.jsonl"]);
  });

  it("names the files it skipped, so a resumed run says what it did not read", () => {
    const plan = unwrap(planSourceFiles({ files: FILES, fromFile: "2026-09-08_2026-09-11.jsonl" }));
    expect(plan.skipped).toEqual([
      "/home/corpus/bronze/slack/compact.jsonl",
      "/home/corpus/bronze/slack/2026-09-03_2026-09-05.jsonl",
    ]);
  });

  it("accepts a full path as well as a basename, because a report prints the path", () => {
    const plan = unwrap(planSourceFiles({ files: FILES, fromFile: "/home/corpus/bronze/slack/compact.jsonl" }));
    expect(plan.read).toEqual(FILES);
  });

  it("never reorders what it keeps — a resume is a prefix drop, and the ordering decides which capture wins", () => {
    const plan = unwrap(planSourceFiles({ files: FILES, fromFile: "2026-09-03_2026-09-05.jsonl" }));
    expect(plan.read.map((file) => file.path)).toEqual([
      "/home/corpus/bronze/slack/2026-09-03_2026-09-05.jsonl",
      "/home/corpus/bronze/slack/2026-09-08_2026-09-11.jsonl",
    ]);
  });

  it("REFUSES a basename that names no file, rather than silently reading the whole source again", () => {
    const refused = planSourceFiles({ files: FILES, fromFile: "2026-09-08_2026-09-12.jsonl" });
    expect(storeErrorLines({ error: unwrapErr(refused) })).toEqual([
      "--from-file 2026-09-08_2026-09-12.jsonl names no bronze file here — this source has " +
        "compact.jsonl, 2026-09-03_2026-09-05.jsonl, 2026-09-08_2026-09-11.jsonl",
    ]);
  });

  it("lists the real basenames in that refusal, so the operator can retype one", () => {
    const refused = planSourceFiles({ files: FILES, fromFile: "typo.jsonl" });
    expect(refused.isErr()).toBe(true);
    expect(storeErrorLines({ error: refused._unsafeUnwrapErr() })[0]).toContain("2026-09-08_2026-09-11.jsonl");
  });

  it("says the source has none when it has none, rather than listing an empty set", () => {
    const refused = planSourceFiles({ files: [], fromFile: "anything.jsonl" });
    expect(refused.isErr()).toBe(true);
    expect(storeErrorLines({ error: refused._unsafeUnwrapErr() })[0]).toContain("this source has none");
  });

  it("does not confuse a suffix match with a different file whose name merely ends the same way", () => {
    const files: readonly BronzeFileStat[] = [
      { bytes: 1, path: "/home/corpus/bronze/slack/nested/compact.jsonl" },
      { bytes: 2, path: "/home/corpus/bronze/slack/compact.jsonl" },
    ];
    expect(unwrap(planSourceFiles({ files, fromFile: "compact.jsonl" })).read[0]?.path).toBe(
      "/home/corpus/bronze/slack/nested/compact.jsonl",
    );
  });
});

describe("the order a whole-source pass inherits", () => {
  it("is bronze READ order — the canonical compacted file first, then window files by name", () => {
    expect(
      sortBronzeEntries({
        entries: ["2026-09-08_2026-09-11.jsonl", "compact.jsonl", "2026-09-03_2026-09-05.jsonl"],
      }),
    ).toEqual(["compact.jsonl", "2026-09-03_2026-09-05.jsonl", "2026-09-08_2026-09-11.jsonl"]);
  });
});
