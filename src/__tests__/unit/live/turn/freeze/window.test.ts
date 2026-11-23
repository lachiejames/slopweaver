/**
 * Which moment a record-set file belongs to — every instant read off a field, a filename or a log row, never an
 * mtime. Each case writes the files it judges into a throwaway directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DraftCheckpoint } from "../../../../../live/turn/checkpoint.js";
import { checkpointWindow, entriesOf, readStringField, writtenAfter } from "../../../../../live/turn/freeze/window.js";
import { reviewedAnswerFileName, supersededVerdictName } from "../../../../../live/turn/reviewStore.js";

const dirs: string[] = [];
const freshDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "sw-freeze-window-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Write one file into a directory and hand back its path. */
const put = ({ dir, name, text }: { dir: string; name: string; text: string }): string => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

const AT = "2026-09-10T13:34:39.172Z";
const ONE_MS_BEFORE = "2026-09-10T13:34:39.171Z";

describe("entriesOf", () => {
  it("lists a directory's entry names", () => {
    const dir = freshDir();
    put({ dir, name: "b.json", text: "{}" });
    put({ dir, name: "a.json", text: "{}" });
    expect(entriesOf({ dir }).toSorted()).toEqual(["a.json", "b.json"]);
  });

  it("answers empty for a missing directory and for a path that is a file", () => {
    const dir = freshDir();
    const file = put({ dir, name: "plain.txt", text: "x" });
    expect(entriesOf({ dir: join(dir, "absent") })).toEqual([]);
    expect(entriesOf({ dir: file })).toEqual([]);
  });
});

describe("readStringField", () => {
  it("reads a string field out of a JSON file", () => {
    const path = put({ dir: freshDir(), name: "r.json", text: JSON.stringify({ spawnedAt: AT }) });
    expect(readStringField({ field: "spawnedAt", path })).toBe(AT);
  });

  it("answers undefined for a malformed file, a non-object document, a non-string field, an absent field and an absent file", () => {
    const dir = freshDir();
    const malformed = put({ dir, name: "m.json", text: "{not json" });
    const list = put({ dir, name: "l.json", text: JSON.stringify([{ spawnedAt: AT }]) });
    const numeric = put({ dir, name: "n.json", text: JSON.stringify({ spawnedAt: 7 }) });
    expect(readStringField({ field: "spawnedAt", path: malformed })).toBeUndefined();
    expect(readStringField({ field: "spawnedAt", path: list })).toBeUndefined();
    expect(readStringField({ field: "spawnedAt", path: numeric })).toBeUndefined();
    expect(readStringField({ field: "other", path: numeric })).toBeUndefined();
    expect(readStringField({ field: "spawnedAt", path: join(dir, "absent.json") })).toBeUndefined();
  });
});

describe("writtenAfter — a file's own declared field", () => {
  it("is after the window one millisecond past `spawnedAt`, and inside it at the same instant", () => {
    const path = put({ dir: freshDir(), name: "record.json", text: JSON.stringify({ spawnedAt: AT }) });
    expect(writtenAfter({ notAfterIso: ONE_MS_BEFORE, path })).toBe(true);
    expect(writtenAfter({ notAfterIso: AT, path })).toBe(false);
  });

  it("reads `recordedAtIso` when the file declares no `spawnedAt`", () => {
    const path = put({ dir: freshDir(), name: "marker.json", text: JSON.stringify({ recordedAtIso: AT }) });
    expect(writtenAfter({ notAfterIso: ONE_MS_BEFORE, path })).toBe(true);
    expect(writtenAfter({ notAfterIso: AT, path })).toBe(false);
  });

  it("consults `spawnedAt` before `recordedAtIso` when a file declares both", () => {
    const path = put({
      dir: freshDir(),
      name: "both.json",
      text: JSON.stringify({ recordedAtIso: "2026-09-11T00:00:00.000Z", spawnedAt: AT }),
    });
    expect(writtenAfter({ notAfterIso: AT, path })).toBe(false);
  });
});

describe("writtenAfter — a verdict, dated by its filename or its round's record", () => {
  it("dates an archived verdict by the spawn instant encoded in its own filename", () => {
    const dir = freshDir();
    const path = put({ dir, name: supersededVerdictName({ reviewer: "ws-one", spawnedAt: AT }), text: "{}" });
    expect(writtenAfter({ notAfterIso: ONE_MS_BEFORE, path })).toBe(true);
    expect(writtenAfter({ notAfterIso: AT, path })).toBe(false);
  });

  it("dates the standing verdict by the reviewer record beside it", () => {
    const dir = freshDir();
    put({ dir, name: "record.json", text: JSON.stringify({ spawnedAt: AT }) });
    const path = put({ dir, name: "verdict.json", text: JSON.stringify({ answerDigest: "sha256:aa" }) });
    expect(writtenAfter({ notAfterIso: ONE_MS_BEFORE, path })).toBe(true);
    expect(writtenAfter({ notAfterIso: AT, path })).toBe(false);
  });

  it("keeps a standing verdict that has no reviewer record beside it", () => {
    const path = put({ dir: freshDir(), name: "verdict.json", text: "{}" });
    expect(writtenAfter({ notAfterIso: "2000-01-01T00:00:00.000Z", path })).toBe(false);
  });
});

