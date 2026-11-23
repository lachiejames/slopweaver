import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HandDeps } from "../../../cli/commands/hand/deps.js";
import { runHandLineRetire } from "../../../cli/commands/hand/lineRetire.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../cli/exitCodes.js";
import { LineRetireErrors } from "../../../hand/lineRetireErrors.js";
import {
  buildLineRetirement,
  lineSha256,
  planUnreadableLineRetirements,
  type ScannedLine,
} from "../../../hand/lineRetirement.js";
import { applyLineRetirements, previewLineRetirements } from "../../../hand/lineRetirementApply.js";
import { retirementSidecarPath } from "../../../hand/lineRetirementSidecar.js";
import { skippedLines } from "../../../hand/postingChecks.js";
import { rowsOfLine } from "../../../hand/row.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { handRegisterPath, readHandRows } from "../../../hand/store.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const NOW = "2026-11-17T01:00:00.000Z";
const BAD_ID = "acme rework-review";

/** A valid step, with an id the caller may overwrite on the serialised line. */
function step({ id }: { id: string }): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id,
        postedBy: "workspace:129",
        postedIso: "2026-11-02T08:50:27.957Z",
        unblocks: "handover run datadog-monitor-deploy",
        url: "https://console.cloud.google.com/",
        what: "Sign in to Google Cloud so the monitor deploy can finish",
        witness: "slopweaver hand done gcloud-signin",
      },
    }),
  );
}

/** A posted line whose step id the reader refuses — the shape the sanitiser left. */
function badPosted({ id, what }: { id: string; what?: string }): string {
  const valid = step({ id: "gcloud-signin" });
  return JSON.stringify({ kind: "posted", step: { ...valid, id, ...(what === undefined ? {} : { what }) } });
}

/** A settled line for an id, valid whatever the id spells. */
function settled({ id }: { id: string }): string {
  return JSON.stringify({
    bySession: "workspace:129",
    did: "the owner pressed Done",
    id,
    kind: "settled",
    settledIso: NOW,
  });
}

const GOOD_POSTED = JSON.stringify({ kind: "posted", step: step({ id: "gcloud-signin" }) });

/** The lines as a scan sees them, numbered from 1. */
function scanned({ texts }: { texts: readonly string[] }): readonly ScannedLine[] {
  return texts.map((text, index) => {
    const lineNumber = index + 1;
    const sha256 = lineSha256({ text });
    const parsed = rowsOfLine({ line: text, lineNumber });
    return parsed.isOk()
      ? { lineNumber, readable: true as const, rows: parsed.value, sha256, text }
      : { lineNumber, readable: false as const, sha256, text };
  });
}

describe("planUnreadableLineRetirements", () => {
  it("admits an unreadable posted line whose exact id a LATER readable line settles", () => {
    const texts = [GOOD_POSTED, badPosted({ id: BAD_ID }), settled({ id: BAD_ID })];
    const plan = planUnreadableLineRetirements({ lines: scanned({ texts }), retirements: [] });
    expect(plan).toEqual({
      alreadyRetired: [],
      eligible: [
        {
          lineNumber: 2,
          lineSha256: lineSha256({ text: texts[1]! }),
          settledByLine: 3,
          settledByLineSha256: lineSha256({ text: texts[2]! }),
          stepId: BAD_ID,
        },
      ],
      refused: [],
    });
  });

  it("refuses an unsettled line, and one settled only BEFORE it", () => {
    const texts = [settled({ id: BAD_ID }), badPosted({ id: BAD_ID }), badPosted({ id: "acme other-step" })];
    const plan = planUnreadableLineRetirements({ lines: scanned({ texts }), retirements: [] });
    expect(plan.eligible).toEqual([]);
    expect(plan.refused.map((line) => [line.lineNumber, line.why])).toEqual([
      [2, `no later readable line settles "${BAD_ID}", so its step may still be waiting on the owner`],
      [3, 'no later readable line settles "acme other-step", so its step may still be waiting on the owner'],
    ]);
  });

  it("refuses a non-JSON line, an unreadable settled line, and a posting that carries a settling", () => {
    const recut = JSON.stringify({
      ...JSON.parse(badPosted({ id: BAD_ID })),
      settles: JSON.parse(settled({ id: "x" })),
    });
    const emptyDid = JSON.stringify({ ...JSON.parse(settled({ id: "x" })), did: "" });
    const texts = ["not json {", emptyDid, recut, settled({ id: BAD_ID })];
    const plan = planUnreadableLineRetirements({ lines: scanned({ texts }), retirements: [] });
    expect(plan.eligible).toEqual([]);
    expect(plan.refused.map((line) => [line.lineNumber, line.why])).toEqual([
      [1, "it is not JSON, so no step id can be read off it"],
      [2, "only a posted line can be retired — any other line that will not read may be a lost settling"],
      [3, "it carries the settling of another step on the same line, and retiring it would lose that settling"],
    ]);
  });
});

