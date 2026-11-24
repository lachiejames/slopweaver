/** The manifest a prebuilt PreToolUse bundle generation carries, and the rule that decides whether it may run. */
import { describe, expect, it } from "vitest";
import { HookBundleErrors } from "../../../admit/hookBundleErrors.js";
import {
  firstInputChangedSince,
  HOOK_BUNDLE_MANIFEST_FORMAT,
  type HookBundleInputStamp,
  hookBundleFreshness,
  hookBundleInputPaths,
  hookBundleInputStamp,
  hookBundleManifest,
  parseHookBundleManifest,
} from "../../../admit/hookBundleManifest.js";
import { unwrap } from "../../../lib/result.js";

/** One input's stamp, every field overridable. */
function stamp({ path, over = {} }: { path: string; over?: Partial<HookBundleInputStamp> }): HookBundleInputStamp {
  return {
    ctimeNs: "1700000000000000001",
    device: "16777231",
    inode: "4242",
    mode: "33188",
    mtimeNs: "1700000000000000000",
    path,
    size: "1565",
    ...over,
  };
}

const ENTRY = stamp({ path: "hooks/pretooluse.ts" });
const LIB = stamp({ over: { inode: "4343" }, path: "src/lib/errorMessage.ts" });
const OUT = stamp({ over: { inode: "9191" }, path: ".hook-build/generation-1-ab/entry.mjs" });
const MANIFEST = unwrap(hookBundleManifest({ inputs: [ENTRY, LIB], outputs: [OUT] }));
/** What every stamped file stats to while the generation is untouched. */
const NOW = new Map([ENTRY, LIB, OUT].map((recorded) => [recorded.path, recorded]));

describe("hookBundleInputStamp", () => {
  it("writes every bigint stat field as a decimal string, nanoseconds intact", () => {
    expect(
      hookBundleInputStamp({
        path: "hooks/pretooluse.ts",
        stats: {
          ctimeNs: 1_700_000_000_000_000_001n,
          dev: 16_777_231n,
          ino: 4242n,
          mode: 33_188n,
          mtimeNs: 1_700_000_000_000_000_000n,
          size: 1565n,
        },
      }),
    ).toEqual(ENTRY);
  });
});

describe("hookBundleInputPaths", () => {
  it("takes every input the build read, adds the files that steer resolution, sorted without repeats", () => {
    const metafile = { inputs: { "src/lib/errorMessage.ts": {}, "hooks/pretooluse.ts": {}, "package.json": {} } };
    expect(unwrap(hookBundleInputPaths({ extra: ["package.json", "yarn.lock"], metafile }))).toEqual([
      "hooks/pretooluse.ts",
      "package.json",
      "src/lib/errorMessage.ts",
      "yarn.lock",
    ]);
  });

  it("refuses a build that read nothing, which would vouch for nothing", () => {
    const result = hookBundleInputPaths({ extra: ["package.json"], metafile: { inputs: {} } });
    expect(result._unsafeUnwrapErr().code).toBe("HOOK_BUNDLE_NO_INPUTS");
  });

  it("refuses a metafile with no inputs object", () => {
    const result = hookBundleInputPaths({ extra: [], metafile: { outputs: {} } });
    expect(result._unsafeUnwrapErr().message).toBe("esbuild metafile is malformed: no inputs object");
  });

  it("refuses an inputs array, which is not the shape esbuild writes", () => {
    const result = hookBundleInputPaths({ extra: [], metafile: { inputs: ["hooks/pretooluse.ts"] } });
    expect(result._unsafeUnwrapErr().message).toBe("esbuild metafile is malformed: inputs is not an object");
  });

  it.each([["../elsewhere/zod.ts"], ["/abs/src/lib/x.ts"], ["src/./lib/x.ts"], ["src//x.ts"]])(
    "refuses %s, which no root-relative stamp can name",
    (path) => {
      const result = hookBundleInputPaths({ extra: [], metafile: { inputs: { [path]: {}, "hooks/a.ts": {} } } });
      expect(result._unsafeUnwrapErr()).toEqual({
        code: "HOOK_BUNDLE_INPUT_OUTSIDE_ROOT",
        message: `bundle input ${path} is not a path inside the source root`,
        path,
      });
    },
  );
});

describe("firstInputChangedSince", () => {
  it("finds nothing when every input's ctime is strictly before the build began", () => {
    expect(firstInputChangedSince({ inputs: [ENTRY, LIB], sinceCtimeNs: "1700000000000000002" })).toBeUndefined();
  });

  it("names a file saved mid-build whose size and mtime were put back, by its ctime alone", () => {
    const saved = stamp({ over: { ctimeNs: "1700000000000000999", inode: "4343" }, path: LIB.path });
    expect(firstInputChangedSince({ inputs: [ENTRY, saved], sinceCtimeNs: "1700000000000000500" })).toBe(
      "src/lib/errorMessage.ts",
    );
  });

  it("names a file whose ctime EQUALS the start instant, since the clock cannot order the two", () => {
    expect(firstInputChangedSince({ inputs: [ENTRY, LIB], sinceCtimeNs: "1700000000000000001" })).toBe(
      "hooks/pretooluse.ts",
    );
  });

  it("compares as integers, never as strings, across a digit-count boundary", () => {
    const early = stamp({ over: { ctimeNs: "999999999999999999" }, path: ENTRY.path });
    expect(firstInputChangedSince({ inputs: [early], sinceCtimeNs: "1000000000000000000" })).toBeUndefined();
  });
});

