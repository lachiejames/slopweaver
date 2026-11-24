import { describe, expect, it } from "vitest";
import { type BuildManifest, parseBuildManifest, type SourceStamp, stalenessOf } from "../../../builtCli/staleness.js";

const stamp = (over: Partial<SourceStamp> = {}): SourceStamp => ({
  mtimeMs: 1_000,
  path: "src/a.ts",
  size: 10,
  ...over,
});

const manifest = ({ stamps }: { stamps: readonly SourceStamp[] }): BuildManifest => ({
  builtAtIso: "2026-09-21T00:00:00.000Z",
  root: "/repo",
  stamps,
});

describe("stalenessOf", () => {
  it("is fresh when every stamp matches, and says how many it checked", () => {
    const current = [stamp(), stamp({ path: "src/b.ts" })];

    const staleness = stalenessOf({ current, manifest: manifest({ stamps: current }) });

    expect(staleness.stale).toBe(false);
    expect(staleness.why).toBe("2 source file(s) unchanged since the build at 2026-09-21T00:00:00.000Z");
  });

  it("is fresh over an empty tree", () => {
    const staleness = stalenessOf({ current: [], manifest: manifest({ stamps: [] }) });

    expect(staleness.stale).toBe(false);
    expect(staleness.why).toBe("0 source file(s) unchanged since the build at 2026-09-21T00:00:00.000Z");
  });

  it("names a file whose size changed, with both sizes", () => {
    const staleness = stalenessOf({ current: [stamp({ size: 12 })], manifest: manifest({ stamps: [stamp()] }) });

    expect(staleness.stale).toBe(true);
    expect(staleness.why).toBe("src/a.ts is 12 bytes, 10 at build time");
  });

  it("names a file that was only touched, where the size is identical", () => {
    const staleness = stalenessOf({ current: [stamp({ mtimeMs: 2_000 })], manifest: manifest({ stamps: [stamp()] }) });

    expect(staleness.stale).toBe(true);
    expect(staleness.why).toBe("src/a.ts has changed since the build");
  });

  it("names a file added since the build", () => {
    const staleness = stalenessOf({
      current: [stamp(), stamp({ path: "src/new.ts" })],
      manifest: manifest({ stamps: [stamp()] }),
    });

    expect(staleness.stale).toBe(true);
    expect(staleness.why).toBe("src/new.ts is new since the build");
  });

  it("names a file gone since the build — the arm a per-file walk of the CURRENT tree cannot see", () => {
    const staleness = stalenessOf({
      current: [stamp()],
      manifest: manifest({ stamps: [stamp(), stamp({ path: "src/gone.ts" })] }),
    });

    expect(staleness.stale).toBe(true);
    expect(staleness.why).toBe("src/gone.ts is gone since the build");
  });

  it("reports the first difference in path order, whatever order the scan produced", () => {
    const staleness = stalenessOf({
      current: [stamp({ path: "src/z.ts", size: 99 }), stamp({ path: "src/a.ts", size: 99 })],
      manifest: manifest({ stamps: [stamp({ path: "src/a.ts" }), stamp({ path: "src/z.ts" })] }),
    });

    expect(staleness.why).toBe("src/a.ts is 99 bytes, 10 at build time");
  });

  it("names a path holding a line break on one line, quoted with the break escaped, in every arm", () => {
    // The separator and its escape are both built from the code point, so neither sits raw in this source.
    const separator = 0x2028;
    const path = `src/line\nbreak${String.fromCodePoint(separator)}.ts`;
    const quoted = `${String.raw`"src/line\nbreak`}\\u${separator.toString(16)}.ts"`;
    const odd = stamp({ path });

    const reasons = [
      stalenessOf({ current: [odd], manifest: manifest({ stamps: [] }) }),
      stalenessOf({ current: [stamp({ path, size: 12 })], manifest: manifest({ stamps: [odd] }) }),
      stalenessOf({ current: [stamp({ mtimeMs: 2_000, path })], manifest: manifest({ stamps: [odd] }) }),
      stalenessOf({ current: [], manifest: manifest({ stamps: [odd] }) }),
    ].map((staleness) => staleness.why);

    expect(reasons).toEqual([
      `${quoted} is new since the build`,
      `${quoted} is 12 bytes, 10 at build time`,
      `${quoted} has changed since the build`,
      `${quoted} is gone since the build`,
    ]);
  });

  it("is stale for a manifest repeating a path, even when its last stamp matches — a Map would keep only that one", () => {
    const current = stamp({ mtimeMs: 2_000, size: 20 });

    const staleness = stalenessOf({ current: [current], manifest: manifest({ stamps: [stamp(), current] }) });

    expect(staleness.stale).toBe(true);
    expect(staleness.why).toBe("the build manifest records a source path more than once");
  });
});

describe("parseBuildManifest", () => {
  it("round-trips a manifest it wrote", () => {
    const written = JSON.stringify(manifest({ stamps: [stamp()] }));

    expect(parseBuildManifest({ text: written })).toEqual(manifest({ stamps: [stamp()] }));
  });

  it("refuses a document that is not an object", () => {
    expect(parseBuildManifest({ text: "[]" })).toBeUndefined();
    expect(parseBuildManifest({ text: "null" })).toBeUndefined();
  });

  it("refuses text that is not JSON at all, rather than throwing at the guard reading it", () => {
    expect(parseBuildManifest({ text: "not json" })).toBeUndefined();
    expect(parseBuildManifest({ text: '{"builtAtIso":' })).toBeUndefined();
  });

  it("refuses a manifest missing its build time", () => {
    expect(parseBuildManifest({ text: '{"root":"/repo","stamps":[]}' })).toBeUndefined();
  });

  it("refuses a manifest that names no source root — the field the guard scans", () => {
    expect(parseBuildManifest({ text: '{"builtAtIso":"2026-09-21T00:00:00.000Z","stamps":[]}' })).toBeUndefined();
  });

  it("refuses a stamp whose size is not a number", () => {
    const text =
      '{"builtAtIso":"2026-09-21T00:00:00.000Z","root":"/repo","stamps":[{"path":"src/a.ts","mtimeMs":1,"size":"10"}]}';

    expect(parseBuildManifest({ text })).toBeUndefined();
  });
});
