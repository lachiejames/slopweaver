/** `route evaluate` validates real decision files against real case files, end to end. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseRouteEvaluateArgs,
  routeEvaluateCommand,
  runRouteEvaluate,
} from "../../../../../cli/commands/route/evaluate.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { routeManifest } from "../../../../../cli/manifests/route.js";
import { unwrapErr } from "../../../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tmpFile({ name, content }: { name: string; content: unknown }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-route-evaluate-"));
  fixtureDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(content), "utf8");
  return path;
}

const MINIMAL_INPUT = {
  availableCapabilities: [],
  context: { controlPlane: { ownerAddressingText: "yo", structuralMetadata: [] }, quotedEvidence: [] },
};

const NO_RESPONSE_CASE = {
  description: "a bare greeting",
  expected: { response: "no-response" },
  id: "case-1",
  input: MINIMAL_INPUT,
  tags: ["greeting"],
};

describe("route evaluate", () => {
  it("parses the required flags", () => {
    expect(
      parseRouteEvaluateArgs({
        rest: ["--cases", "/tmp/cases.json", "--decisions", "/tmp/decisions.json", "--json"],
      }).isOk(),
    ).toBe(true);
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseRouteEvaluateArgs({ rest: ["--unknown"] }))).toEqual(["unknown flag: --unknown"]);
  });

  it("requires the explicit JSON hand-off mode", () => {
    expect(
      runRouteEvaluate([
        "node",
        "slopweaver",
        "route",
        "evaluate",
        "--cases",
        "/tmp/a.json",
        "--decisions",
        "/tmp/b.json",
      ]),
    ).toBe(EXIT_USAGE);
  });

  it("fails loudly when the cases file cannot be read", () => {
    const decisions = tmpFile({ content: {}, name: "decisions.json" });
    expect(
      runRouteEvaluate([
        "node",
        "slopweaver",
        "route",
        "evaluate",
        "--cases",
        "/definitely/missing/cases.json",
        "--decisions",
        decisions,
        "--json",
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("scores a real correct decision against a real case file", () => {
    const cases = tmpFile({ content: { cases: [NO_RESPONSE_CASE] }, name: "cases.json" });
    const decisions = tmpFile({
      content: {
        "case-1": { confidence: "high", rationale: "greeting only", response: "no-response", schemaVersion: 1 },
      },
      name: "decisions.json",
    });
    const outDir = mkdtempSync(join(tmpdir(), "slopweaver-route-evaluate-out-"));
    fixtureDirs.push(outDir);
    const outPath = join(outDir, "baseline.json");
    const exit = runRouteEvaluate([
      "node",
      "slopweaver",
      "route",
      "evaluate",
      "--cases",
      cases,
      "--decisions",
      decisions,
      "--out",
      outPath,
      "--json",
    ]);
    expect(exit).toBe(EXIT_OK);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.summary.responseObligationAccuracy).toBe(1);
    expect(written.summary.total).toBe(1);
    expect(written.producedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(written.judgedBy).toBe("unspecified");
  });

  it("treats a malformed decision as refused and scores it as wrong, without crashing", () => {
    const cases = tmpFile({ content: { cases: [NO_RESPONSE_CASE] }, name: "cases.json" });
    const decisions = tmpFile({ content: { "case-1": { not: "a decision" } }, name: "decisions.json" });
    const exit = runRouteEvaluate([
      "node",
      "slopweaver",
      "route",
      "evaluate",
      "--cases",
      cases,
      "--decisions",
      decisions,
      "--json",
    ]);
    expect(exit).toBe(EXIT_ERROR);
  });

  it("exposes the manifest-selected command as a local-state write", () => {
    expect(routeEvaluateCommand).toBe(runRouteEvaluate);
    expect(routeManifest["evaluate"]?.meta.effect).toBe("local-state");
  });
});
