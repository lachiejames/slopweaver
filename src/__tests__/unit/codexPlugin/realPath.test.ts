import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { entryPath, landingPath } from "../../../codexPlugin/realPath.js";

let root: string;

beforeEach(() => {
  // Real from the start, so an expected path is not itself spelled through the OS's own temp-directory link.
  root = realpathSync(mkdtempSync(join(tmpdir(), "codex-real-path-")));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("landingPath", () => {
  it("is the real path of an existing directory reached through a link", () => {
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "link"));
    expect(landingPath({ path: join(root, "link") })).toBe(join(root, "real"));
  });

  it("appends what does not exist yet to its deepest existing ancestor's real path", () => {
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "link"));
    expect(landingPath({ path: join(root, "link", "a", "b") })).toBe(join(root, "real", "a", "b"));
  });

  it("follows a dangling link to the directory a later mkdir would create", () => {
    symlinkSync(join(root, "cache", "codex-plugin"), join(root, "home"));
    expect(landingPath({ path: join(root, "home") })).toBe(join(root, "cache", "codex-plugin"));
  });

  it("resolves a dangling link's relative target against where the link really lives, not its lexical parent", () => {
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b", "c"), { recursive: true });
    symlinkSync(join(root, "b", "c"), join(root, "a", "link"));
    symlinkSync("../export", join(root, "a", "link", "home"));
    expect(landingPath({ path: join(root, "a", "link", "home") })).toBe(join(root, "b", "export"));
  });

  it("ends a cycle of dangling links rather than following it forever", () => {
    symlinkSync(join(root, "b"), join(root, "a"));
    symlinkSync(join(root, "a"), join(root, "b"));
    // Forty hops, an even number, end back on the first link.
    expect(landingPath({ path: join(root, "a") })).toBe(join(root, "a"));
  });
});

describe("entryPath", () => {
  it("follows a linked parent but never the final link, which is the entry a rename replaces", () => {
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "parent"));
    symlinkSync(join(root, "elsewhere"), join(root, "real", "entry"));
    expect(entryPath({ path: join(root, "parent", "entry") })).toBe(join(root, "real", "entry"));
  });
});
