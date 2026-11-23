/**
 * The not-a-bump store: what reads as no rulings, what is refused rather than read as empty, how a ruling
 * matches a package, and what recording one twice leaves behind.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  isNotABumpPackageSpelling,
  NotABumpErrors,
  type NotABumpRuling,
  packageIsNotABump,
  readNotABumpRulings,
  recordNotABumpRuling,
} from "../../../../live/vuln/notABumpStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const REPO = "acme/acme-admin";

/** One valid ruling, overridable field by field. */
function ruling(over: Partial<NotABumpRuling> = {}): NotABumpRuling {
  return {
    anchor: "knowledge:p-0000000000009007",
    package: "fastify",
    recordedIso: "2026-10-27T03:00:00.000Z",
    repo: REPO,
    why: "blocked behind the fastify 5 migration",
    ...over,
  };
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "not-a-bump-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The store's own path under the test home. */
function storePath(): string {
  return stateHomePaths({ home }).live.vuln.notABumpJson;
}

/** Write raw text where the store reads. */
function writeStore({ text }: { text: string }): void {
  mkdirSync(dirname(storePath()), { recursive: true });
  writeFileSync(storePath(), text);
}

describe("readNotABumpRulings", () => {
  it("reads an absent file as no rulings", () => {
    expect(unwrap(readNotABumpRulings({ home }))).toEqual([]);
  });

  it("reads every ruling a valid document holds, in order", () => {
    const entries = [ruling(), ruling({ package: "@fastify/*" })];
    writeStore({ text: JSON.stringify({ entries }) });

    expect(unwrap(readNotABumpRulings({ home }))).toEqual(entries);
  });

  it("refuses a file that is not JSON rather than reading it as empty", () => {
    writeStore({ text: "{not json" });

    const error = readNotABumpRulings({ home })._unsafeUnwrapErr();

    expect(error.code).toBe("NOT_A_BUMP_UNREADABLE");
    expect(error.path).toBe(storePath());
  });

  it.each([
    ["an unknown key on a ruling", { entries: [{ ...ruling(), extra: 1 }] }, "extra"],
    ["an unknown top-level key", { entries: [], more: [] }, "more"],
    ["a repository that is not owner/name", { entries: [ruling({ repo: "acme-admin" })] }, "owner/name"],
    ["a wildcard other than a whole scope", { entries: [ruling({ package: "fastify*" })] }, "@scope/*"],
    ["a blank why", { entries: [ruling({ why: "  " })] }, "why"],
    ["a date that is not an instant", { entries: [ruling({ recordedIso: "27 Oct" })] }, "recordedIso"],
    ["the same package ruled twice", { entries: [ruling(), ruling({ why: "again" })] }, "ruled twice"],
  ])("refuses %s, naming it", (_name, document, fragment) => {
    writeStore({ text: JSON.stringify(document) });

    const error = readNotABumpRulings({ home })._unsafeUnwrapErr();

    expect(error.code).toBe("NOT_A_BUMP_UNREADABLE");
    expect(error.message).toContain(fragment);
  });

  it("refuses a read that fails for any reason but absence", () => {
    const read = readNotABumpRulings({
      home,
      readFile: () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });

    expect(read._unsafeUnwrapErr()).toEqual(
      NotABumpErrors.unreadable({ path: storePath(), why: "EACCES: permission denied" }),
    );
  });
});

describe("packageIsNotABump", () => {
  const rulings = [ruling(), ruling({ package: "@fastify/*" })];

  it.each([
    ["fastify", true],
    ["@fastify/reply-from", true],
    ["fastify-plugin", false],
    ["@fastifyx/core", false],
    ["@fastify", false],
    ["happy-dom", false],
  ])("%s → %s", (packageName, expected) => {
    expect(packageIsNotABump({ packageName, repo: REPO, rulings })).toBe(expected);
  });

  it("never reaches past the repository a ruling names", () => {
    expect(packageIsNotABump({ packageName: "fastify", repo: "acme/other", rulings })).toBe(false);
  });
});

describe("isNotABumpPackageSpelling", () => {
  it.each([
    ["fastify", true],
    ["@fastify/reply-from", true],
    ["@fastify/*", true],
    ["fastify*", false],
    ["@fastify/reply-*", false],
    ["*", false],
    ["two words", false],
  ])("%s → %s", (spelling, expected) => {
    expect(isNotABumpPackageSpelling({ spelling })).toBe(expected);
  });
});

describe("recordNotABumpRuling", () => {
  it("writes the first ruling to an owner-only file and reads it back", () => {
    expect(unwrap(recordNotABumpRuling({ home, ruling: ruling() }))).toEqual([ruling()]);
    expect(unwrap(readNotABumpRulings({ home }))).toEqual([ruling()]);
    expect(statSync(storePath()).mode & 0o777).toBe(0o600);
  });

  it("upserts by repository and package, the newer word replacing the older", () => {
    recordNotABumpRuling({ home, ruling: ruling() });
    recordNotABumpRuling({ home, ruling: ruling({ package: "@fastify/*" }) });
    const newer = ruling({ recordedIso: "2026-10-28T00:00:00.000Z", why: "still on fastify 4" });

    expect(unwrap(recordNotABumpRuling({ home, ruling: newer }))).toEqual([ruling({ package: "@fastify/*" }), newer]);
  });

  it("keeps the same package in another repository as its own ruling", () => {
    recordNotABumpRuling({ home, ruling: ruling() });

    expect(unwrap(recordNotABumpRuling({ home, ruling: ruling({ repo: "acme/other" }) }))).toEqual([
      ruling(),
      ruling({ repo: "acme/other" }),
    ]);
  });

  it("refuses an invalid ruling and leaves the file unwritten", () => {
    const error = recordNotABumpRuling({ home, ruling: ruling({ package: "fastify*" }) })._unsafeUnwrapErr();

    expect(error.code).toBe("NOT_A_BUMP_WRITE_FAILED");
    expect(unwrap(readNotABumpRulings({ home }))).toEqual([]);
  });

  it("refuses to write over a file it cannot read, leaving that file as it was", () => {
    writeStore({ text: "{not json" });

    const error = recordNotABumpRuling({ home, ruling: ruling() })._unsafeUnwrapErr();

    expect(error.code).toBe("NOT_A_BUMP_UNREADABLE");
    expect(readFileSync(storePath(), "utf8")).toBe("{not json");
  });
});
