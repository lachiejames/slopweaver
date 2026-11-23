/**
 * The authored working-state class: which top-level directories it is, that a file reaches its two rows
 * byte-exact or is refused by name, and the two read-side decisions `store authored-*` make over those rows.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import {
  AUTHORED_HOME_FILES,
  classifyHomeDirectory,
  classifyHomePath,
  HOME_DIRECTORY_CLASSIFICATION,
  isAuthoredHomeFile,
  isAuthoredPath,
  mayHoldAuthored,
} from "../../../../store/fleet/authoredDirectories.js";
import {
  AUTHORED_FILE_MAX_BYTES,
  absentAuthoredPaths,
  authoredDirectoryOf,
  newestPerPath,
  planAuthoredRestore,
  projectAuthoredFile,
  resolveAuthoredRef,
  type StoredAuthoredVersion,
} from "../../../../store/fleet/authoredFile.js";
import { authoredAbsolutePath, listAuthoredFiles } from "../../../../store/fleet/authoredFiles.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";
import { LIVE_CLASSIFICATION } from "../../../../store/fleet/liveClassification.js";

const WHEN = new Date("2026-09-25T01:02:03.004Z");

/** Every string reachable inside a nested paths object — its leaf paths. */
function stringLeaves({ value }: { value: unknown }): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((child: unknown) => stringLeaves({ value: child }));
  }
  return [];
}

/** The bytes of a string, as a file holding it would carry them. */
function bytesOf({ text }: { text: string }): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

/** A stored version, with only what a case varies spelled out. */
function version(over: Partial<StoredAuthoredVersion> & { relativePath: string }): StoredAuthoredVersion {
  return { bodySha256: "a".repeat(64), byteLength: 1, fileModifiedAt: WHEN, ...over };
}

