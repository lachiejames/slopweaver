/**
 * `sop draft`, `sop lint` and `sop publish` driven through their real shells, with plain fakes at the edges.
 *
 * No mocks: `SopDeps` is a bag of plain functions, so a test supplies its own reader, writer and publisher
 * and reads what the verb actually did with them.
 */
import { describe, expect, it } from "vitest";
import { SOP_FORM_EXAMPLE } from "../../../../../cli/commands/sop/formExample.js";
import {
  runSopDraft,
  runSopLint,
  runSopPublish,
  type SopDeps,
  type SopPublishOutcome,
} from "../../../../../cli/commands/sop/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { renderSop } from "../../../../../outbound/sop/render.js";

/** What one invocation wrote, so an assertion reads the effect rather than a return value. */
interface Recorder {
  readonly out: string[];
  readonly err: string[];
  readonly written: { path: string; text: string }[];
  readonly published: Parameters<SopDeps["publishPage"]>[0][];
  readonly deps: SopDeps;
}

/** A dependency bag that records every edge, reading `source` back from a fixed map. */
function recorder({
  files = {},
  outcome = { code: EXIT_OK, pageUrl: "https://example.test/page" },
}: {
  files?: Readonly<Record<string, string>>;
  outcome?: SopPublishOutcome;
} = {}): Recorder {
  const out: string[] = [];
  const err: string[] = [];
  const written: { path: string; text: string }[] = [];
  const published: Parameters<SopDeps["publishPage"]>[0][] = [];
  const deps: SopDeps = {
    err: (line) => err.push(line),
    out: (line) => out.push(line),
    publishPage: async (args) => {
      published.push(args);
      return outcome;
    },
    readText: ({ source }) => {
      const found = files[source];
      if (found === undefined) {
        throw new Error(`no such fixture: ${source}`);
      }
      return found;
    },
    writeText: (file) => written.push(file),
  };
  return { deps, err, out, published, written };
}