describe("writtenAfter — a reviewed-answer snapshot", () => {
  const FIRST = "2026-09-10T10:00:00.000Z";
  const SECOND = "2026-09-10T12:00:00.000Z";
  const OTHER_DIGEST_EARLIER = "2026-09-10T08:00:00.000Z";

  /** Two rounds bound to digest `aa` (FIRST archived, SECOND standing) and an earlier round bound to `bb`. */
  const reviewDir = (): { dir: string; snapshot: string } => {
    const dir = freshDir();
    put({ dir, name: "record.json", text: JSON.stringify({ spawnedAt: SECOND }) });
    put({ dir, name: "verdict.json", text: JSON.stringify({ answerDigest: "sha256:aa" }) });
    put({
      dir,
      name: supersededVerdictName({ reviewer: "ws-first", spawnedAt: FIRST }),
      text: JSON.stringify({ answerDigest: "sha256:aa" }),
    });
    put({
      dir,
      name: supersededVerdictName({ reviewer: "ws-other", spawnedAt: OTHER_DIGEST_EARLIER }),
      text: JSON.stringify({ answerDigest: "sha256:bb" }),
    });
    const snapshot = put({ dir, name: reviewedAnswerFileName({ digest: "sha256:aa" }), text: "{}" });
    return { dir, snapshot };
  };

  it("dates the snapshot by the EARLIEST round whose verdict names its digest", () => {
    const { snapshot } = reviewDir();
    // Between FIRST and SECOND: the earliest binding round is inside the window, so the snapshot is kept.
    expect(writtenAfter({ notAfterIso: "2026-09-10T11:00:00.000Z", path: snapshot })).toBe(false);
    expect(writtenAfter({ notAfterIso: FIRST, path: snapshot })).toBe(false);
  });

  it("ignores a round bound to a different digest, even an earlier one", () => {
    const { snapshot } = reviewDir();
    // After the `bb` round but before FIRST: had `bb` counted, the snapshot would be inside the window.
    expect(writtenAfter({ notAfterIso: "2026-09-10T09:59:59.999Z", path: snapshot })).toBe(true);
  });

  it("keeps a snapshot that no verdict names", () => {
    const dir = freshDir();
    put({ dir, name: "verdict.json", text: JSON.stringify({ answerDigest: "sha256:bb" }) });
    const snapshot = put({ dir, name: reviewedAnswerFileName({ digest: "sha256:aa" }), text: "{}" });
    expect(writtenAfter({ notAfterIso: "2000-01-01T00:00:00.000Z", path: snapshot })).toBe(false);
  });
});

describe("writtenAfter — undated files", () => {
  it("keeps a file that declares no instant, and a path that is not there", () => {
    const dir = freshDir();
    const undated = put({ dir, name: "notes.json", text: JSON.stringify({ text: "hello" }) });
    expect(writtenAfter({ notAfterIso: "2000-01-01T00:00:00.000Z", path: undated })).toBe(false);
    expect(writtenAfter({ notAfterIso: "2000-01-01T00:00:00.000Z", path: join(dir, "gone.json") })).toBe(false);
  });
});

describe("checkpointWindow", () => {
  const row = ({ at, draftFile }: { at: string; draftFile: string }): string =>
    JSON.stringify({
      answerDigest: `sha256:${draftFile}`,
      dispatchId: "dispatch-one",
      draftFile,
      leaseExpiresAt: "2026-09-10T15:00:00.000Z",
      recordedAtIso: at,
    } satisfies DraftCheckpoint);

  /** A checkpoint directory with two drafts a log dates, a malformed log line, and a file no row names. */
  const checkpointDir = (): { dir: string; lines: readonly string[] } => {
    const dir = freshDir();
    const lines = [row({ at: ONE_MS_BEFORE, draftFile: "d1.json" }), "{torn", row({ at: AT, draftFile: "d2.json" })];
    put({ dir, name: "log.jsonl", text: `${lines.join("\n")}\n` });
    put({ dir, name: "d1.json", text: "{}" });
    put({ dir, name: "d2.json", text: "{}" });
    put({ dir, name: "stray.json", text: "{}" });
    return { dir, lines };
  };

  it("keeps the log first, then every draft a kept row names, at the instant of the last row", () => {
    const { dir, lines } = checkpointDir();
    const window = checkpointWindow({ dir, notAfterIso: AT });
    expect({ ...window, entries: [window.entries[0], ...window.entries.slice(1).toSorted()] }).toEqual({
      entries: ["log.jsonl", "d1.json", "d2.json"],
      logLines: lines,
    });
  });

  it("drops the later row and its draft one millisecond before that row, keeping the malformed line", () => {
    const { dir, lines } = checkpointDir();
    expect(checkpointWindow({ dir, notAfterIso: ONE_MS_BEFORE })).toEqual({
      entries: ["log.jsonl", "d1.json"],
      logLines: [lines[0], lines[1]],
    });
  });

  it("freezes nothing from a directory with no log, or no directory at all", () => {
    const dir = freshDir();
    put({ dir, name: "d1.json", text: "{}" });
    expect(checkpointWindow({ dir, notAfterIso: AT })).toEqual({ entries: [], logLines: [] });
    expect(checkpointWindow({ dir: join(dir, "absent"), notAfterIso: AT })).toEqual({ entries: [], logLines: [] });
  });

  it("freezes nothing when the log is a name that cannot be read as a file", () => {
    const dir = freshDir();
    mkdirSync(join(dir, "log.jsonl"));
    expect(checkpointWindow({ dir, notAfterIso: AT })).toEqual({ entries: [], logLines: [] });
  });
});
