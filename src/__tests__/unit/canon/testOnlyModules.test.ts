/**
 * The test-only-module ratchet: a production module under `src/` that only tests import fails here.
 *
 * `knip` and `internal-exports` both count a test import as a use, so a module nothing at runtime loads stays green
 * in both for as long as a test keeps importing it (an audit found the reviewer-picker parser in `src/review/`,
 * a parser for a reviewer-picker nothing ever called, passing every gate for ten weeks). Two describe blocks, the
 * `staleReferences.test.ts` shape: the first exercises the PURE finder on inline fixtures, the second reads this
 * repository and requires the finder's answer to EQUAL {@link ALLOWED} exactly. Equal, not subset: a new test-only
 * module fails, and so does an entry whose module was wired, moved or deleted, so the table can only shrink
 * honestly and never rots into naming a module that no longer qualifies.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { readTextAhead } from "../../../lib/readAhead.js";
import { computedDynamicImportsIn, testOnlyModulesOf } from "../../testOnlyModules.js";

/** Why a group of modules is allowed to be reachable only from tests. */
const OWNER_KEPT_VANTA =
  "owner's call on the audit page: the Vanta SDK client stays, never deleted; a later ruling made its every read strict";
const OWNER_KEPT_READ_PLAN =
  "owner's call on the audit page: the read-plan recorder stays, neither deleted nor changed here";
const TEST_IS_THE_CONSUMER =
  "a check whose consumer is a unit test by design: it runs with the suite and has no runtime caller to want";
const CANON_NAMES_IT_LIVE =
  "canon (a skill, a doc or a header) describes it as live or as a declared next step, so it is the owner's to settle, not a sweep's";
const UNWIRED_CONTROL =
  "a field-denial table the atlas descriptor names as the boundary and no production sync consults: an unwired control to wire, never to delete";
/** Every production module that tests alone keep alive today, each with the reason it is allowed to stay. */
const ALLOWED: Readonly<Record<string, string>> = {
  "src/atlas/airtable/sensitiveFields.ts": UNWIRED_CONTROL,
  "src/atlas/figma/sensitiveFields.ts": UNWIRED_CONTROL,
  "src/atlas/prismaDataPlatform/sensitiveFields.ts": UNWIRED_CONTROL,
  "src/atlas/vanta/sdk/VantaClient.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/errors.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/httpBoundary.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/operations/controls.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/operations/controlsBoundaries.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/operations/documents.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/operations/documentsBoundaries.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/operations/tests.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/operations/testsBoundaries.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/operations/vendors.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/operations/vendorsBoundaries.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/pageQuery.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/schemas/controls.ts": OWNER_KEPT_VANTA,
  "src/atlas/vanta/sdk/schemas/tests.ts": OWNER_KEPT_VANTA,
  "src/canon/datadogProdEnvQueries.ts": TEST_IS_THE_CONSUMER,
  "src/canon/diagramReferences.ts": TEST_IS_THE_CONSUMER,
  "src/canon/docCoverage.ts": TEST_IS_THE_CONSUMER,
  "src/canon/listenDeadline.ts": TEST_IS_THE_CONSUMER,
  "src/canon/movedHeadings.ts": TEST_IS_THE_CONSUMER,
  "src/canon/ratchetGates.ts": TEST_IS_THE_CONSUMER,
  "src/canon/recoveryChannelLiteral.ts": TEST_IS_THE_CONSUMER,
  "src/canon/secretsStoreMention.ts": TEST_IS_THE_CONSUMER,
  "src/canon/staleReferences.ts": TEST_IS_THE_CONSUMER,
  "src/claude/events.ts": CANON_NAMES_IT_LIVE,
  "src/claude/transcriptSignal.ts": CANON_NAMES_IT_LIVE,
  "src/coderabbit/schemaCheck.ts": TEST_IS_THE_CONSUMER,
  "src/datadog/logsAnalytics.ts": CANON_NAMES_IT_LIVE,
  "src/footprint/entities.ts": CANON_NAMES_IT_LIVE,
  "src/footprint/grouping.ts": CANON_NAMES_IT_LIVE,
  "src/footprint/ledger.ts": CANON_NAMES_IT_LIVE,
  "src/footprint/nodes.ts": CANON_NAMES_IT_LIVE,
  "src/footprint/scan.ts": CANON_NAMES_IT_LIVE,
  "src/live/recordReadPlan.ts": OWNER_KEPT_READ_PLAN,
  "src/live/turn/freshnessCard.ts": CANON_NAMES_IT_LIVE,
  "src/outbound/assistant/prListRender.ts": CANON_NAMES_IT_LIVE,
  "src/outbound/slack/prLeadCallSites.ts": TEST_IS_THE_CONSUMER,
  "src/outbound/slack/prLeadSeams.ts": TEST_IS_THE_CONSUMER,
  "src/reflect/briefingSection.ts": CANON_NAMES_IT_LIVE,
  "src/reflect/briefingSectionErrors.ts": CANON_NAMES_IT_LIVE,
  "src/retrieval/justInTime.ts": CANON_NAMES_IT_LIVE,
  "src/route/sourceNouns.ts": TEST_IS_THE_CONSUMER,
  "src/talk/callAssessmentPort.ts": CANON_NAMES_IT_LIVE,
  "src/talk/slackRouteCases.ts": TEST_IS_THE_CONSUMER,
};

