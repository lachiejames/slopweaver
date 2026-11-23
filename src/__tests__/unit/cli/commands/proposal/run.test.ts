/**
 * The `proposal draft` and `proposal lint` COMMANDS — the orchestration itself.
 *
 * The distinction worth pinning is which verb REFUSES. `draft` reports its findings and still hands over the
 * file, because the findings are about words the session wrote and it needs the file to fix them. `lint` is
 * the gate, and its blocking exit is `EXPECTED_EMPTY` rather than `USAGE`: the linter ran perfectly and
 * found something, which is a different thing from the command being typed wrong.
 *
 * Every edge is a plain injected function. No mocks.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROPOSAL_FORM_EXAMPLE } from "../../../../../cli/commands/proposal/formExample.js";
import { type ProposalDeps, runProposalDraft, runProposalLint } from "../../../../../cli/commands/proposal/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import { renderProposal } from "../../../../../outbound/proposal/render.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";

const GOLDEN = renderProposal({ form: PROPOSAL_FORM_EXAMPLE });

/** argv as the router hands it over: node, script, noun, verb, then the verb's own arguments. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "proposal", verb, ...rest];
}

/** A recording harness: injected edges that log, plus captured output. */
function harness({
  text = JSON.stringify(PROPOSAL_FORM_EXAMPLE),
  voiceRules = [],
  readThrows = false,
}: {
  text?: string;
  voiceRules?: readonly ExactVoiceRule[];
  readThrows?: boolean;
} = {}): {
  deps: ProposalDeps;
  out: string[];
  err: string[];
  written: () => { path: string; text: string } | undefined;
} {
  const out: string[] = [];
  const err: string[] = [];
  let written: { path: string; text: string } | undefined;
  return {
    deps: {
      err: (line) => err.push(line),
      out: (line) => out.push(line),
      readText: () => {
        if (readThrows) {
          throw new Error("ENOENT");
        }
        return text;
      },
      voiceRules: () => ok(voiceRules),
      writeText: (file) => {
        written = file;
      },
    },
    err,
    out,
    written: () => written,
  };
}

