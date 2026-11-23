import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { JumpcloudResumeEntry } from "../../../../atlas/jumpcloud/resume.js";
import {
  appendJumpcloudResume,
  dropJumpcloudResume,
  jumpcloudResumePath,
  readJumpcloudResume,
  resumeKey,
} from "../../../../atlas/jumpcloud/resume.js";
import { unwrapErr } from "../../../../lib/result.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-jumpcloud-resume-"));
  dirs.push(dir);
  return dir;
}

function entry({ surface, endpoint }: { surface: string; endpoint: string }): JumpcloudResumeEntry {
  return {
    at: "2026-09-04T10:00:00.000Z",
    complete: true,
    declaredTotal: 1,
    empty: false,
    endpoint,
    incompleteIsClearable: false,
    isRoot: true,
    key: resumeKey({ endpoint, surface }),
    kind: "systems",
    pagesExhausted: true,
    reason: "read 1 record",
    records: [{ _id: "sys-1" }],
    surface,
  };
}

describe("the resume journal", () => {
  it("keys a call by its surface and its BOUND path, so one fan-out call is one key", () => {
    expect(resumeKey({ endpoint: "/api/systems/sys-1", surface: "v1-systems-get" })).toBe(
      "v1-systems-get|/api/systems/sys-1",
    );
  });

  it("reports no completed calls when no journal exists, rather than failing", () => {
    expect(readJumpcloudResume({ directory: scratchDir() }).length).toBe(0);
  });

  it("round-trips a completed call, so the next run can skip it", () => {
    const directory = scratchDir();
    const written = entry({ endpoint: "/api/systems", surface: "v1-systems-list" });
    expect(appendJumpcloudResume({ directory, entry: written }).isOk()).toBe(true);
    expect(readJumpcloudResume({ directory })[0]).toEqual(written);
  });

  it("skips one unreadable line rather than abandoning twenty thousand other calls", () => {
    const directory = scratchDir();
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/systems", surface: "v1-systems-list" }) });
    appendFileSync(jumpcloudResumePath({ directory }), "{ this is not json\n");
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/policies", surface: "v2-policies-list" }) });
    expect(readJumpcloudResume({ directory }).length).toBe(2);
  });

  it("skips a line that parses but is not a journal entry", () => {
    const directory = scratchDir();
    appendFileSync(jumpcloudResumePath({ directory }), `${JSON.stringify({ key: "k" })}\n`);
    expect(readJumpcloudResume({ directory }).length).toBe(0);
  });

  it("reads a legacy line that stored entities, recovering its records rather than redoing the call", () => {
    const directory = scratchDir();
    const legacy = {
      at: "2026-09-04T10:00:00.000Z",
      complete: true,
      declaredTotal: 1,
      empty: false,
      endpoint: "/api/systems",
      entities: [
        {
          channels: {
            "admin-console": null,
            "directory-api": { detail: { _id: "sys-1" }, state: "observed" },
          },
        },
      ],
      key: "v1-systems-list|/api/systems",
      kind: "systems",
      pagesExhausted: true,
      reason: "read 1 record",
      surface: "v1-systems-list",
    };
    appendFileSync(jumpcloudResumePath({ directory }), `${JSON.stringify(legacy)}\n`);
    const read = readJumpcloudResume({ directory });
    expect(read.length).toBe(1);
    expect(read[0]!.records).toEqual([{ _id: "sys-1" }]);
    expect(read[0]!.isRoot).toBe(true);
  });

  it("skips a legacy line whose entity carries no directory-api detail, so that one call is redone", () => {
    const directory = scratchDir();
    const legacy = {
      at: "2026-09-04T10:00:00.000Z",
      complete: true,
      declaredTotal: 1,
      empty: false,
      endpoint: "/api/systems",
      entities: [{ channels: { "admin-console": null, "directory-api": { state: "observed" } } }],
      key: "v1-systems-list|/api/systems",
      kind: "systems",
      pagesExhausted: true,
      reason: "read 1 record",
      surface: "v1-systems-list",
    };
    appendFileSync(jumpcloudResumePath({ directory }), `${JSON.stringify(legacy)}\n`);
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/policies", surface: "v2-policies-list" }) });
    const read = readJumpcloudResume({ directory });
    expect(read.map((one) => one.surface)).toEqual(["v2-policies-list"]);
  });

  it("still reads a legacy line whose entity stored a null detail, as a null record", () => {
    const directory = scratchDir();
    const legacy = {
      at: "2026-09-04T10:00:00.000Z",
      complete: true,
      declaredTotal: 1,
      empty: false,
      endpoint: "/api/systems",
      entities: [{ channels: { "admin-console": null, "directory-api": { detail: null, state: "observed" } } }],
      key: "v1-systems-list|/api/systems",
      kind: "systems",
      pagesExhausted: true,
      reason: "read 1 record",
      surface: "v1-systems-list",
    };
    appendFileSync(jumpcloudResumePath({ directory }), `${JSON.stringify(legacy)}\n`);
    const read = readJumpcloudResume({ directory });
    expect(read.length).toBe(1);
    expect(read[0]!.records).toEqual([null]);
  });

  it("keeps one entry per call when a key was journalled twice, and it is the LATER line", () => {
    const directory = scratchDir();
    const first = entry({ endpoint: "/api/systems", surface: "v1-systems-list" });
    appendJumpcloudResume({ directory, entry: first });
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/policies", surface: "v2-policies-list" }) });
    appendJumpcloudResume({
      directory,
      entry: { ...first, at: "2026-09-06T10:00:00.000Z", records: [{ _id: "sys-2" }] },
    });

    const read = readJumpcloudResume({ directory });

    expect(read.length).toBe(2);
    expect(read.map((one) => one.surface)).toEqual(["v1-systems-list", "v2-policies-list"]);
    expect(read[0]!.records).toEqual([{ _id: "sys-2" }]);
    expect(read[0]!.at).toBe("2026-09-06T10:00:00.000Z");
  });

  it("reads a journal whose lines straddle the streaming reader's chunk boundary", () => {
    // One line larger than READ_CHUNK_BYTES (8 MiB), with an ordinary call on either side of it. This is
    // the arrangement the whole-file read never had to survive and the streaming one does: a naive
    // `split("\n")` over one string cannot even be built for the real journal this replaced, which had
    // grown past V8's 536,870,888-character wall and therefore read as EMPTY.
    const directory = scratchDir();
    const big = {
      ...entry({ endpoint: "/api/v2/systeminsights/launchd", surface: "v2-systeminsights-list-launchd" }),
      records: [{ _id: "insight-1", blob: "x".repeat(9 * 1024 * 1024) }],
    };
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/systems", surface: "v1-systems-list" }) });
    appendJumpcloudResume({ directory, entry: big });
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/policies", surface: "v2-policies-list" }) });

    const read = readJumpcloudResume({ directory });

    expect(read.length).toBe(3);
    expect(read.map((one) => one.surface)).toEqual([
      "v1-systems-list",
      "v2-systeminsights-list-launchd",
      "v2-policies-list",
    ]);
    expect(read[1]!.records).toEqual(big.records);
  });

  it("reports a journal it cannot write, because a sync that cannot resume must not pretend it can", () => {
    const failed = appendJumpcloudResume({
      directory: "/dev/null/not-a-directory",
      entry: entry({ endpoint: "/api/systems", surface: "v1-systems-list" }),
    });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed)[0]).toContain("resume journal");
  });

  it("names the journal path it could not write, on one line", () => {
    const lines = unwrapErr(
      appendJumpcloudResume({
        directory: "/dev/null/not-a-directory",
        entry: entry({ endpoint: "/api/systems", surface: "v1-systems-list" }),
      }),
    );
    expect(lines.length).toBe(1);
    expect(
      lines[0]!.startsWith("could not write the JumpCloud resume journal at /dev/null/not-a-directory/_resume.jsonl: "),
    ).toBe(true);
  });

  it("removes the journal, and removing an absent one is not a failure", () => {
    const directory = scratchDir();
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/systems", surface: "v1-systems-list" }) });
    expect(dropJumpcloudResume({ directory }).isOk()).toBe(true);
    expect(readJumpcloudResume({ directory }).length).toBe(0);
    expect(dropJumpcloudResume({ directory }).isOk()).toBe(true);
  });
});

