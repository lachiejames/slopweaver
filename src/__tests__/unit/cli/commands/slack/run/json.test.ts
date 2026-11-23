import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { FOLD_UNKNOWN_NOTICE } from "../../../../../../outbound/slack/preview.js";
import { parseOwnJson } from "../../../../../parseOwnJson.js";
import { deps } from "./deps.js";
import { argv, freshHome, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — --json is HONOURED, not parsed and ignored", () => {
  it("emits exactly ONE parseable document on stdout for a dry run, carrying the exact payload", async () => {
    const rec = recorder();
    const out: string[] = [];

    const code = await runSlackWrite({
      argv: argv({ extra: ["--dry-run", "--json"], home: freshHome() }),
      deps: deps({ out, rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(out.length).toBe(1);
    const report = parseOwnJson<{
      dryRun: boolean;
      sent: unknown;
      card: { blocks: number; folds: boolean };
      payload: { text: string; attachments: { blocks: unknown[] }[] };
      preview: string[];
    }>({ text: out[0]! });
    expect(report.dryRun).toBe(true);
    expect(report.sent).toBe(null);
    // `folds` is GONE rather than corrected — it was `blocks > 5`, the rule a three-block attachment refuted.
    expect(report.card).toEqual({ blocks: 6, wrappers: 1 });
    expect(report.payload.text).toBe("");
    expect(report.payload.attachments[0]!.blocks.length).toBe(6);
    expect(report.preview.join("\n")).toContain("The detail.");
  });

  it("emits the send result inside the SAME document shape after a real send", async () => {
    const rec = recorder();
    const out: string[] = [];

    await runSlackWrite({
      argv: argv({ extra: ["--json"], home: freshHome() }),
      deps: deps({ out, rec }),
      verb: "post",
    });

    expect(out.length).toBe(1);
    const report = parseOwnJson<{ dryRun: boolean; sent: { ts: string; channel: string } | null }>({ text: out[0]! });
    expect(report.dryRun).toBe(false);
    expect(report.sent).toEqual({ channel: "C1", fileIds: [], missingMedia: [], ok: true, ts: "1700000000.000100" });
  });

  it("carries the door's refusal in the document instead of leaving stdout empty", async () => {
    const rec = recorder();
    const home = freshHome();
    const out: string[] = [];

    await runSlackWrite({ argv: argv({ home }), deps: deps({ rec }), verb: "post" });
    const second = await runSlackWrite({
      argv: argv({ extra: ["--json"], home }),
      deps: deps({ out, rec }),
      verb: "post",
    });

    expect(second).toBe(EXIT_EXPECTED_EMPTY);
    expect(out.length).toBe(1);
    const report = parseOwnJson<{ sent: unknown; refusal: { status: string; findings: unknown[] } | null }>({
      text: out[0]!,
    });
    expect(report.sent).toBe(null);
    expect(report.refusal!.status).toBe("warn");
    expect(report.refusal!.findings.length).toBe(1);
  });

  it("prints the readable card in the HUMAN dry run, not just block counts", async () => {
    const rec = recorder();
    const out: string[] = [];

    await runSlackWrite({
      argv: argv({ extra: ["--dry-run"], home: freshHome() }),
      deps: deps({ out, rec }),
      verb: "post",
    });

    expect(out).toContain("A short lead.");
    expect(out).toContain("The detail.");
    expect(out).toContain("──── detail ──── (blocks 5+ are behind the Details label)");
    // And the preview says plainly that it cannot answer the fold question, rather than implying it did.
    expect(out).toContain(FOLD_UNKNOWN_NOTICE);
  });
});
