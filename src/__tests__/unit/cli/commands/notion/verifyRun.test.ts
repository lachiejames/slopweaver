import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type NotionVerifyDeps, runNotionVerify } from "../../../../../cli/commands/notion/verifyRun.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { RenderObservation } from "../../../../../outbound/notion/renderFindings.js";
import { NotionVerifyErrors } from "../../../../../outbound/notion/verify.errors.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

const PAGE = "https://www.notion.so/0000000000000000000000000000a004";
const CANONICAL = "https://www.notion.so/0000000000000000000000000000a004";

const homes: string[] = [];

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-verify-run-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

interface Recorded {
  readonly out: string[];
  readonly err: string[];
  readonly read: string[];
}

const observation = (over: Partial<RenderObservation> = {}): RenderObservation => ({
  cells: [],
  mermaid: [],
  prose: [],
  ...over,
});

function harness({ document }: { document: Result<string, ReturnType<typeof NotionVerifyErrors.outputUnwritable>> }): {
  deps: NotionVerifyDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = { err: [], out: [], read: [] };
  const deps: NotionVerifyDeps = {
    err: (line) => {
      recorded.err.push(line);
    },
    out: (line) => {
      recorded.out.push(line);
    },
    readObservation: ({ path }) => {
      recorded.read.push(path);
      return document;
    },
    rendersDir: ({ home }) => join(home, "notion-renders"),
  };
  return { deps, recorded };
}

const argv = ({ tail }: { tail: readonly string[] }): readonly string[] => ["node", "cli", "notion", "verify", ...tail];

describe("runNotionVerify — the brief", () => {
  it("prints the brief, and reads nothing, when no observation is supplied", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({ document: ok("{}") });
    const code = runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home] }), deps });
    expect(code).toBe(0);
    expect(recorded.read.length).toBe(0);
    expect(recorded.out[1]).toBe(`open: ${CANONICAL}`);
  });

  it("names the measurement script, so the session runs the same one the judge was built around", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({ document: ok("{}") });
    runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home] }), deps });
    expect(recorded.out.join("\n")).toContain("(no slopweaver verb yet)");
    expect(recorded.out.join("\n")).toContain("notion-table-cell-text");
  });

  it("resolves a slugged app.notion.com URL to the canonical page address", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({ document: ok("{}") });
    runNotionVerify({
      argv: argv({
        tail: ["https://app.notion.com/p/Some-Slug-0000000000000000000000000000a004", "--home", home],
      }),
      deps,
    });
    expect(recorded.out[1]).toBe(`open: ${CANONICAL}`);
  });

  it("points the brief's screenshots under the home by default, one directory per page", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({ document: ok("{}") });
    runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home] }), deps });
    expect(recorded.out.join("\n")).toContain(join(home, "notion-renders", "00000000-0000-0000-0000-00000000a004"));
  });

  it("honours an explicit --out", () => {
    const home = scratchHome();
    const out = join(home, "elsewhere");
    const { deps, recorded } = harness({ document: ok("{}") });
    runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home, "--out", out] }), deps });
    expect(recorded.out.join("\n")).toContain(out);
  });
});

describe("runNotionVerify — judging a measurement", () => {
  it("exits 0 and reports no findings on a clean page", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({ document: ok(JSON.stringify(observation())) });
    const code = runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home, "--observation", "/o.json"] }), deps });
    expect(code).toBe(0);
    expect(recorded.out[recorded.out.length - 1]).toContain("no findings");
  });

  it("exits 3 when the page rendered a broken cell", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({
      document: ok(
        JSON.stringify(
          observation({
            cells: [
              {
                anchorHrefs: [],
                anchorTexts: [],
                column: 1,
                heightPx: 20,
                lineHeightPx: 20,
                row: 1,
                table: 1,
                text: "[DDDD-839](https://linear.app/x/DDDD-839)",
              },
            ],
          }),
        ),
      ),
    });
    const code = runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home, "--observation", "/o.json"] }), deps });
    expect(code).toBe(3);
    expect(recorded.out.join("\n")).toContain("literal-markdown-link");
  });

  it("exits 1 and says the check did not run when the document will not parse", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({ document: ok("not json") });
    const code = runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home, "--observation", "/o.json"] }), deps });
    expect(code).toBe(1);
    expect(recorded.err.join("\n")).toContain("did NOT run");
    expect(recorded.out.length).toBe(0);
  });

  it("exits 1 rather than reporting a clean page when the document describes nothing", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({ document: ok("{}") });
    const code = runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home, "--observation", "/o.json"] }), deps });
    expect(code).toBe(1);
    expect(recorded.err.join("\n")).toContain("did NOT run");
  });

  it("exits 1 and says so when the document cannot be read at all", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({
      document: err(NotionVerifyErrors.outputUnwritable({ detail: "ENOENT", path: "/o.json" })),
    });
    const code = runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home, "--observation", "/o.json"] }), deps });
    expect(code).toBe(1);
    expect(recorded.err.join("\n")).toContain("did NOT run");
  });

  it("emits one machine-readable document under --json", () => {
    const home = scratchHome();
    const out = join(home, "shots");
    const { deps, recorded } = harness({ document: ok(JSON.stringify(observation())) });
    const code = runNotionVerify({
      argv: argv({ tail: [PAGE, "--home", home, "--observation", "/o.json", "--out", out, "--json"] }),
      deps,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(recorded.out.join("\n"));
    expect(parsed).toEqual({
      cellLineBudget: 6,
      findings: [],
      mermaidBlocks: 0,
      proseBlocks: 0,
      screenshots: [out],
      tableCells: 0,
      url: CANONICAL,
      verified: true,
    });
  });

  it("exits 2 on an address that is not a Notion object", () => {
    const home = scratchHome();
    const { deps, recorded } = harness({ document: ok("{}") });
    const code = runNotionVerify({ argv: argv({ tail: ["not-a-page", "--home", home] }), deps });
    expect(code).toBe(2);
    expect(recorded.out.length).toBe(0);
  });

  it("refuses an --out inside a checkout before printing a brief or reading an observation", () => {
    const home = scratchHome();
    const repo = realpathSync(scratchHome());
    gitInTemp({ args: ["init", "-q"], cwd: repo });
    const { deps, recorded } = harness({ document: ok("{}") });
    const out = join(repo, "screenshots");
    const code = runNotionVerify({ argv: argv({ tail: [PAGE, "--home", home, "--out", out] }), deps });
    expect(code).toBe(1);
    expect(recorded.out).toEqual([]);
    expect(recorded.err[0]).toBe(
      `${out} is inside the git checkout ${repo}, where a commit can carry it into a pull request; nothing was captured`,
    );
  });
});