describe("a clearably-incomplete walk is never cached", () => {
  const incomplete = ({ directory }: { directory: string }): void => {
    appendJumpcloudResume({
      directory,
      entry: {
        ...entry({ endpoint: "/api/v2/systeminsights/certificates", surface: "v2-systeminsights-list-certificates" }),
        complete: false,
        incompleteIsClearable: true,
      },
    });
  };

  it("refuses to write one, so a paging fix is not defeated by the journal", () => {
    const directory = scratchDir();
    incomplete({ directory });
    expect(readJumpcloudResume({ directory }).length).toBe(0);
  });

  it("still writes a walk that finished", () => {
    const directory = scratchDir();
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/systems", surface: "v1-systems-list" }) });
    expect(readJumpcloudResume({ directory }).length).toBe(1);
  });

  it("skips one an older build already wrote, rather than making a stale cap permanent", () => {
    const directory = scratchDir();
    const stale = {
      ...entry({ endpoint: "/api/v2/systeminsights/apps", surface: "v2-systeminsights-list-apps" }),
      complete: false,
      incompleteIsClearable: true,
    };
    appendFileSync(jumpcloudResumePath({ directory }), `${JSON.stringify(stale)}\n`);
    appendJumpcloudResume({ directory, entry: entry({ endpoint: "/api/systems", surface: "v1-systems-list" }) });
    const read = readJumpcloudResume({ directory });
    expect(read.length).toBe(1);
    expect(read[0]!.surface).toBe("v1-systems-list");
  });
});