describe("hookBundleManifest", () => {
  it("refuses an empty input set", () => {
    expect(hookBundleManifest({ inputs: [], outputs: [OUT] })._unsafeUnwrapErr()).toEqual(HookBundleErrors.noInputs());
  });

  it("refuses an empty output set, which would leave a truncated entry free to answer", () => {
    expect(hookBundleManifest({ inputs: [ENTRY], outputs: [] })._unsafeUnwrapErr()).toEqual(
      HookBundleErrors.noOutputs(),
    );
  });

  it("round-trips through JSON exactly", () => {
    expect(unwrap(parseHookBundleManifest({ text: JSON.stringify(MANIFEST) }))).toEqual({
      format: HOOK_BUNDLE_MANIFEST_FORMAT,
      inputs: [ENTRY, LIB],
      outputs: [OUT],
    });
  });
});

describe("parseHookBundleManifest", () => {
  it.each([
    ["not JSON", "{", "not JSON"],
    ["a JSON array", "[]", "not an object"],
    ["another version", JSON.stringify({ ...MANIFEST, format: "slopweaver-pretooluse-bundle-v0" }), "unknown format"],
    ["no inputs", JSON.stringify({ ...MANIFEST, inputs: [] }), "no inputs"],
    [
      "the v1 shape, with no outputs",
      JSON.stringify({ format: HOOK_BUNDLE_MANIFEST_FORMAT, inputs: [ENTRY] }),
      "no outputs",
    ],
    ["no outputs", JSON.stringify({ ...MANIFEST, outputs: [] }), "no outputs"],
    [
      "a numeric size",
      JSON.stringify({ ...MANIFEST, inputs: [{ ...ENTRY, size: 1565 }] }),
      "input hooks/pretooluse.ts has no decimal size",
    ],
    [
      "a negative inode",
      JSON.stringify({ ...MANIFEST, inputs: [{ ...ENTRY, inode: "-1" }] }),
      "input hooks/pretooluse.ts has no decimal inode",
    ],
    [
      "a parent-relative path",
      JSON.stringify({ ...MANIFEST, inputs: [{ ...ENTRY, path: "../x.ts" }] }),
      "input 0 has no root-relative path",
    ],
    [
      "a path listed twice",
      JSON.stringify({ ...MANIFEST, inputs: [ENTRY, ENTRY] }),
      "hooks/pretooluse.ts is listed twice",
    ],
    [
      "a path that is both an input and an output",
      JSON.stringify({ ...MANIFEST, outputs: [ENTRY] }),
      "hooks/pretooluse.ts is listed twice",
    ],
  ])("refuses %s", (_label, text, detail) => {
    expect(parseHookBundleManifest({ text })._unsafeUnwrapErr()).toEqual({
      code: "HOOK_BUNDLE_MANIFEST_MALFORMED",
      message: `hook bundle manifest is malformed: ${detail}`,
    });
  });
});

describe("hookBundleFreshness", () => {
  it("is fresh when every input and output stats to its recorded stamp", () => {
    expect(hookBundleFreshness({ manifest: MANIFEST, readStamp: (path) => NOW.get(path) })).toEqual({
      kind: "fresh",
    });
  });

  it("is stale when an input is gone", () => {
    expect(
      hookBundleFreshness({
        manifest: MANIFEST,
        readStamp: (path) => (path === LIB.path ? undefined : NOW.get(path)),
      }),
    ).toEqual({ kind: "stale", path: "src/lib/errorMessage.ts", reason: "gone or unreadable" });
  });

  it("is stale when the generation's own entry was truncated, every source file untouched", () => {
    const truncated = stamp({ over: { inode: "9191", size: "0" }, path: OUT.path });
    expect(
      hookBundleFreshness({ manifest: MANIFEST, readStamp: (path) => (path === OUT.path ? truncated : NOW.get(path)) }),
    ).toEqual({ kind: "stale", path: ".hook-build/generation-1-ab/entry.mjs", reason: "size changed" });
  });

  it.each([["device"], ["inode"], ["mode"], ["size"], ["mtimeNs"], ["ctimeNs"]] as const)(
    "is stale when only the %s moved",
    (field) => {
      const moved = stamp({ over: { [field]: "1" }, path: ENTRY.path });
      expect(
        hookBundleFreshness({ manifest: MANIFEST, readStamp: (path) => (path === ENTRY.path ? moved : NOW.get(path)) }),
      ).toEqual({ kind: "stale", path: "hooks/pretooluse.ts", reason: `${field} changed` });
    },
  );

  it("stops at the first stale input, statting nothing after it", () => {
    const asked: string[] = [];
    hookBundleFreshness({
      manifest: MANIFEST,
      readStamp: (path) => {
        asked.push(path);
        return undefined;
      },
    });
    expect(asked).toEqual(["hooks/pretooluse.ts"]);
  });
});