describe("runProposalDraft", () => {
  it("prints a complete, valid form for --form-example without reading anything", async () => {
    const h = harness({ readThrows: true });
    const code = await runProposalDraft({ argv: argv({ rest: ["--form-example"], verb: "draft" }), deps: h.deps });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(h.out.join("\n")) as unknown).toEqual(PROPOSAL_FORM_EXAMPLE);
  });

  it("refuses without --form", async () => {
    const h = harness();
    expect(await runProposalDraft({ argv: argv({ rest: [], verb: "draft" }), deps: h.deps })).toBe(EXIT_USAGE);
    expect(h.err[0]).toContain("--form <json|-> is required");
  });

  it("refuses a form that is not JSON, naming what went wrong", async () => {
    const h = harness({ text: "{ not json" });
    expect(await runProposalDraft({ argv: argv({ rest: ["--form", "-"], verb: "draft" }), deps: h.deps })).toBe(
      EXIT_USAGE,
    );
    expect(h.err[0]).toContain("not valid JSON");
  });

  it("refuses an unknown field by name rather than dropping it", async () => {
    const h = harness({ text: JSON.stringify({ ...PROPOSAL_FORM_EXAMPLE, summary: "from another schema" }) });
    expect(await runProposalDraft({ argv: argv({ rest: ["--form", "-"], verb: "draft" }), deps: h.deps })).toBe(
      EXIT_USAGE,
    );
    expect(h.err.join("\n")).toContain('unknown field "summary"');
  });

  it("writes the rendered markdown to --out and names the title and icon separately", async () => {
    const h = harness();
    const code = await runProposalDraft({
      argv: argv({ rest: ["--form", "-", "--out", "/tmp/d.md"], verb: "draft" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.written()!.path).toBe("/tmp/d.md");
    expect(h.written()!.text).toBe(GOLDEN);
    expect(h.err.join("\n")).toContain("icon: 🧭");
  });

  it("prints the markdown to stdout when no --out is given", async () => {
    const h = harness();
    await runProposalDraft({ argv: argv({ rest: ["--form", "-"], verb: "draft" }), deps: h.deps });
    expect(h.out.join("\n")).toBe(GOLDEN.trimEnd());
    expect(h.written()).toBe(undefined);
  });

  it("self-lints and says so", async () => {
    const h = harness();
    await runProposalDraft({ argv: argv({ rest: ["--form", "-"], verb: "draft" }), deps: h.deps });
    expect(h.err).toContain("lint: clean");
  });

  it("still exits zero when its own lint blocks, because the session needs the file to fix it", async () => {
    const h = harness({ voiceRules: [{ kind: "phrase", value: "nightly suite" }] });
    const code = await runProposalDraft({
      argv: argv({ rest: ["--form", "-", "--out", "/tmp/d.md"], verb: "draft" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.written()!.text).toBe(GOLDEN);
    expect(h.err.join("\n")).toContain("fix the blocking findings above before publishing");
  });
});

describe("runProposalLint", () => {
  it("passes a clean document", async () => {
    const h = harness({ text: GOLDEN });
    expect(await runProposalLint({ argv: argv({ rest: ["draft.md"], verb: "lint" }), deps: h.deps })).toBe(EXIT_OK);
    expect(h.out[0]).toContain("ready to publish");
  });

  it("refuses with usage when no path is given", async () => {
    const h = harness();
    expect(await runProposalLint({ argv: argv({ rest: [], verb: "lint" }), deps: h.deps })).toBe(EXIT_USAGE);
  });

  it("fails, not usage, when the file cannot be read", async () => {
    const h = harness({ readThrows: true });
    expect(await runProposalLint({ argv: argv({ rest: ["missing.md"], verb: "lint" }), deps: h.deps })).toBe(
      EXIT_ERROR,
    );
    expect(h.err[0]).toContain("cannot read missing.md");
  });

  it("exits EXPECTED_EMPTY on a blocking finding, NOT the usage code", async () => {
    const h = harness({ text: `${GOLDEN}\nSee https://example.test/raw for the workings.\n` });
    const code = await runProposalLint({ argv: argv({ rest: ["draft.md"], verb: "lint" }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(code).not.toBe(EXIT_USAGE);
  });

  it("still exits zero when only warnings were found", async () => {
    const h = harness({ text: `${GOLDEN}\nThis is great!\n` });
    const code = await runProposalLint({ argv: argv({ rest: ["draft.md"], verb: "lint" }), deps: h.deps });
    expect(code).toBe(EXIT_OK);
    expect(h.out[0]).toContain("1 warning(s), 0 blocking");
  });

  it("emits machine-readable findings for --json, and still exits on a blocker", async () => {
    const h = harness({ text: `${GOLDEN}\nSee https://example.test/raw for the workings.\n` });
    const code = await runProposalLint({ argv: argv({ rest: ["draft.md", "--json"], verb: "lint" }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    const parsed = JSON.parse(h.out.join("\n")) as { blocked: boolean; findings: readonly { rule: string }[] };
    expect(parsed.blocked).toBe(true);
    expect(parsed.findings.map((finding) => finding.rule)).toContain("bare-url");
  });

  it("applies the operator's own voice rules to the file it read", async () => {
    const h = harness({ text: `${GOLDEN}\nan em — dash\n`, voiceRules: [{ kind: "literal", value: "—" }] });
    const code = await runProposalLint({ argv: argv({ rest: ["draft.md"], verb: "lint" }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("voice-rule");
  });
});

describe("a CORRUPT profile.json refuses draft and lint instead of judging against no voice rules", () => {
  // Every home this block has minted, so `afterEach` can remove them.
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A state home whose `profile.json` is `{`, or is absent when `corrupt` is false. */
  function homeWith({ corrupt }: { corrupt: boolean }): string {
    const home = mkdtempSync(join(tmpdir(), "proposal-profile-"));
    homes.push(home);
    if (corrupt) {
      writeFileSync(join(home, "profile.json"), "{", "utf8");
    }
    return home;
  }

  /** The harness, reading voice rules through the production reader rather than a fixed list. */
  function realReader({ text }: { text?: string } = {}): ReturnType<typeof harness> {
    const h = harness(text === undefined ? {} : { text });
    return { ...h, deps: { ...h.deps, voiceRules: ({ home }) => readExactVoiceRules({ home }) } };
  }

  it("draft writes nothing and prints no markdown, naming the profile path", async () => {
    const home = homeWith({ corrupt: true });
    const h = realReader();
    const code = await runProposalDraft({
      argv: argv({ rest: ["--form", "-", "--out", "/tmp/d.md", "--home", home], verb: "draft" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.written()).toBe(undefined);
    expect(h.out).toEqual([]);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toContain(`the profile at ${join(home, "profile.json")} is there but cannot be trusted`);
    expect(h.err[0]).toContain("nothing was written.");
  });

  it("lint refuses with the error code, not the blocking-finding code", async () => {
    const home = homeWith({ corrupt: true });
    const h = realReader({ text: GOLDEN });
    const code = await runProposalLint({
      argv: argv({ rest: ["draft.md", "--home", home], verb: "lint" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.out).toEqual([]);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toContain(`the profile at ${join(home, "profile.json")} is there but cannot be trusted`);
    expect(h.err[0]).toContain("the document was not judged.");
  });

  it("an ABSENT profile still drafts and lints against no rules, as an install that configured none", async () => {
    const home = homeWith({ corrupt: false });
    const drafted = realReader();
    const draftCode = await runProposalDraft({
      argv: argv({ rest: ["--form", "-", "--out", "/tmp/d.md", "--home", home], verb: "draft" }),
      deps: drafted.deps,
    });
    const linted = realReader({ text: GOLDEN });
    const lintCode = await runProposalLint({
      argv: argv({ rest: ["draft.md", "--home", home], verb: "lint" }),
      deps: linted.deps,
    });
    expect(draftCode).toBe(EXIT_OK);
    expect(drafted.written()!.text).toBe(GOLDEN);
    expect(drafted.err).toContain("lint: clean");
    expect(lintCode).toBe(EXIT_OK);
  });
});