/** The argv a verb sees, with the four leading tokens its offset skips. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "sop", verb, ...rest];
}

const FORM_JSON = JSON.stringify(SOP_FORM_EXAMPLE);
const CLEAN = renderSop({ form: SOP_FORM_EXAMPLE });

describe("sop draft", () => {
  it("prints a form example that the very same verb then accepts", async () => {
    const example = recorder();
    expect(await runSopDraft({ argv: argv({ rest: ["--form-example"], verb: "draft" }), deps: example.deps })).toBe(
      EXIT_OK,
    );
    const round = recorder({ files: { "-": example.out.join("\n") } });
    expect(await runSopDraft({ argv: argv({ rest: ["--form", "-"], verb: "draft" }), deps: round.deps })).toBe(EXIT_OK);
    expect(round.out.join("\n")).toContain("## Steps");
    expect(round.err).toContain("lint: clean");
  });

  it("writes the draft to --out and reports the title and icon it did not put in the body", async () => {
    const run = recorder({ files: { "-": FORM_JSON } });
    await runSopDraft({ argv: argv({ rest: ["--form", "-", "--out", "/tmp/d.md"], verb: "draft" }), deps: run.deps });
    expect(run.written).toEqual([{ path: "/tmp/d.md", text: CLEAN }]);
    expect(run.err).toContain("title: SOP: Granting a seat on the ticketing tool   icon: 📋");
  });

  it("refuses a form the schema rejects, naming the field", async () => {
    const run = recorder({ files: { "-": JSON.stringify({ ...SOP_FORM_EXAMPLE, purpose: "TODO" }) } });
    expect(await runSopDraft({ argv: argv({ rest: ["--form", "-"], verb: "draft" }), deps: run.deps })).toBe(
      EXIT_USAGE,
    );
    expect(run.err.join("\n")).toContain("purpose: the purpose still carries a placeholder");
  });
});

describe("sop lint", () => {
  it("passes a rendered draft", async () => {
    const run = recorder({ files: { "d.md": CLEAN } });
    expect(await runSopLint({ argv: argv({ rest: ["d.md"], verb: "lint" }), deps: run.deps })).toBe(EXIT_OK);
    expect(run.out).toEqual(["sop: 0 blocking findings — ready to publish"]);
  });

  it("reports a finding as a diagnostic exit rather than a usage error", async () => {
    const run = recorder({ files: { "d.md": CLEAN.replace("\n**Who:** a tool admin\n", "\n") } });
    expect(await runSopLint({ argv: argv({ rest: ["d.md"], verb: "lint" }), deps: run.deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(run.err.join("\n")).toContain("[step-without-actor]");
  });

  it("emits one machine-readable document under --json", async () => {
    const run = recorder({ files: { "d.md": CLEAN } });
    await runSopLint({ argv: argv({ rest: ["d.md", "--json"], verb: "lint" }), deps: run.deps });
    expect(JSON.parse(run.out.join("\n"))).toEqual({ blocked: false, findings: [] });
  });

  it("refuses a file it cannot read", async () => {
    const run = recorder();
    expect(await runSopLint({ argv: argv({ rest: ["missing.md"], verb: "lint" }), deps: run.deps })).toBe(EXIT_ERROR);
    expect(run.err).toEqual(["cannot read missing.md"]);
  });
});

describe("sop publish", () => {
  it("hands the bytes to the one Notion write path, with the destination it resolved", async () => {
    const run = recorder({ files: { "d.md": CLEAN } });
    const rest = ["d.md", "--parent", "a-parent", "--title", "SOP: A title", "--home", "/tmp/home"];
    expect(await runSopPublish({ argv: argv({ rest, verb: "publish" }), deps: run.deps })).toBe(EXIT_OK);
    expect(run.published.length).toBe(1);
    expect(run.published[0]!.markdown).toBe(CLEAN);
    expect(run.published[0]!.parent).toBe("a-parent");
    expect(run.published[0]!.page).toBeUndefined();
    expect(run.published[0]!.title).toBe("SOP: A title");
    expect(run.published[0]!.home).toBe("/tmp/home");
  });

  it("tells the operator the page is not proven until a browser has looked at it", async () => {
    const run = recorder({ files: { "d.md": CLEAN } });
    await runSopPublish({ argv: argv({ rest: ["d.md", "--parent", "a-parent"], verb: "publish" }), deps: run.deps });
    expect(run.err).toContain("  slopweaver notion verify https://example.test/page");
  });

  it("says nothing about verifying after a dry run, because nothing was published", async () => {
    const run = recorder({ files: { "d.md": CLEAN } });
    const rest = ["d.md", "--parent", "a-parent", "--dry-run"];
    await runSopPublish({ argv: argv({ rest, verb: "publish" }), deps: run.deps });
    expect(run.err.join("\n")).not.toContain("notion verify");
  });

  it("REFUSES a document with a blocking finding, and publishes nothing", async () => {
    const run = recorder({ files: { "d.md": CLEAN.replace("\n**Who:** a tool admin\n", "\n") } });
    expect(
      await runSopPublish({ argv: argv({ rest: ["d.md", "--parent", "a-parent"], verb: "publish" }), deps: run.deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.published).toEqual([]);
    expect(run.err).toContain("refusing to publish: fix the blocking findings above first.");
  });

  it("refuses a publish with no destination at all", async () => {
    const run = recorder({ files: { "d.md": CLEAN } });
    expect(await runSopPublish({ argv: argv({ rest: ["d.md"], verb: "publish" }), deps: run.deps })).toBe(EXIT_USAGE);
    expect(run.err.join("\n")).toContain("needs --parent");
    expect(run.published).toEqual([]);
  });

  it("refuses --page and --parent together rather than silently preferring one", async () => {
    const run = recorder({ files: { "d.md": CLEAN } });
    const rest = ["d.md", "--page", "a-page", "--parent", "a-parent"];
    expect(await runSopPublish({ argv: argv({ rest, verb: "publish" }), deps: run.deps })).toBe(EXIT_USAGE);
    expect(run.err.join("\n")).toContain("say two different things");
    expect(run.published).toEqual([]);
  });

  it("replaces a page in place when --page names one", async () => {
    const run = recorder({ files: { "d.md": CLEAN } });
    await runSopPublish({ argv: argv({ rest: ["d.md", "--page", "a-page"], verb: "publish" }), deps: run.deps });
    expect(run.published[0]!.page).toBe("a-page");
    expect(run.published[0]!.parent).toBeUndefined();
  });

  it("returns the write path's own exit code rather than inventing one", async () => {
    const run = recorder({ files: { "d.md": CLEAN }, outcome: { code: 4, pageUrl: undefined } });
    expect(
      await runSopPublish({ argv: argv({ rest: ["d.md", "--parent", "a-parent"], verb: "publish" }), deps: run.deps }),
    ).toBe(4);
  });
});
