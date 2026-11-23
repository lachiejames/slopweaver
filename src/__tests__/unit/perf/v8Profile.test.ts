import { describe, expect, it } from "vitest";
import {
  cpuProfileSchema,
  cpuSelfTimeByModule,
  heapProfileSchema,
  heapSelfSizeByModule,
  moduleBucketOf,
} from "../../../perf/v8Profile.js";

describe("moduleBucketOf", () => {
  const cases: readonly { readonly url: string; readonly functionName: string; readonly bucket: string }[] = [
    { bucket: "(garbage collector)", functionName: "(garbage collector)", url: "" },
    { bucket: "(anonymous)", functionName: "", url: "" },
    { bucket: "node:internal", functionName: "readFileSync", url: "node:fs" },
    {
      bucket: "node_modules/typescript",
      functionName: "checkSourceFile",
      url: "file:///repo/node_modules/typescript/lib/typescript.js",
    },
    {
      bucket: "node_modules/@datadog/datadog-api-client",
      functionName: "send",
      url: "/repo/node_modules/@datadog/datadog-api-client/dist/index.js",
    },
    {
      bucket: "node_modules/typescript",
      functionName: "nested",
      url: "/repo/node_modules/vitest/node_modules/typescript/lib/x.js",
    },
    { bucket: "src/devLint", functionName: "scan", url: "file:///repo/src/devLint/namedObjectParams.ts" },
    { bucket: "src", functionName: "main", url: "file:///repo/src/index.ts" },
    { bucket: "other", functionName: "run", url: "file:///repo/scripts/docs-site.sh" },
  ];

  it("covers every case in the table", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  cases.forEach(({ url, functionName, bucket }) => {
    it(`buckets ${functionName} at ${url} as ${bucket}`, () => {
      expect(moduleBucketOf({ functionName, url })).toBe(bucket);
    });
  });
});

describe("cpuSelfTimeByModule", () => {
  const document = cpuProfileSchema.parse({
    nodes: [
      { callFrame: { functionName: "check", url: "/repo/node_modules/typescript/lib/typescript.js" }, id: 1 },
      { callFrame: { functionName: "scan", url: "/repo/src/devLint/namedObjectParams.ts" }, id: 2 },
      { callFrame: { functionName: "(garbage collector)", url: "" }, id: 3 },
    ],
    samples: [1, 1, 2, 3],
    timeDeltas: [600, 200, 100, 100],
  });

  it("attributes each delta to the sample it precedes and ranks the heaviest first", () => {
    expect(cpuSelfTimeByModule({ document })).toEqual([
      { module: "node_modules/typescript", share: 0.8, value: 800 },
      { module: "src/devLint", share: 0.1, value: 100 },
      { module: "(garbage collector)", share: 0.1, value: 100 },
    ]);
  });

  it("folds over the shorter array when V8 truncated one of them", () => {
    const truncated = cpuProfileSchema.parse({
      nodes: [{ callFrame: { functionName: "check", url: "/repo/node_modules/typescript/lib/a.js" }, id: 1 }],
      samples: [1, 1, 1],
      timeDeltas: [500],
    });
    expect(cpuSelfTimeByModule({ document: truncated })).toEqual([
      { module: "node_modules/typescript", share: 1, value: 500 },
    ]);
  });

  it("reports nothing rather than dividing by zero on an empty profile", () => {
    const empty = cpuProfileSchema.parse({ nodes: [], samples: [], timeDeltas: [] });
    expect(cpuSelfTimeByModule({ document: empty })).toEqual([]);
  });

  it("skips a sample naming a node the profile never declared", () => {
    const dangling = cpuProfileSchema.parse({
      nodes: [{ callFrame: { functionName: "a", url: "/repo/src/lib/a.ts" }, id: 1 }],
      samples: [1, 99],
      timeDeltas: [10, 90],
    });
    expect(dangling.samples.length).toBe(2);
    expect(cpuSelfTimeByModule({ document: dangling })).toEqual([{ module: "src/lib", share: 1, value: 10 }]);
  });
});

describe("heapSelfSizeByModule", () => {
  it("sums selfSize over the whole tree, not just the root", () => {
    const document = heapProfileSchema.parse({
      head: {
        callFrame: { functionName: "(root)", url: "" },
        children: [
          {
            callFrame: { functionName: "parse", url: "/repo/node_modules/typescript/lib/typescript.js" },
            children: [
              {
                callFrame: { functionName: "bind", url: "/repo/node_modules/typescript/lib/typescript.js" },
                children: [],
                selfSize: 1000,
              },
            ],
            selfSize: 2000,
          },
          {
            callFrame: { functionName: "scan", url: "/repo/src/devLint/x.ts" },
            children: [],
            selfSize: 1000,
          },
        ],
        selfSize: 0,
      },
    });
    expect(heapSelfSizeByModule({ document })).toEqual([
      { module: "node_modules/typescript", share: 0.75, value: 3000 },
      { module: "src/devLint", share: 0.25, value: 1000 },
    ]);
  });

  it("ignores a child that is not a node rather than throwing", () => {
    const document = heapProfileSchema.parse({
      head: {
        callFrame: { functionName: "(root)", url: "" },
        children: [
          "not a node",
          { callFrame: { functionName: "f", url: "/repo/src/lib/f.ts" }, children: [], selfSize: 8 },
        ],
        selfSize: 0,
      },
    });
    expect(heapSelfSizeByModule({ document })).toEqual([{ module: "src/lib", share: 1, value: 8 }]);
  });
});