/** A one-line module that imports nothing. */
const LEAF = "export const leaf = 1;\n";

describe("testOnlyModulesOf", () => {
  it("lists a module only a test imports", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/__tests__/unit/a/leaf.test.ts", 'import { leaf } from "../../../a/leaf.js";\nvoid leaf;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual(["src/a/leaf.ts"]);
  });

  it("does not list a module a production module also imports", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/a/user.ts", 'import { leaf } from "./leaf.js";\nexport const user = leaf;\n'],
      ["src/b/main.ts", 'import { user } from "../a/user.js";\nexport const main = user;\n'],
      ["src/__tests__/unit/a/leaf.test.ts", 'import { leaf } from "../../../a/leaf.js";\nvoid leaf;\n'],
      ["src/__tests__/unit/a/user.test.ts", 'import { user } from "../../../a/user.js";\nvoid user;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("lists a whole chain that only a test reaches, importer and imported alike", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/a/head.ts", 'import { leaf } from "./leaf.js";\nexport const head = leaf;\n'],
      ["src/__tests__/unit/a/head.test.ts", 'import { head } from "../../../a/head.js";\nvoid head;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual(["src/a/head.ts", "src/a/leaf.ts"]);
  });

  it("leaves a module nothing imports to knip, because no test keeps it alive", () => {
    const sources = new Map([["src/a/orphan.ts", LEAF]]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("counts an importer outside src/ as production", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["scripts/run.ts", 'import { leaf } from "../src/a/leaf.js";\nvoid leaf;\n'],
      ["src/__tests__/unit/a/leaf.test.ts", 'import { leaf } from "../../../a/leaf.js";\nvoid leaf;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("follows a #lib/ subpath import and a directory index import", () => {
    const sources = new Map([
      ["src/lib/helper.ts", LEAF],
      ["src/dir/index.ts", LEAF],
      [
        "src/__tests__/unit/x.test.ts",
        'import { leaf } from "#lib/helper.js";\nimport { leaf as l2 } from "../../dir";\nvoid [leaf, l2];\n',
      ],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual(["src/dir/index.ts", "src/lib/helper.ts"]);
  });

  it("lists a cycle only a test enters, and not one a production module also enters", () => {
    const sources = new Map([
      ["src/a/ping.ts", 'import { pong } from "./pong.js";\nexport const ping = () => pong;\n'],
      ["src/a/pong.ts", 'import { ping } from "./ping.js";\nexport const pong = () => ping;\n'],
      ["src/__tests__/unit/a/ping.test.ts", 'import { ping } from "../../../a/ping.js";\nvoid ping;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual(["src/a/ping.ts", "src/a/pong.ts"]);
    const entered = new Map([...sources, ["src/b/main.ts", 'import { pong } from "../a/pong.js";\nvoid pong;\n']]);
    expect(testOnlyModulesOf({ sources: entered })).toEqual([]);
  });

  it("lists the test-only branch of a diamond and keeps the branch production reaches", () => {
    const sources = new Map([
      ["src/a/hub.ts", 'import { l } from "./left.js";\nimport { r } from "./right.js";\nexport const hub = [l, r];\n'],
      ["src/a/left.ts", 'import { leaf } from "./leaf.js";\nexport const l = leaf;\n'],
      ["src/a/right.ts", 'import { leaf } from "./leaf.js";\nexport const r = leaf;\n'],
      ["src/a/leaf.ts", LEAF],
      ["src/__tests__/unit/a/hub.test.ts", 'import { hub } from "../../../a/hub.js";\nvoid hub;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([
      "src/a/hub.ts",
      "src/a/leaf.ts",
      "src/a/left.ts",
      "src/a/right.ts",
    ]);
    const reached = new Map([...sources, ["src/cli.ts", 'import { r } from "./a/right.js";\nvoid r;\n']]);
    expect(testOnlyModulesOf({ sources: reached })).toEqual(["src/a/hub.ts", "src/a/left.ts"]);
  });

  it("resolves a .tsx target and an actual .js target", () => {
    const sources = new Map([
      ["src/a/view.tsx", LEAF],
      ["src/a/plain.js", LEAF],
      [
        "src/__tests__/unit/a/view.test.ts",
        'import { leaf } from "../../../a/view.js";\nimport { leaf as p } from "../../../a/plain.js";\nvoid [leaf, p];\n',
      ],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual(["src/a/plain.js", "src/a/view.tsx"]);
  });

  it("treats a deferred import as a production importer", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/__tests__/unit/a/leaf.test.ts", 'import { leaf } from "../../../a/leaf.js";\nvoid leaf;\n'],
      ["src/cli.ts", 'import defer * as leaf from "./a/leaf.js";\nvoid leaf;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("treats a namespace re-export as a production importer", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/b/barrel.ts", 'export * as leaf from "../a/leaf.js";\n'],
      ["src/__tests__/unit/a/leaf.test.ts", 'import { leaf } from "../../../a/leaf.js";\nvoid leaf;\n'],
      ["src/cli.ts", 'import { leaf } from "./b/barrel.js";\nvoid leaf;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("treats a namespace re-export written with comments between its keywords as a production importer", () => {
    const sources = new Map([
      ["src/a/x.ts", LEAF],
      ["src/a/y.ts", LEAF],
      ["src/b/barrel.ts", 'export /* c */ * /* d */ as a from "../a/x.js";\nexport *\n// e\nas b from "../a/y.js";\n'],
      [
        "src/__tests__/unit/a/x.test.ts",
        'import { leaf } from "../../../a/x.js";\nimport { leaf as y } from "../../../a/y.js";\nvoid [leaf, y];\n',
      ],
      ["src/cli.ts", 'import { a, b } from "./b/barrel.js";\nvoid [a, b];\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("treats a namespace re-export after a line comment ended by a bare carriage return as a production importer", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/b/barrel.ts", 'export * // c\ras a from "../a/leaf.js";\n'],
      ["src/__tests__/unit/a/leaf.test.ts", 'import { leaf } from "../../../a/leaf.js";\nvoid leaf;\n'],
      ["src/cli.ts", 'import { a } from "./b/barrel.js";\nvoid a;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("treats a star re-export and a named re-export as production importers", () => {
    const sources = new Map([
      ["src/a/y.ts", LEAF],
      ["src/a/z.ts", LEAF],
      ["src/b/barrel.ts", 'export * from "../a/y.js";\nexport { leaf as b } from "../a/z.js";\n'],
      [
        "src/__tests__/unit/a/y.test.ts",
        'import { leaf } from "../../../a/y.js";\nimport { leaf as z } from "../../../a/z.js";\nvoid [leaf, z];\n',
      ],
      ["src/cli.ts", 'import { b, leaf } from "./b/barrel.js";\nvoid [b, leaf];\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("does not take a namespace re-export that only a comment holds for an import", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/a/other.ts", '/** export * as leaf from "./leaf.js" */\nexport const other = 1;\n'],
      ["src/__tests__/unit/a/leaf.test.ts", 'import { leaf } from "../../../a/leaf.js";\nvoid leaf;\n'],
      ["src/cli.ts", 'import { other } from "./a/other.js";\nvoid other;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual(["src/a/leaf.ts"]);
  });

  it("lists the target of a deferred import only a test makes", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/__tests__/unit/a/leaf.test.ts", 'import defer * as ns from "../../../a/leaf.js";\nvoid ns;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual(["src/a/leaf.ts"]);
  });

  it("lists the target of a namespace re-export only a test barrel makes", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/__tests__/barrel.ts", 'export * as leaf from "../a/leaf.js";\n'],
      ["src/__tests__/unit/a/leaf.test.ts", 'import { leaf } from "../../barrel.js";\nvoid leaf;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual(["src/a/leaf.ts"]);
  });

  it("does not take a .test.ts outside __tests__ for a test, since no lane runs it", () => {
    const sources = new Map([
      ["src/a/leaf.ts", LEAF],
      ["src/a/boot.test.ts", 'import { leaf } from "./leaf.js";\nvoid leaf;\n'],
      ["src/cli.ts", 'import "./a/boot.test.js";\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });

  it("does not judge a test support file under __tests__ as a production module", () => {
    const sources = new Map([
      ["src/__tests__/support.ts", LEAF],
      ["src/__tests__/unit/x.test.ts", 'import { leaf } from "../support.js";\nvoid leaf;\n'],
    ]);
    expect(testOnlyModulesOf({ sources })).toEqual([]);
  });
});

describe("computedDynamicImportsIn", () => {
  it("counts an import whose specifier is a variable", () => {
    expect(computedDynamicImportsIn({ content: "const target = './leaf.js';\nvoid import(target);\n" })).toEqual([
      "target",
    ]);
  });

  it("counts an import written with whitespace or a comment before the parenthesis", () => {
    expect(computedDynamicImportsIn({ content: "void import (target);\nvoid import /* c */ (other);\n" })).toEqual([
      "target",
      "other",
    ]);
  });

  it("counts an import whose specifier is built from a template substitution", () => {
    expect(computedDynamicImportsIn({ content: "void import(`./${name}.js`);\n" })).toEqual(["`./${name}.js`"]);
  });

  it("does not count a literal specifier or a substitution-free template", () => {
    expect(computedDynamicImportsIn({ content: "void import('./leaf.js');\nvoid import(`./leaf.js`);\n" })).toEqual([]);
  });

  it("does not count a file with no dynamic import", () => {
    expect(computedDynamicImportsIn({ content: LEAF })).toEqual([]);
  });
});

describe("the real tree", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..", "..");

  interface Scan {
    readonly count: number;
    readonly found: readonly string[];
    readonly computed: Readonly<Record<string, readonly string[]>>;
  }

  let scanned: Promise<Scan> | undefined;

  /**
   * Read the tree once and share the answer across this block's cases, which only read it. The files are read
   * concurrently, since one blocking read at a time was the largest single cost of this block (`src/lib/readAhead.ts`).
   */
  async function readScan(): Promise<Scan> {
    const paths = workingTreeFilesOf({ root }).filter(
      (path) => /\.(tsx?|mts|cjs|mjs|js)$/.test(path) && !path.endsWith(".d.ts"),
    );
    const readText = await readTextAhead({ paths, root });
    const sources = new Map(paths.map((path) => [path, readText({ path })] as const));
    const computed = Object.fromEntries(
      [...sources]
        .filter(([path]) => path.startsWith("src/") && !path.split("/").includes("__tests__"))
        .map(([path, content]) => [path, computedDynamicImportsIn({ content })] as const)
        .filter(([, specifiers]) => specifiers.length > 0),
    );
    return { computed, count: sources.size, found: testOnlyModulesOf({ sources }) };
  }

  /**
   * The one shared scan, started by whichever case asks first. A scan that failed is forgotten as it fails, so the
   * next case reads the tree afresh rather than inheriting a failure the filesystem may since have cleared.
   */
  function scan(): Promise<Scan> {
    if (scanned !== undefined) {
      return scanned;
    }
    scanned = readScan().catch((error: unknown) => {
      scanned = undefined;
      throw error;
    });
    return scanned;
  }

  // The first case pays the whole-tree read and parse for the block: ~7s idle, several times that on a loaded runner.
  it("scans the real tree", { timeout: 120_000 }, async () => {
    expect((await scan()).count).toBeGreaterThan(0);
  });

  it("finds no test-only production module outside the reasoned allowlist", async () => {
    expect((await scan()).found.filter((path) => !(path in ALLOWED))).toEqual([]);
  });

  it("carries no allowlist entry whose module is no longer test-only", async () => {
    const current = new Set((await scan()).found);
    expect(Object.keys(ALLOWED).filter((path) => !current.has(path))).toEqual([]);
  });

  it("has no production computed dynamic import, bar the one that loads migration files by name", async () => {
    expect((await scan()).computed).toEqual({
      "src/devLint/drizzleMigrationsRun.ts": ["pathToFileURL(join(process.cwd(), SCHEMA_DIR, file)).href"],
    });
  });

  it("gives every allowlist entry a reason", () => {
    expect(Object.keys(ALLOWED).length).toBeGreaterThan(0);
    expect(Object.entries(ALLOWED).filter(([, reason]) => reason.trim().length === 0)).toEqual([]);
  });
});
