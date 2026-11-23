/**
 * The briefing's payload-sized string reads, run in a child whose V8 compiles every regular expression
 * unoptimised — the mode a long-lived process falls into by ordinary work (`src/lib/base64Run.ts` carries the
 * mechanism). The unit lane's non-isolated fork reached it, and `imageCaps.test.ts` failed there on every
 * cold shard with `RangeError: Maximum call stack size exceeded` while passing alone.
 *
 * This cannot live on the unit lane: the mode is a process-wide V8 flag, `--no-regexp-optimization`, and a
 * unit test cannot start a process or set a flag for the fork it shares.
 *
 * The falsifiable half is the CONTROL. A green read of the functions alone would also be green on a V8
 * that ignored the flag, so the same child first runs a regex quantified over the whole payload and the case
 * asserts it throws there — proving the child really is in the mode the functions are being judged in.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const VOCABULARY = join(repoRoot, "src", "outbound", "briefing", "vocabulary.ts");
const SCHEMA_WALK = join(repoRoot, "src", "outbound", "briefing", "schemaWalk.ts");
const PAGE_BUDGET = join(repoRoot, "src", "briefing", "pageBudget.ts");
/** The form-case seams `imageCaps.test.ts` reads the schema through, so the child parses a whole card. */
const FORM_CASES = join(repoRoot, "src", "__tests__", "unit", "outbound", "briefing", "form");

/** The TypeScript loader, handed to `node` directly — `../lib/stdoutDataChannel.test.ts` § TSX_LOADER. */
const TSX_LOADER = import.meta.resolve("tsx");

/** The per-image byte cap, `IMAGE_MAX_BYTES` in `src/briefing/caps.ts`: 5,592,408 base64 characters. */
const IMAGE_BYTES = 4 * 1024 * 1024;

/** A deadline rather than a request: a hung child fails loudly. */
const CHILD_DEADLINE_MS = 60_000;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A child script printing the control's outcome and every image-path read's answer over one at-cap image: the
 * whole form schema (whose image `refine` is its own read of the URI), the page's image weight, the decoder and
 * the page's text weight.
 */
function writeProbe(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-regexp-mode-"));
  fixtureDirs.push(dir);
  // `.mts`: the temp dir has no `"type": "module"` package above it, and the top-level `await` needs ESM.
  const script = join(dir, "probe.mts");
  writeFileSync(
    script,
    [
      `const { decodedImageBytes } = await import(${JSON.stringify(VOCABULARY)});`,
      `const { pageImageBytes } = await import(${JSON.stringify(SCHEMA_WALK)});`,
      `const { pageTextBytes } = await import(${JSON.stringify(PAGE_BUDGET)});`,
      `const { dataUriOfBytes, withCard } = await import(${JSON.stringify(join(FORM_CASES, "fixtures.ts"))});`,
      `const { refusals } = await import(${JSON.stringify(join(FORM_CASES, "harness.ts"))});`,
      `const uri = dataUriOfBytes({ bytes: ${String(IMAGE_BYTES)} });`,
      `const form = withCard({ over: { detail: { blocks: [{ alt: "a screenshot", data: uri, kind: "image" }], summary: "the screenshot" } } });`,
      `let control = "no throw";`,
      `try { /^data:image\\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri); } catch (e) { control = String(e); }`,
      `process.stdout.write(JSON.stringify({`,
      `  control,`,
      `  decoded: decodedImageBytes({ dataUri: uri }),`,
      `  page: pageTextBytes({ html: '<img src="' + uri + '">' }),`,
      // The header's own two runs are payload-sized too when a page carries a long type or subtype.
      `  longSubtypePage: pageTextBytes({ html: '<img src="data:image/' + "a".repeat(${String(IMAGE_BYTES)}) + ';base64,AAAA">' }),`,
      `  longTypePage: pageTextBytes({ html: '<img src="data:' + "a".repeat(${String(IMAGE_BYTES)}) + '/png;base64,AAAA">' }),`,
      `  pageImage: pageImageBytes({ form }),`,
      `  refusals: refusals({ form }),`,
      `}));`,
    ].join("\n"),
  );
  return script;
}

/** Every child's environment, with `NODE_OPTIONS` removed — `../lib/stdoutDataChannel.test.ts` § emitterEnv. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  return env;
}

describe("the briefing's payload-sized reads under unoptimised regexp compilation", () => {
  it("decodes an at-cap image and weighs a page embedding it, where a quantified regex throws", () => {
    const child = spawnSync(process.execPath, ["--no-regexp-optimization", "--import", TSX_LOADER, writeProbe()], {
      cwd: repoRoot,
      encoding: "utf8",
      env: childEnv(),
      killSignal: "SIGKILL",
      timeout: CHILD_DEADLINE_MS,
    });

    expect(child.error).toBe(undefined);
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      control: "RangeError: Maximum call stack size exceeded",
      decoded: IMAGE_BYTES,
      longSubtypePage: 12,
      longTypePage: 12,
      page: 12,
      pageImage: IMAGE_BYTES,
      refusals: [],
    });
  });
});
