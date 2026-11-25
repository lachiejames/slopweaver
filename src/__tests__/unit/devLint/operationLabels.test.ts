/**
 * The operation-label gate. The property under test is the one that makes a 75-second hang impossible to
 * reintroduce: a label absent from the registry, or one no static gate can resolve, fails the build.
 *
 * `mapped` is INJECTED rather than read from the real registry, so these cases assert the scanner's logic
 * instead of restating `OPERATION_ENDPOINT_CLASS`. The real map is checked separately, by the gate itself
 * running over the real tree in `yarn lint` and by `rateLimitsCoverage.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  BLOCK_WAIT_EXEMPT,
  isScannablePath,
  labelMessage,
  PACING_EXEMPT,
  scanOperationLabels,
} from "../../../devLint/operationLabels.js";

const MAPPED: ReadonlySet<string> = new Set(["slack.conversations.history", "slack.auth.test.write.bot"]);

describe("scanOperationLabels (pure)", () => {
  it("passes a mapped static label inside a safeProviderCall", () => {
    const content = [
      "const res = await safeProviderCall({",
      "  execute: () => client.conversations.history({ channel }),",
      '  operation: "slack.conversations.history",',
      '  provider: "slack",',
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/ok.ts" })).toEqual([]);
  });

  it("flags a label absent from the registry, naming the offending label", () => {
    const content = [
      "const res = await safeProviderCall({",
      "  execute: () => client.conversations.members({ channel }),",
      '  operation: "slack.conversations.members",',
      "});",
    ].join("\n");
    const hits = scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("unmapped-label");
    expect(hits[0]!.excerpt).toBe("slack.conversations.members");
    expect(hits[0]!.line).toBe(3);
  });

  it("flags a TEMPLATE-literal label, which no static gate could resolve against the map", () => {
    const content = [
      "const res = await safeProviderCall({",
      "  execute: () => client.auth.test(),",
      "  operation: `slack.auth.test.write.${lane}`,",
      "});",
    ].join("\n");
    const hits = scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("dynamic-label");
    expect(hits[0]!.line).toBe(3);
  });

  it("flags the same unmapped label in a safeApiCall too — the gate is not door-specific", () => {
    const content = ["const r = await safeApiCall({", '  operation: "notion.unmapped",', "});"].join("\n");
    const hits = scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("unmapped-label");
  });

  it("ignores an `operation:` that is NOT inside a safe*Call opener", () => {
    const content = ['const policy = { operation: "not.a.boundary.label", retries: 3 };'].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/ok.ts" })).toEqual([]);
  });

  it("flags `blockWait: false` outside the preflight allowlist", () => {
    const content = [
      "const res = await safeProviderCall({",
      "  blockWait: false,",
      '  operation: "slack.conversations.history",',
      "});",
    ].join("\n");
    const hits = scanOperationLabels({ content, mapped: MAPPED, path: "src/corpus/slack/api.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("unsanctioned-block-skip");
  });

  it("allows `blockWait: false` in the connect preflight, which is the one sanctioned file", () => {
    const content = [
      "const res = await safeProviderCall({",
      "  blockWait: false,",
      '  operation: "slack.conversations.history",',
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/connect/probes.ts" })).toEqual([]);
  });

  it("keeps the block-skip allowlist to exactly the connect preflight", () => {
    expect([...BLOCK_WAIT_EXEMPT]).toEqual(["src/connect/probes.ts"]);
  });

  it("flags `paced: false` outside the read-seam allowlist", () => {
    const content = [
      "const res = await safeProviderCall({",
      "  paced: false,",
      '  operation: "slack.conversations.history",',
      "});",
    ].join("\n");
    const hits = scanOperationLabels({ content, mapped: MAPPED, path: "src/corpus/slack/writeApi.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.reason).toBe("unsanctioned-pacing-skip");
  });

  it("allows `paced: false` in a Slack READ seam, whose tier is shared with the paced write lane", () => {
    const content = [
      "const res = await safeProviderCall({",
      "  paced: false,",
      '  operation: "slack.conversations.history",',
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/corpus/slack/api.ts" })).toEqual([]);
  });

  it("keeps the pacing allowlist to exactly the two Slack read seams", () => {
    expect([...PACING_EXEMPT]).toEqual(["src/corpus/slack/api.ts", "src/corpus/slack/structures.ts"]);
  });
});

describe("scanOperationLabels — a label passed by name", () => {
  it("flags a shorthand label bound to an unmapped const, at the USE line rather than the declaration", () => {
    const content = [
      'const operation = "acme.widgets.list";',
      "const res = await safeProviderCall({",
      "  execute: () => client.widgets.list(),",
      "  operation,",
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" })).toEqual([
      { excerpt: "acme.widgets.list", line: 4, path: "src/x.ts", reason: "unmapped-label" },
    ]);
  });

  it("flags `operation: SOME_CONST` bound to an unmapped label, `as const` and single quotes included", () => {
    const content = [
      "const WIDGETS_READ = 'acme.widgets.read' as const;",
      "const res = await safeApiCall({",
      "  operation: WIDGETS_READ,",
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" })).toEqual([
      { excerpt: "acme.widgets.read", line: 3, path: "src/x.ts", reason: "unmapped-label" },
    ]);
  });

  it("passes a shorthand and a named label that both resolve to mapped consts", () => {
    const content = [
      'export const BOT_PROBE = "slack.auth.test.write.bot";',
      "async function history() {",
      '  const operation = "slack.conversations.history";',
      "  return safeProviderCall({",
      "    operation,",
      "  });",
      "}",
      "async function probe() {",
      "  return safeProviderCall({",
      "    operation: BOT_PROBE,",
      "  });",
      "}",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/ok.ts" })).toEqual([]);
  });

  it("resolves a const with a non-ASCII name, which is as much an identifier as an ASCII one", () => {
    const content = [
      'const Ωlabel = "acme.widgets.read";',
      "const res = await safeProviderCall({",
      "  operation: Ωlabel,",
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" })).toEqual([
      { excerpt: "acme.widgets.read", line: 3, path: "src/x.ts", reason: "unmapped-label" },
    ]);
  });

  it("resolves a const whose literal the formatter wrapped onto the next line", () => {
    const content = [
      "const WIDGETS_READ =",
      '  "acme.widgets.read";',
      "const res = await safeProviderCall({",
      "  operation: WIDGETS_READ,",
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" })).toEqual([
      { excerpt: "acme.widgets.read", line: 4, path: "src/x.ts", reason: "unmapped-label" },
    ]);
  });

  it("flags an EXPORTED const exactly like a local one", () => {
    const content = [
      'export const WIDGETS_READ = "acme.widgets.read";',
      "const res = await safeProviderCall({",
      "  operation: WIDGETS_READ,",
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" })).toEqual([
      { excerpt: "acme.widgets.read", line: 3, path: "src/x.ts", reason: "unmapped-label" },
    ]);
  });

  it("resolves each use to the const its OWN scope sees, never a same-named one elsewhere in the file", () => {
    const content = [
      'const LABEL = "slack.conversations.history";',
      "async function inner() {",
      '  const LABEL = "acme.widgets.list";',
      "  return safeProviderCall({",
      "    operation: LABEL,",
      "  });",
      "}",
      "async function outer() {",
      "  return safeProviderCall({",
      "    operation: LABEL,",
      "  });",
      "}",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/x.ts" })).toEqual([
      { excerpt: "acme.widgets.list", line: 5, path: "src/x.ts", reason: "unmapped-label" },
    ]);
  });

  it("never reads an outer const through a namespace-local `import X = …` alias that shadows it", () => {
    const content = [
      'namespace Other { export const LABEL = "slack.conversations.history"; }',
      'const LABEL = "acme.widgets.read";',
      "namespace Inner {",
      "  import LABEL = Other.LABEL;",
      "  safeProviderCall({",
      "    operation: LABEL,",
      "  });",
      "}",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/ok.ts" })).toEqual([]);
  });

  it("never reads a same-named const in another function as the label a wrapper forwards by parameter", () => {
    const content = [
      "function describeIt() {",
      '  const operation = "some prose about a widget";',
      "  return operation;",
      "}",
      "async function send({ operation }: { operation: string }) {",
      "  return safeProviderCall({",
      "    execute: () => fetch(url),",
      "    operation,",
      "  });",
      "}",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/ok.ts" })).toEqual([]);
  });

  // The declared limit, pinned so a change to it shows up here: a name that does not resolve to a same-file `const`
  // string is unchecked rather than refused, because a forwarding wrapper has no label at that site to check.
  it.each([
    [
      "a forwarded parameter",
      [
        "async function send({ operation }: { operation: string }) {",
        "  return safeProviderCall({",
        "    operation,",
        "  });",
        "}",
      ],
    ],
    [
      "a ternary initialiser",
      [
        'const operation = lane === "bot" ? "acme.bot.read" : "acme.user.read";',
        "safeProviderCall({",
        "  operation,",
        "});",
      ],
    ],
    ["a `let`", ['let LABEL = "acme.widgets.read";', "safeProviderCall({", "  operation: LABEL,", "});"]],
    ["an import", ['import { LABEL } from "./labels.js";', "safeProviderCall({", "  operation: LABEL,", "});"]],
    [
      "a property read",
      ['const request = { op: "acme.widgets.read" };', "safeProviderCall({", "  operation: request.op,", "});"],
    ],
  ])("leaves %s unchecked — the declared limit", (_shape, lines) => {
    expect(scanOperationLabels({ content: lines.join("\n"), mapped: MAPPED, path: "src/ok.ts" })).toEqual([]);
  });

  it("leaves a bound label past the 24-line window unchecked — the declared window limit, not wanted coverage", () => {
    const filler = Array.from({ length: 24 }, () => "  // filler");
    const content = [
      'const LABEL = "acme.widgets.read";',
      "safeProviderCall({",
      ...filler,
      "  operation: LABEL,",
      "});",
    ].join("\n");
    expect(scanOperationLabels({ content, mapped: MAPPED, path: "src/ok.ts" })).toEqual([]);
  });
});

describe("labelMessage", () => {
  it("tells an unmapped-label reader about the tier1 fallback that makes it dangerous", () => {
    const message = labelMessage({
      hit: { excerpt: "slack.nope", line: 7, path: "src/x.ts", reason: "unmapped-label" },
    });
    expect(message).toContain("src/x.ts:7");
    expect(message).toContain("slack.nope");
    expect(message).toContain("75-SECOND");
    expect(message).toContain("src/lib/operationEndpointClass.ts");
  });

  it("tells a dynamic-label reader to use one literal per branch", () => {
    const message = labelMessage({ hit: { excerpt: "`x${y}`", line: 2, path: "src/x.ts", reason: "dynamic-label" } });
    expect(message).toContain("template literal");
    expect(message).toContain("static string literal");
  });

  it("tells a pacing-skip reader which files may opt out", () => {
    const message = labelMessage({
      hit: { excerpt: "paced: false,", line: 4, path: "src/x.ts", reason: "unsanctioned-pacing-skip" },
    });
    expect(message).toContain("PACING_EXEMPT");
    expect(message).toContain("Slack READ seams");
  });

  it("tells a block-skip reader that the exemption is the preflight's alone", () => {
    const message = labelMessage({
      hit: { excerpt: "blockWait: false,", line: 3, path: "src/x.ts", reason: "unsanctioned-block-skip" },
    });
    expect(message).toContain("BLOCK_WAIT_EXEMPT");
    expect(message).toContain("ingest must queue");
  });
});

describe("isScannablePath", () => {
  it("accepts a non-test .ts file under src/", () => {
    expect(isScannablePath({ path: "src/corpus/slack/api.ts" })).toBe(true);
  });

  it("accepts a non-test .ts file under eval/", () => {
    expect(isScannablePath({ path: "eval/askProvider.ts" })).toBe(true);
  });

  it("rejects a test file, a path outside src/eval/hooks, and this gate's own sources", () => {
    expect(isScannablePath({ path: "src/corpus/slack/api.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "scripts/build.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/operationLabels.ts" })).toBe(false);
  });
});