describe("HOME_DIRECTORY_CLASSIFICATION", () => {
  it("classifies each name once, so no directory can be two classes", () => {
    const keys = HOME_DIRECTORY_CLASSIFICATION.map((row) => `${String(row.prefix)}:${row.name}`);

    expect(HOME_DIRECTORY_CLASSIFICATION.length).toBeGreaterThan(0);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  it("carves no authored row out of a credential one, so the walk never enters a credential directory", () => {
    const credentials = HOME_DIRECTORY_CLASSIFICATION.filter((row) => row.directoryClass === "credential");

    expect(credentials.length).toBeGreaterThan(0);
    expect(
      HOME_DIRECTORY_CLASSIFICATION.filter(
        (row) =>
          row.directoryClass === "authored" &&
          credentials.some((credential) => row.name.startsWith(`${credential.name}/`)),
      ),
    ).toEqual([]);
  });

  it("never classifies a credential directory authored, since the store's dump leaves the machine", () => {
    expect(classifyHomeDirectory({ name: "secrets" })!.directoryClass).toBe("credential");
    expect(classifyHomeDirectory({ name: "claude-accounts" })!.directoryClass).toBe("credential");
    expect(isAuthoredPath({ relativePath: "secrets" })).toBe(false);
  });

  it("leaves a directory another class row owns to that row", () => {
    expect(classifyHomeDirectory({ name: "corpus" })!.directoryClass).toBe("other-class");
    expect(classifyHomeDirectory({ name: "ledgers" })!.directoryClass).toBe("other-class");
    expect(classifyHomeDirectory({ name: "tmp" })!.directoryClass).toBe("scratch");
  });

  it("stores the board and the run journals byte-exact, since their table rows cannot give a file back", () => {
    expect(authoredDirectoryOf({ relativePath: "handovers/a-row.md" })).toBe("handovers");
    expect(authoredDirectoryOf({ relativePath: "handovers/archive/owner-turn-1.txt" })).toBe("handovers");
    expect(authoredDirectoryOf({ relativePath: "runs/a-row.jsonl" })).toBe("runs");
  });

  it("names each boot file a fresh machine needs, and never the private denylist it would refuse to store", () => {
    expect(AUTHORED_HOME_FILES.map((file) => file.name)).toEqual([
      "identity-exclusion.txt",
      "plans.json",
      "profile.json",
      "push-roots.json",
      "responders.json",
      "sync-author-denylist.txt",
      "trusted-askers.json",
      "general-rulings.json",
      "console-sync-failure-append-failures.jsonl",
    ]);
    expect(isAuthoredHomeFile({ name: "responders.json" })).toBe(true);
    expect(isAuthoredPath({ relativePath: "console-sync-failure-append-failures.jsonl" })).toBe(true);
    expect(isAuthoredHomeFile({ name: "trusted-askers.json" })).toBe(true);
    expect(isAuthoredHomeFile({ name: "hygiene-denylist.txt" })).toBe(false);
    expect(isAuthoredHomeFile({ name: "profile.json.bak" })).toBe(false);
  });

  it("never names the ruling register, so the owner's words in it are not copied into the store", () => {
    expect(isAuthoredHomeFile({ name: "rulings.jsonl" })).toBe(false);
    expect(isAuthoredPath({ relativePath: "rulings.jsonl" })).toBe(false);
  });

  it("names the audit's authored directories authored", () => {
    expect(
      ["briefs", "artifacts", "judgement", "profile", "registers", "morning"].filter(
        (name) => !isAuthoredPath({ relativePath: name }),
      ),
    ).toEqual([]);
  });

  it("reads handover-evidence, a loose file under it and the anchor canon cites for it", () => {
    expect(classifyHomeDirectory({ name: "handover-evidence" })!.directoryClass).toBe("authored");
    expect(authoredDirectoryOf({ relativePath: "handover-evidence/ruling-backfill-39.json" })).toBe(
      "handover-evidence",
    );
    expect(
      unwrap(resolveAuthoredRef({ home: "/h", ref: "handover-evidence/auto-compact-at-300k/compaction.mjs" })),
    ).toBe("handover-evidence/auto-compact-at-300k/compaction.mjs");
  });

  it("matches a dated family by prefix, but never the bare prefix itself", () => {
    expect(classifyHomeDirectory({ name: "handovers-backup-20260901" })!.directoryClass).toBe("authored");
    expect(classifyHomeDirectory({ name: "handovers-backup-" })).toBe(undefined);
  });

  it("returns undefined for a name nothing classifies", () => {
    expect(classifyHomeDirectory({ name: "never-seen-before" })).toBe(undefined);
  });
});

describe("classifyHomePath", () => {
  it("takes the deepest row, so a file row carves the tag queue out of the listener's process state", () => {
    expect(classifyHomePath({ relativePath: "live/listener/queue.jsonl" })!.directoryClass).toBe("authored");
    expect(classifyHomePath({ relativePath: "live/listener/heartbeat.json" })!.directoryClass).toBe("scratch");
    expect(classifyHomePath({ relativePath: "live/listener/logs/a.log" })!.directoryClass).toBe("scratch");
  });

  it("inherits an authored ancestor's class, and a deeper scratch row carves out of it", () => {
    expect(classifyHomePath({ relativePath: "live/slack/turn-markers/C1-1.json" })!.name).toBe(
      "live/slack/turn-markers",
    );
    expect(isAuthoredPath({ relativePath: "live/recipe/definitions/a.json" })).toBe(true);
    expect(isAuthoredPath({ relativePath: "live/recipe/locks/a.lock" })).toBe(false);
  });

  it("passes no class down from a split directory, so an entry nobody named is unclassified", () => {
    expect(classifyHomePath({ relativePath: "live" })!.directoryClass).toBe("split");
    expect(classifyHomePath({ relativePath: "live/slack/new-thing.jsonl" })).toBe(undefined);
    expect(classifyHomePath({ relativePath: "live/never-seen" })).toBe(undefined);
  });

  it("never names the provider copies a read fetched authored — they are private and unredacted", () => {
    expect(
      ["live/slack/thread-files/F1/a.png", "live/slack/file-reads/F2", "live/gmail/attachments/m/a.pdf"].filter(
        (relativePath) => isAuthoredPath({ relativePath }),
      ),
    ).toEqual([]);
  });

  it("carves the Messenger's attachments out of talk, so a file the owner attached never rides the store's backup", () => {
    expect(isAuthoredPath({ relativePath: "talk/calls/c1.jsonl" })).toBe(true);
    expect(classifyHomePath({ relativePath: "talk/attachments/u1/notes.md" })!.directoryClass).toBe("scratch");
    expect(isAuthoredPath({ relativePath: "talk/attachments/u1/notes.md" })).toBe(false);
    expect(mayHoldAuthored({ relativePath: "talk/attachments" })).toBe(false);
  });

  it("matches a prefix family only among siblings in the same parent", () => {
    expect(classifyHomePath({ relativePath: "live/loop-31aug-b/answers/a.json" })!.directoryClass).toBe("scratch");
    expect(classifyHomePath({ relativePath: "loop-31aug-b" })).toBe(undefined);
    expect(classifyHomePath({ relativePath: "live/loop-" })).toBe(undefined);
  });
});

describe("mayHoldAuthored", () => {
  it("enters a split or authored directory, and a scratch one only when a deeper row is authored", () => {
    expect(mayHoldAuthored({ relativePath: "live" })).toBe(true);
    expect(mayHoldAuthored({ relativePath: "live/listener" })).toBe(true);
    expect(mayHoldAuthored({ relativePath: "live/listener/logs" })).toBe(false);
    expect(mayHoldAuthored({ relativePath: "live/browser" })).toBe(false);
    expect(mayHoldAuthored({ relativePath: "tmp" })).toBe(false);
  });
});

describe("LIVE_CLASSIFICATION", () => {
  it("names only paths under live, each once, and splits exactly the three directories that mix classes", () => {
    expect(LIVE_CLASSIFICATION.length).toBeGreaterThan(0);
    const names = LIVE_CLASSIFICATION.map((row) => row.name);

    expect(names.filter((name) => name !== "live" && !name.startsWith("live/"))).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
    expect(LIVE_CLASSIFICATION.filter((row) => row.directoryClass === "split").map((row) => row.name)).toEqual([
      "live",
      "live/gmail",
      "live/slack",
    ]);
  });

  it("is what the home declaration classifies live by", () => {
    const declared = HOME_DIRECTORY_CLASSIFICATION.filter((row) => row.name === "live" || row.name.startsWith("live/"));

    expect(declared).toEqual(LIVE_CLASSIFICATION);
  });

  it("classifies every live path the state home declares, so a new one cannot hold the nightly import", () => {
    const declared = stringLeaves({ value: stateHomePaths({ home: "/h" }).live }).map((path) => relative("/h", path));

    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((relativePath) => classifyHomePath({ relativePath }) === undefined)).toEqual([]);
  });

  it("names the ten entries a nightly import found unclassified, each in its class", () => {
    expect(
      [
        "live/chatgpt/conversations/c1/transcript.md",
        "live/hygiene/github-landing.json",
        "live/seat-pass/s1",
        "live/sync-runs/slack/a.jsonl",
        "live/slack/awaiting.json",
        "live/slack/followup-watermarks.json",
        "live/slack/owed.json",
        "live/slack/placements.jsonl",
        "live/slack/witness-outcomes.jsonl",
        "live/slack/witness-state.json",
      ].map((relativePath) => `${relativePath} ${classifyHomePath({ relativePath })!.directoryClass}`),
    ).toEqual([
      "live/chatgpt/conversations/c1/transcript.md scratch",
      "live/hygiene/github-landing.json scratch",
      "live/seat-pass/s1 scratch",
      "live/sync-runs/slack/a.jsonl authored",
      "live/slack/awaiting.json scratch",
      "live/slack/followup-watermarks.json authored",
      "live/slack/owed.json scratch",
      "live/slack/placements.jsonl authored",
      "live/slack/witness-outcomes.jsonl authored",
      "live/slack/witness-state.json authored",
    ]);
  });
});

describe("authoredDirectoryOf", () => {
  it("names the top-level directory of a clean path under an authored one", () => {
    expect(authoredDirectoryOf({ relativePath: "briefs/a/b.md" })).toBe("briefs");
  });

  it("names the top-level directory of an authored path nested under a split one", () => {
    expect(authoredDirectoryOf({ relativePath: "live/slack/asks.jsonl" })).toBe("live");
    expect(authoredDirectoryOf({ relativePath: "live/browser/sessions/a.png" })).toBe(undefined);
    expect(authoredDirectoryOf({ relativePath: "live/slack" })).toBe(undefined);
  });

  it("names a top-level boot file as its own entry, and refuses a top-level file the class does not name", () => {
    expect(authoredDirectoryOf({ relativePath: "responders.json" })).toBe("responders.json");
    expect(authoredDirectoryOf({ relativePath: "hygiene-denylist.txt" })).toBe(undefined);
    expect(authoredDirectoryOf({ relativePath: "responders.json/x" })).toBe(undefined);
    expect(classifyHomePath({ relativePath: "responders.json/x" })).toBe(undefined);
  });

  it("refuses a path outside the class, a bare directory, and every unclean segment", () => {
    expect(authoredDirectoryOf({ relativePath: "secrets/token" })).toBe(undefined);
    expect(authoredDirectoryOf({ relativePath: "briefs" })).toBe(undefined);
    expect(authoredDirectoryOf({ relativePath: "briefs/../secrets/token" })).toBe(undefined);
    expect(authoredDirectoryOf({ relativePath: "briefs/./a.md" })).toBe(undefined);
    expect(authoredDirectoryOf({ relativePath: "briefs//a.md" })).toBe(undefined);
  });
});

describe("projectAuthoredFile", () => {
  it("stores the exact bytes under their sha-256, with the location naming the directory", () => {
    const text = "a brief\n";
    const projected = unwrap(
      projectAuthoredFile({
        bytes: bytesOf({ text }),
        denylist: [],
        fileModifiedAt: WHEN,
        relativePath: "briefs/x.md",
      }),
    );
    const sha = createHash("sha256").update(text).digest("hex");

    expect(projected.body.bodySha256).toBe(sha);
    expect(projected.body.byteLength).toBe(8);
    expect(Buffer.from(projected.body.body).toString("utf8")).toBe(text);
    expect(projected.location).toEqual({
      bodySha256: sha,
      directory: "briefs",
      fileModifiedAt: WHEN,
      relativePath: "briefs/x.md",
    });
    expect(projected.binary).toBe(false);
  });

  it("refuses a body carrying a credential, naming the file and the class", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const refused = unwrapErr(
      projectAuthoredFile({
        bytes: bytesOf({ text: `line one\ntoken=${token}\n` }),
        denylist: [],
        fileModifiedAt: WHEN,
        relativePath: "briefs/leak.md",
      }),
    );

    expect(refused.code).toBe("UNSTORABLE_AUTHORED_FILE");
    expect(refused.message).toBe(
      "briefs/leak.md is not stored as authored working state: line 2 trips the github-oauth-token secret class, and the store's dump leaves this machine",
    );
  });

  it("refuses a body carrying a private-denylist word", () => {
    const refused = unwrapErr(
      projectAuthoredFile({
        bytes: bytesOf({ text: "mentions zorblax here" }),
        denylist: ["zorblax"],
        fileModifiedAt: WHEN,
        relativePath: "morning/today.md",
      }),
    );

    expect(refused.message).toContain("denylist secret class");
  });

  it("scans a binary body as raw bytes, so a plain-ASCII token inside one is refused too", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const refused = unwrapErr(
      projectAuthoredFile({
        bytes: new Uint8Array([0, 255, ...Buffer.from(token), 0]),
        denylist: [],
        fileModifiedAt: WHEN,
        relativePath: "shots/a.png",
      }),
    );

    expect(refused.message).toBe(
      "shots/a.png is not stored as authored working state: line 1 trips the github-oauth-token secret class, and the store's dump leaves this machine",
    );
  });

  it("reads a UTF-16 body in both byte orders, where a NUL sits beside every character of a token", () => {
    const text = `token=ghp_${"a".repeat(36)}\n`;
    const little = Buffer.from(text, "utf16le");
    const big = Buffer.from(little).swap16();
    const refuse = ({ bytes }: { bytes: Buffer }): string =>
      unwrapErr(projectAuthoredFile({ bytes, denylist: [], fileModifiedAt: WHEN, relativePath: "briefs/u16.txt" }))
        .message;

    expect(refuse({ bytes: little })).toContain("UTF-16LE line 1 trips the github-oauth-token secret class");
    expect(refuse({ bytes: big })).toContain("UTF-16BE line 1 trips the github-oauth-token secret class");
  });

  it("stores a clean binary body byte-exact, marked binary", () => {
    const bytes = new Uint8Array([0, 1, 2, 200, 255]);
    const projected = unwrap(
      projectAuthoredFile({ bytes, denylist: [], fileModifiedAt: WHEN, relativePath: "shots/a.png" }),
    );

    expect(projected.binary).toBe(true);
    expect([...projected.body.body]).toEqual([0, 1, 2, 200, 255]);
  });

  it("refuses a file over the ceiling by size rather than loading it", () => {
    const refused = unwrapErr(
      projectAuthoredFile({
        bytes: new Uint8Array(AUTHORED_FILE_MAX_BYTES + 1),
        denylist: [],
        fileModifiedAt: WHEN,
        relativePath: "briefs/huge.bin",
      }),
    );

    expect(refused.message).toBe(
      `briefs/huge.bin is not stored as authored working state: it is ${String(AUTHORED_FILE_MAX_BYTES + 1)} bytes, over the ${String(AUTHORED_FILE_MAX_BYTES)}-byte ceiling`,
    );
  });

  it("refuses a path outside the class", () => {
    const refused = unwrapErr(
      projectAuthoredFile({ bytes: bytesOf({ text: "x" }), denylist: [], fileModifiedAt: WHEN, relativePath: "tmp/x" }),
    );

    expect(refused).toEqual(
      FleetImportErrors.unstorableAuthoredFile({
        path: "tmp/x",
        reason: "it is not a path ./authoredDirectories.ts classifies authored",
      }),
    );
  });
});

