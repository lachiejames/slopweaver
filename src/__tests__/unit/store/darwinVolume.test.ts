/**
 * The two device probes in `darwinVolume.ts` that need no `diskutil`: whether a path is a mount point now, and
 * which device a write under a path would land on. Exercised over a temp folder, which is an ordinary folder on
 * the same device as its parent — exactly the shape a pulled drive leaves behind at its mount point.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deviceUnder, mountedDevice } from "../../../store/backup/darwinVolume.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "darwin-volume-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("mountedDevice", () => {
  it("answers null for an ordinary folder on its parent's device", () => {
    const folder = join(dir, "Drive");
    mkdirSync(folder);
    expect(mountedDevice({ mountPoint: folder })).toBe(null);
  });

  it("answers null for a mount point that is absent", () => {
    expect(mountedDevice({ mountPoint: join(dir, "Gone") })).toBe(null);
  });
});

describe("deviceUnder", () => {
  it("answers the device of an existing path", () => {
    expect(deviceUnder({ path: dir })).toBe(statSync(dir).dev);
  });

  it("answers the device of the deepest existing ancestor of a path not made yet", () => {
    expect(deviceUnder({ path: join(dir, "not", "made", "yet") })).toBe(statSync(dir).dev);
  });
});
