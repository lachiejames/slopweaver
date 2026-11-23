/**
 * The three form-editing verbs' shells: what they parse, what they refuse, and the one property that matters
 * most — a refusal, a dry run and a failed validation all leave the file exactly as it was.
 */
import { describe, expect, it } from "vitest";

import { BriefingCommandErrors } from "../../../../../cli/commands/briefing/errors.js";
import { runBriefingFoldCaps } from "../../../../../cli/commands/briefing/foldCapsRun.js";
import { type BriefingFormEditDeps, runFormEdit } from "../../../../../cli/commands/briefing/formEditIo.js";
import { runBriefingRecut } from "../../../../../cli/commands/briefing/recutRun.js";
import {
  type BriefingSweepBlockDeps,
  runBriefingSweepBlock,
} from "../../../../../cli/commands/briefing/sweepBlockRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A fake single-file filesystem, capturing both output lanes and every write. */
function seams({ files }: { files: Record<string, string> }): {
  deps: BriefingFormEditDeps;
  out: string[];
  diagnostics: string[];
  writes: { path: string; text: string }[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const writes: { path: string; text: string }[] = [];
  return {
    deps: {
      readFile: ({ path }) => {
        const text = files[path];
        if (text === undefined) {
          throw new Error("ENOENT");
        }
        return text;
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeFile: ({ path, text }) => writes.push({ path, text }),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    writes,
  };
}

/** A form the schema accepts, as JSON text. */
function validFormText({ recent }: { recent: readonly unknown[] } = { recent: [] }): string {
  return JSON.stringify({
    alignment: {
      detail: { blocks: [{ content: [{ kind: "text", text: "The board is ranked." }], kind: "para" }], summary: "why" },
      headline: [{ kind: "text", text: "4 of 40 sessions are on the top 5." }],
      intake: [{ kind: "text", text: "6 owner turns have no entry." }],
    },
    awaiting: [],
    earlierToday: { notes: [{ headline: [{ kind: "text", text: "an earlier note" }] }], summary: "earlier today" },
    header: {
      handoff: "handoff-9249",
      lede: [{ kind: "text", text: "You are reacting." }],
      model: "fable",
      pinnedAt: "2026-09-12T19:43:07Z",
      sleeping: false,
      workspace: "workspace:55",
    },
    history: [],
    reactNow: { meFacing: [], teamFacing: [] },
    recent,
  });
}

/** A complete `sweep-block` invocation against `/f.json`. */
const SWEEP_ARGV: readonly string[] = [
  "--form",
  "/f.json",
  "--workspace",
  "workspace:60",
  "--handoff",
  "handoff-9250",
  "--model",
  "fable",
  "--pinned-at",
  "2026-09-13T00:11:07Z",
  "--sleeping",
  "false",
  "--alignment",
  "4 of 40 sessions are on the top 5.",
  "--headline-sentence",
  "The strong sentence.",
  "--headline-sentence",
  "The rest of it.",
  "--fold",
  "It ran. It passed.",
  "--fold-summary",
  "the gauges",
];

/** The sweep verb's seams: the shared ones, plus a fixed clock and an image reader that never reads. */
function sweepSeams({ files }: { files: Record<string, string> }): ReturnType<typeof seams> & {
  sweepDeps: BriefingSweepBlockDeps;
  images: string[];
} {
  const base = seams({ files });
  const images: string[] = [];
  const readImageDataUri = ({ path }: { path: string }): Result<string> => {
    images.push(path);
    return path.endsWith(".png") ? ok("data:image/png;base64,AA==") : err([`${path}: not an image`]);
  };
  return { ...base, images, sweepDeps: { ...base.deps, now: () => "2026-09-13T01:00:00.000Z", readImageDataUri } };
}

describe("runFormEdit", () => {
  it("answers the core's result when it returns", () => {
    expect(unwrap(runFormEdit({ edit: ({ form }) => form, form: { a: 1 }, path: "/f.json" }))).toEqual({ a: 1 });
  });

  it("turns a throw from the core into a refusal naming the file, rather than a crash", () => {
    const edit = (): never => {
      throw new RangeError("Maximum call stack size exceeded");
    };

    const error = unwrapErr(runFormEdit({ edit, form: {}, path: "/f.json" }));

    expect(error).toEqual(
      BriefingCommandErrors.formEditFailed({
        cause: new RangeError("Maximum call stack size exceeded"),
        path: "/f.json",
      }),
    );
    expect(error.message).toBe("/f.json: could not be edited — Maximum call stack size exceeded");
  });
});

describe("runBriefingSweepBlock", () => {
  it("writes the edited form once, atomically, and says what it did", () => {
    const { sweepDeps, out, writes } = sweepSeams({ files: { "/f.json": validFormText() } });
    const code = runBriefingSweepBlock({ deps: sweepDeps, rest: [...SWEEP_ARGV] });

    expect(code).toBe(EXIT_OK);
    expect(writes.length).toBe(1);
    expect(writes[0]!.path).toBe("/f.json");
    expect(out[0]).toBe(
      "briefing sweep-block: added one recent block (1 open), rolled 0 into earlierToday (1 notes); wrote /f.json",
    );
  });

  it("writes the raw form, so the validation's injected stamps never reach the file", () => {
    const { sweepDeps, writes } = sweepSeams({ files: { "/f.json": validFormText() } });
    runBriefingSweepBlock({ deps: sweepDeps, rest: [...SWEEP_ARGV] });
    const written = JSON.parse(writes[0]!.text) as { header: Record<string, unknown> };

    expect(written.header["readyIso"]).toBe(undefined);
    expect(written.header["refreshedIso"]).toBe(undefined);
  });

  it("refuses a missing required flag as a usage problem, reading nothing", () => {
    const { sweepDeps, diagnostics, writes } = sweepSeams({ files: {} });
    const code = runBriefingSweepBlock({ deps: sweepDeps, rest: ["--form", "/f.json"] });

    expect(code).toBe(EXIT_USAGE);
    expect(writes).toEqual([]);
    expect(diagnostics).toContain("briefing sweep-block: --workspace is required");
  });

  it("refuses a repeatable flag with no value rather than losing it", () => {
    const { sweepDeps, diagnostics } = sweepSeams({ files: { "/f.json": validFormText() } });
    const code = runBriefingSweepBlock({ deps: sweepDeps, rest: [...SWEEP_ARGV, "--fold"] });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe(
      "briefing sweep-block: --fold takes a value (write --fold=<text> for text that starts with a dash)",
    );
  });

  it("refuses `--sleeping yes`, which is neither true nor false", () => {
    const { sweepDeps, diagnostics } = sweepSeams({ files: { "/f.json": validFormText() } });
    const rest = SWEEP_ARGV.map((token) => (token === "false" ? "yes" : token));

    expect(runBriefingSweepBlock({ deps: sweepDeps, rest })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("briefing sweep-block: --sleeping takes exactly `true` or `false`");
  });

  it("writes nothing when the edited form fails the schema, and says so", () => {
    // Three sentences in the alignment headline, against the schema's two — a cap the core does not
    // restate, so this is the whole-form route the recent headline no longer takes.
    const rest = SWEEP_ARGV.map((token) =>
      token === "4 of 40 sessions are on the top 5." ? "One. Two. Three." : token,
    );
    const { sweepDeps, diagnostics, writes } = sweepSeams({ files: { "/f.json": validFormText() } });
    const code = runBriefingSweepBlock({ deps: sweepDeps, rest });

    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(diagnostics[0]).toBe(
      "briefing sweep-block: the edited form fails the briefing schema, so nothing was written:",
    );
    expect(diagnostics[1]).toContain("alignment.headline");
  });

  it("refuses a fifth --headline-sentence at parse time, naming the count, before the form is even read", () => {
    const extra = ["Three.", "Four.", "Five."].flatMap((sentence) => ["--headline-sentence", sentence]);
    const { sweepDeps, diagnostics, writes } = sweepSeams({ files: {} });
    const code = runBriefingSweepBlock({ deps: sweepDeps, rest: [...SWEEP_ARGV, ...extra] });

    expect(code).toBe(EXIT_USAGE);
    expect(writes).toEqual([]);
    expect(diagnostics[0]).toBe(
      "briefing sweep-block: --headline-sentence: has 5 sentences; at most 4 are allowed — keep the ones the owner has " +
        "to read to decide, and move the rest into a fold",
    );
  });

  it("refuses a headline sentence naming a path, a seat or the word tick, each at parse time", () => {
    const rest = SWEEP_ARGV.map((token) =>
      token === "The rest of it." ? "This tick workspace:93 wrote /tmp/form.json." : token,
    );
    const { sweepDeps, diagnostics, writes } = sweepSeams({ files: {} });

    expect(runBriefingSweepBlock({ deps: sweepDeps, rest })).toBe(EXIT_USAGE);
    expect(writes).toEqual([]);
    expect(diagnostics.slice(0, 3)).toEqual([
      "briefing sweep-block: --headline-sentence: sentence 2 names a filesystem path, /tmp/form.json — say what " +
        "it is, not where",
      'briefing sweep-block: --headline-sentence: sentence 2 names a seat number, "workspace:93" — say what the ' +
        "seat is doing, not its number",
      'briefing sweep-block: --headline-sentence: sentence 2 uses the fleet word "tick" — say what happened, in ' +
        "plain words",
    ]);
  });

  it("writes nothing on a dry run", () => {
    const { sweepDeps, out, writes } = sweepSeams({ files: { "/f.json": validFormText() } });
    const code = runBriefingSweepBlock({ deps: sweepDeps, rest: [...SWEEP_ARGV, "--dry-run"] });

    expect(code).toBe(EXIT_OK);
    expect(writes).toEqual([]);
    expect(out[0]).toContain("(dry run, nothing written)");
  });

  it("reports a form it cannot read", () => {
    const { sweepDeps, diagnostics } = sweepSeams({ files: {} });

    expect(runBriefingSweepBlock({ deps: sweepDeps, rest: [...SWEEP_ARGV] })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toBe("briefing sweep-block: /f.json: could not read the form — ENOENT");
  });
});

describe("runBriefingFoldCaps", () => {
  /** A form whose one earlier note carries a fold of `count` paragraphs. */
  function formWithBlocks({ count }: { count: number }): string {
    return JSON.stringify({
      earlierToday: {
        notes: [
          {
            detail: {
              blocks: Array.from({ length: count }, (_entry, index) => ({
                content: [{ kind: "text", text: `Block ${String(index)}.` }],
                kind: "para",
              })),
              summary: "the fold",
            },
            headline: [{ kind: "text", text: "a note" }],
          },
        ],
        summary: "earlier today",
      },
    });
  }

  it("reshapes an over-cap fold and writes once", () => {
    const { deps, out, writes } = seams({ files: { "/f.json": formWithBlocks({ count: 6 }) } });
    const code = runBriefingFoldCaps({ deps, rest: ["--form", "/f.json"] });

    expect(code).toBe(EXIT_OK);
    expect(writes.length).toBe(1);
    expect(out[0]).toBe("briefing fold-caps: reshaped 1 fold(s); wrote /f.json");
    expect(out[1]).toBe("  earlierToday.notes.0.detail: 6 blocks -> 1");
  });

  it("leaves a form already within the cap alone", () => {
    const { deps, out, writes } = seams({ files: { "/f.json": formWithBlocks({ count: 3 }) } });

    expect(runBriefingFoldCaps({ deps, rest: ["--form", "/f.json"] })).toBe(EXIT_OK);
    expect(writes).toEqual([]);
    expect(out[0]).toBe("briefing fold-caps: every fold is within 4 blocks; /f.json is unchanged");
  });

  it("writes nothing at all when one fold cannot be reshaped", () => {
    const image = { alt: "a", data: "data:image/png;base64,AA==", kind: "image" };
    const files = {
      "/f.json": JSON.stringify({
        earlierToday: {
          notes: [{ detail: { blocks: [image, image, image, image, image], summary: "s" }, headline: [] }],
          summary: "earlier",
        },
      }),
    };
    const { deps, diagnostics, writes } = seams({ files });

    expect(runBriefingFoldCaps({ deps, rest: ["--form", "/f.json"] })).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(diagnostics[1]).toBe("briefing fold-caps: nothing was written to /f.json");
  });

  it("refuses an invocation with no form", () => {
    const { deps, diagnostics } = seams({ files: {} });

    expect(runBriefingFoldCaps({ deps, rest: [] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("briefing fold-caps: --form is required");
  });
});

describe("runBriefingRecut", () => {
  const JARGON = JSON.stringify({ header: { lede: [{ kind: "text", text: "This tick landed gold." }] } });

  it("writes the rewritten form to --out and counts the substitutions", () => {
    const { deps, out, writes } = seams({ files: { "/f.json": JARGON } });
    const code = runBriefingRecut({ deps, rest: ["--form", "/f.json", "--out", "/o.json"] });

    expect(code).toBe(EXIT_OK);
    expect(writes[0]!.path).toBe("/o.json");
    expect(out[0]).toBe("briefing recut: 2 substitution(s) (gold 1, tick 1); wrote /o.json");
    expect(JSON.parse(writes[0]!.text)).toEqual({
      header: { lede: [{ kind: "text", text: "This pass landed the strongest proof available." }] },
    });
  });

  it("names a fleet word it has no substitution for, and still writes", () => {
    const files = {
      "/f.json": JSON.stringify({ header: { lede: [{ kind: "text", text: "The touch-seam is open." }] } }),
    };
    const { deps, out, writes } = seams({ files });

    expect(runBriefingRecut({ deps, rest: ["--form", "/f.json", "--out", "/f.json"] })).toBe(EXIT_OK);
    expect(writes.length).toBe(1);
    expect(out[1]).toBe('  left for a composer: header.lede.0.text uses "touch-seam" (seam)');
  });

  it("writes nothing on a dry run", () => {
    const { deps, out, writes } = seams({ files: { "/f.json": JARGON } });

    expect(runBriefingRecut({ deps, rest: ["--form", "/f.json", "--out", "/o.json", "--dry-run"] })).toBe(EXIT_OK);
    expect(writes).toEqual([]);
    expect(out[0]).toBe("briefing recut: would make 2 substitution(s) (gold 1, tick 1) (dry run, nothing written)");
  });

  it("refuses an invocation with no --out", () => {
    const { deps, diagnostics } = seams({ files: {} });

    expect(runBriefingRecut({ deps, rest: ["--form", "/f.json"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("briefing recut: --out is required");
  });
});