describe("resolveAuthoredRef", () => {
  const home = "/h/.slopweaver";

  it("reads a path under the home, an absolute path and a file URL alike", () => {
    expect(unwrap(resolveAuthoredRef({ home, ref: "briefs/a.md" }))).toBe("briefs/a.md");
    expect(unwrap(resolveAuthoredRef({ home, ref: "/h/.slopweaver/briefs/a.md" }))).toBe("briefs/a.md");
    expect(unwrap(resolveAuthoredRef({ home, ref: "file:///h/.slopweaver/briefs/a.md#L3" }))).toBe("briefs/a.md");
  });

  it("refuses a path under a directory that is not this class", () => {
    const refused = unwrapErr(resolveAuthoredRef({ home, ref: "secrets/token" }));

    expect(refused.message).toBe(
      "secrets/token is not stored as authored working state: secrets/token is not under a directory classified authored",
    );
  });

  it("refuses an absolute path outside the home", () => {
    const refused = unwrapErr(resolveAuthoredRef({ home, ref: "/elsewhere/briefs/a.md" }));

    expect(refused.message).toBe(
      `/elsewhere/briefs/a.md is not stored as authored working state: it names no file under ${home}`,
    );
  });
});

describe("absentAuthoredPaths", () => {
  it("names each stored path the walk did not list, sorted, and never one it did", () => {
    expect(
      absentAuthoredPaths({
        present: ["briefs/a.md", "runs/r/journal.jsonl"],
        stored: ["runs/r/journal.jsonl", "live/recipe/definitions/gone.json", "briefs/a.md", "handovers/swept.md"],
      }),
    ).toEqual(["handovers/swept.md", "live/recipe/definitions/gone.json"]);
  });

  it("names nothing when the store holds nothing, and everything when the walk listed nothing", () => {
    expect(absentAuthoredPaths({ present: ["briefs/a.md"], stored: [] })).toEqual([]);
    expect(absentAuthoredPaths({ present: [], stored: ["briefs/b.md", "briefs/a.md"] })).toEqual([
      "briefs/a.md",
      "briefs/b.md",
    ]);
  });
});