describe("the reader and the apply", () => {
  let home = "";
  let out: string[] = [];
  let diagnostics: string[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hand-retire-"));
    out = [];
    diagnostics = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Write the register whole, as a fixture — never how the product writes it. */
  function register({ texts }: { texts: readonly string[] }): string {
    const path = handRegisterPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${texts.join("\n")}\n`);
    return path;
  }

  function deps(): HandDeps {
    return {
      branchesDeclaring: () => [],
      consoleBase: () => "http://localhost:3000",
      lookAt: () => ({ kind: "seen", picture: undefined }),
      now: () => NOW,
      platform: "linux",
      rowPullRequests: () => ({ kind: "not-asked" }),
      run: () => undefined,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    };
  }

  const TEXTS = [GOOD_POSTED, badPosted({ id: BAD_ID }), settled({ id: BAD_ID }), "not json {"];

  it("carries a line an exactly-matching retirement holds over as retired, not unparsed", () => {
    const path = register({ texts: TEXTS });
    const before = unwrap(readHandRows({ missing: "empty", path }));
    expect(skippedLines({ unparsed: before.unparsed })).toEqual([2, 4]);
    const candidate = planUnreadableLineRetirements({ lines: scanned({ texts: TEXTS }), retirements: [] }).eligible[0]!;
    const row = buildLineRetirement({
      bySession: null,
      candidate,
      reason: "carried",
      retiredIso: NOW,
      sourceSha256: "s",
    });
    writeFileSync(retirementSidecarPath({ registerPath: path }), `${JSON.stringify(row)}\n`);
    const after = unwrap(readHandRows({ missing: "empty", path }));
    expect(skippedLines({ unparsed: after.unparsed })).toEqual([4]);
    expect(after.retired).toEqual([{ lineNumber: 2, reason: "carried", stepId: BAD_ID }]);
  });

  it("reports the line again once its bytes no longer match the retirement", () => {
    const path = register({ texts: TEXTS });
    const candidate = planUnreadableLineRetirements({ lines: scanned({ texts: TEXTS }), retirements: [] }).eligible[0]!;
    const row = buildLineRetirement({
      bySession: null,
      candidate,
      reason: "carried",
      retiredIso: NOW,
      sourceSha256: "s",
    });
    writeFileSync(retirementSidecarPath({ registerPath: path }), `${JSON.stringify(row)}\n`);
    register({ texts: [GOOD_POSTED, badPosted({ id: BAD_ID, what: "A different sentence" }), ...TEXTS.slice(2)] });
    const after = unwrap(readHandRows({ missing: "empty", path }));
    expect(skippedLines({ unparsed: after.unparsed })).toEqual([2, 4]);
    expect(after.retired).toEqual([]);
  });

  it("never retires a line that is not UTF-8, nor honours a retirement over its repaired text", () => {
    const path = handRegisterPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    // A posted line whose `what` holds the raw byte 0x80 — repaired, it decodes to U+FFFD, as 0x81 also would.
    const [head, tail] = badPosted({ id: BAD_ID, what: "MARK" }).split("MARK") as [string, string];
    const raw = Buffer.concat([Buffer.from(head), Buffer.from([0x80]), Buffer.from(tail)]);
    const settling = Buffer.from(`${settled({ id: BAD_ID })}\n`);
    writeFileSync(path, Buffer.concat([Buffer.from(`${GOOD_POSTED}\n`), raw, Buffer.from("\n"), settling]));
    const preview = unwrap(previewLineRetirements({ home }));
    expect(preview.plan.eligible).toEqual([]);
    expect(preview.plan.refused.map((line) => [line.lineNumber, line.why])).toEqual([
      [2, "it is not JSON, so no step id can be read off it"],
    ]);
    const repaired = raw.toString("utf8");
    const forged = planUnreadableLineRetirements({
      lines: scanned({ texts: [GOOD_POSTED, repaired, settled({ id: BAD_ID })] }),
      retirements: [],
    }).eligible[0]!;
    const row = buildLineRetirement({
      bySession: null,
      candidate: forged,
      reason: "forged",
      retiredIso: NOW,
      sourceSha256: "s",
    });
    writeFileSync(retirementSidecarPath({ registerPath: path }), `${JSON.stringify(row)}\n`);
    const after = unwrap(readHandRows({ missing: "empty", path }));
    expect(skippedLines({ unparsed: after.unparsed })).toEqual([2]);
    expect(after.retired).toEqual([]);
  });

  it("applies against the preview's digest, appends one row per eligible line, and reads the gap closed", () => {
    const path = register({ texts: TEXTS });
    const preview = unwrap(previewLineRetirements({ home }));
    const applied = unwrap(
      applyLineRetirements({
        bySession: "s-1",
        home,
        nowIso: NOW,
        reason: "carried",
        sourceSha256: preview.sourceSha256,
      }),
    );
    expect(applied.written.map((row) => [row.lineNumber, row.stepId, row.settledByLine, row.bySession])).toEqual([
      [2, BAD_ID, 3, "s-1"],
    ]);
    expect(applied.unparsedAfter).toBe(1);
    expect(
      readFileSync(retirementSidecarPath({ registerPath: path }), "utf8")
        .trimEnd()
        .split("\n").length,
    ).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(`${TEXTS.join("\n")}\n`);
    const again = unwrapErr(
      applyLineRetirements({ bySession: null, home, nowIso: NOW, reason: "again", sourceSha256: preview.sourceSha256 }),
    );
    expect(again).toEqual(LineRetireErrors.nothingEligible());
    expect(unwrap(previewLineRetirements({ home })).plan.alreadyRetired).toEqual([2]);
  });

  it("refuses an apply whose digest the register has moved past, writing nothing", () => {
    const path = register({ texts: TEXTS });
    const stale = unwrap(previewLineRetirements({ home })).sourceSha256;
    register({ texts: [...TEXTS, settled({ id: "gcloud-signin" })] });
    const refused = unwrapErr(
      applyLineRetirements({ bySession: null, home, nowIso: NOW, reason: "carried", sourceSha256: stale }),
    );
    expect(refused.code).toBe("SOURCE_CHANGED");
    expect(existsSync(retirementSidecarPath({ registerPath: path }))).toBe(false);
  });

  it("previews with the exact apply command, then applies it through the verb", () => {
    register({ texts: TEXTS });
    expect(runHandLineRetire({ deps: deps(), env: {}, rest: ["--home", home] })).toBe(EXIT_OK);
    const digest = unwrap(previewLineRetirements({ home })).sourceSha256;
    expect(out).toContain(
      `  apply with: slopweaver hand line-retire --apply --source-sha256 ${digest} --reason "<why>" --home ${JSON.stringify(home)}`,
    );
    expect(out).toContain("  refused   line 4  it is not JSON, so no step id can be read off it");
    const apply = ["--apply", "--source-sha256", digest, "--reason", "carried", "--home", home];
    expect(runHandLineRetire({ deps: deps(), env: {}, rest: apply })).toBe(EXIT_OK);
    expect(runHandLineRetire({ deps: deps(), env: {}, rest: apply })).toBe(EXIT_EXPECTED_EMPTY);
    const stale = ["--apply", "--source-sha256", "0".repeat(64), "--reason", "carried", "--home", home];
    expect(runHandLineRetire({ deps: deps(), env: {}, rest: stale })).toBe(EXIT_ERROR);
    expect(diagnostics.at(-1)).toContain("the register changed since the preview");
  });
});