describe("newestPerPath", () => {
  it("keeps the newest version at each path, in path order", () => {
    const older = version({
      bodySha256: "1".repeat(64),
      fileModifiedAt: new Date("2026-09-01T00:00:00Z"),
      relativePath: "briefs/b.md",
    });
    const newer = version({
      bodySha256: "2".repeat(64),
      fileModifiedAt: new Date("2026-09-02T00:00:00Z"),
      relativePath: "briefs/b.md",
    });
    const other = version({ relativePath: "briefs/a.md" });

    expect(newestPerPath({ versions: [newer, other, older] })).toEqual([other, newer]);
  });

  it("breaks a tie on the hash, so row order never decides", () => {
    const low = version({ bodySha256: "1".repeat(64), relativePath: "briefs/a.md" });
    const high = version({ bodySha256: "f".repeat(64), relativePath: "briefs/a.md" });

    expect(newestPerPath({ versions: [high, low] })).toEqual([high]);
    expect(newestPerPath({ versions: [low, high] })).toEqual([high]);
  });

  it("returns nothing for nothing", () => {
    expect(newestPerPath({ versions: [] })).toEqual([]);
  });
});

describe("planAuthoredRestore", () => {
  it("writes an absent file, skips an identical one, and never overwrites one with other bytes", () => {
    const absent = version({ bodySha256: "1".repeat(64), relativePath: "briefs/absent.md" });
    const same = version({ bodySha256: "2".repeat(64), relativePath: "briefs/same.md" });
    const changed = version({ bodySha256: "3".repeat(64), relativePath: "briefs/changed.md" });
    const onDisk = new Map([
      ["briefs/same.md", "2".repeat(64)],
      ["briefs/changed.md", "9".repeat(64)],
    ]);

    const plan = planAuthoredRestore({ newest: [absent, same, changed], presentSha256: (path) => onDisk.get(path) });

    expect(plan).toEqual({ differs: [changed], identical: [same], write: [absent] });
  });
});

describe("listAuthoredFiles", () => {
  let home: string | undefined;

  afterEach(() => {
    rmSync(home!, { force: true, recursive: true });
  });

  it("walks only authored directories, recursively, never through a symbolic link", () => {
    home = mkdtempSync(join(tmpdir(), "authored-"));
    mkdirSync(join(home, "briefs", "deep"), { recursive: true });
    mkdirSync(join(home, "tmp"));
    mkdirSync(join(home, "secrets"));
    writeFileSync(join(home, "briefs", "b.md"), "b");
    writeFileSync(join(home, "briefs", "deep", "c.md"), "c");
    writeFileSync(join(home, "tmp", "scratch.txt"), "t");
    writeFileSync(join(home, "secrets", "token"), "s");
    symlinkSync(join(home, "secrets"), join(home, "briefs", "link"));

    const listing = listAuthoredFiles({ home });

    expect(listing.directories).toEqual(["briefs"]);
    expect(listing.files).toEqual([join(home, "briefs", "b.md"), join(home, "briefs", "deep", "c.md")]);
    expect(listing.unreadable).toEqual([]);
  });

  it("reads live/'s authored entries only, and reports an entry a split directory holds unnamed", () => {
    home = mkdtempSync(join(tmpdir(), "authored-"));
    mkdirSync(join(home, "live", "slack", "turn-markers"), { recursive: true });
    mkdirSync(join(home, "live", "slack", "thread-files", "F1"), { recursive: true });
    mkdirSync(join(home, "live", "listener", "logs"), { recursive: true });
    mkdirSync(join(home, "live", "browser", "sessions"), { recursive: true });
    writeFileSync(join(home, "live", "slack", "asks.jsonl"), "{}\n");
    writeFileSync(join(home, "live", "slack", "turn-markers", "C1-1.json"), "{}");
    writeFileSync(join(home, "live", "slack", "thread-files", "F1", "a.png"), "p");
    writeFileSync(join(home, "live", "slack", "unnamed.jsonl"), "u");
    writeFileSync(join(home, "live", "listener", "queue.jsonl"), "q");
    writeFileSync(join(home, "live", "listener", "heartbeat.json"), "h");
    writeFileSync(join(home, "live", "listener", "logs", "a.log"), "l");
    writeFileSync(join(home, "live", "browser", "sessions", "s.png"), "s");

    const listing = listAuthoredFiles({ home });

    expect(listing.directories).toEqual(["live"]);
    expect(listing.files).toEqual([
      join(home, "live", "listener", "queue.jsonl"),
      join(home, "live", "slack", "asks.jsonl"),
      join(home, "live", "slack", "turn-markers", "C1-1.json"),
    ]);
    expect(listing.unclassified).toEqual(["live/slack/unnamed.jsonl"]);
    expect(listing.unreadable).toEqual([]);
  });

  it("lists the named top-level boot files first, and no other top-level file, the retired roster included", () => {
    home = mkdtempSync(join(tmpdir(), "authored-"));
    mkdirSync(join(home, "briefs"));
    writeFileSync(join(home, "briefs", "b.md"), "b");
    writeFileSync(join(home, "responders.json"), "[]");
    writeFileSync(join(home, "identity.json"), "{}");
    writeFileSync(join(home, "hygiene-denylist.txt"), "private");
    writeFileSync(join(home, "profile.json.bak"), "{}");

    const listing = listAuthoredFiles({ home });

    expect(listing.files).toEqual([join(home, "responders.json"), join(home, "briefs", "b.md")]);
    expect(listing.directories).toEqual(["briefs"]);
  });

  it("reports a home that cannot be read rather than listing nothing silently", () => {
    home = mkdtempSync(join(tmpdir(), "authored-"));
    const missing = join(home, "absent");

    const listing = listAuthoredFiles({ home: missing });

    expect(listing.files).toEqual([]);
    expect(listing.unreadable.map((entry) => entry.locator)).toEqual([missing]);
  });
});

describe("authoredAbsolutePath", () => {
  it("places a stored path under the home", () => {
    expect(authoredAbsolutePath({ home: "/h/.slopweaver", relativePath: "briefs/deep/c.md" })).toBe(
      join("/h/.slopweaver", "briefs", "deep", "c.md"),
    );
  });
});
