import { describe, expect, it } from "vitest";

import {
  failingControlsSection,
  parseVantaControlEvidenceOptions,
  parseVantaControlsEvidenceOptions,
  VANTA_ENTITY_SAMPLE_DEFAULT,
  vantaEvidenceArtifactPath,
  vantaEvidenceFilingPath,
} from "../../../../../cli/commands/vanta/controlEvidenceCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseVantaControlsEvidenceOptions", () => {
  it("defaults every optional flag rather than requiring one", () => {
    const options = unwrap(parseVantaControlsEvidenceOptions({ defaultHome: "/home", rest: [] }));

    expect(options.home).toBe("/home");
    expect(options.json).toBe(false);
    expect(options.tenant).toBe(null);
    expect(options.artifactPath).toBe(null);
    expect(options.clientIdFile).toBe(null);
  });

  it("reads every flag it advertises", () => {
    const options = unwrap(
      parseVantaControlsEvidenceOptions({
        defaultHome: "/home",
        rest: [
          "--tenant",
          "tenant-one",
          "--artifact",
          "/tmp/e.json",
          "--json",
          "--home",
          "/other",
          "--client-id-file",
          "/id",
          "--client-secret-file",
          "/secret",
        ],
      }),
    );

    expect(options.tenant).toBe("tenant-one");
    expect(options.artifactPath).toBe("/tmp/e.json");
    expect(options.json).toBe(true);
    expect(options.home).toBe("/other");
    expect(options.clientIdFile).toBe("/id");
    expect(options.clientSecretFile).toBe("/secret");
  });

  it("refuses a flag it does not accept", () => {
    const result = parseVantaControlsEvidenceOptions({ defaultHome: "/home", rest: ["--severity", "HIGH"] });

    expect(unwrapErr(result)).toEqual(["unknown flag: --severity", "unexpected argument: HIGH"]);
  });
});

describe("parseVantaControlEvidenceOptions", () => {
  it("requires a control to explain", () => {
    const problems = unwrapErr(parseVantaControlEvidenceOptions({ defaultHome: "/home", rest: [] }));

    expect(problems.join("\n")).toContain("--control names the control to explain");
  });

  it("defaults the entity sample rather than sampling nothing", () => {
    const options = unwrap(parseVantaControlEvidenceOptions({ defaultHome: "/home", rest: ["--control", "c1"] }));

    expect(options.controlId).toBe("c1");
    expect(options.entitySample).toBe(VANTA_ENTITY_SAMPLE_DEFAULT);
  });

  it("accepts a sample inside Vanta's own bound", () => {
    const options = unwrap(
      parseVantaControlEvidenceOptions({ defaultHome: "/home", rest: ["--control", "c1", "--entity-sample", "10"] }),
    );

    expect(options.entitySample).toBe(10);
  });

  it("refuses a sample past the bound the API read accepts", () => {
    const problems = unwrapErr(
      parseVantaControlEvidenceOptions({ defaultHome: "/home", rest: ["--control", "c1", "--entity-sample", "11"] }),
    );

    expect(problems.join("\n")).toContain("--entity-sample must be at most 10");
  });

  it("refuses a whitespace-only control id rather than reading a nameless control", () => {
    const problems = unwrapErr(parseVantaControlEvidenceOptions({ defaultHome: "/home", rest: ["--control", "  "] }));

    expect(problems.join("\n")).toContain("--control names the control to explain");
  });
});

describe("vantaEvidenceArtifactPath", () => {
  it("files under the platform's own atlas root, named by document kind and instant", () => {
    expect(
      vantaEvidenceArtifactPath({
        atlasRoot: "/state/atlas/vanta",
        generatedAt: "2026-01-01T00:00:00.000Z",
        kind: "vanta-controls-evidence",
      }),
    ).toBe("/state/atlas/vanta/evidence/vanta-controls-evidence-2026-01-01T00-00-00-000Z.json");
  });
});

describe("vantaEvidenceFilingPath", () => {
  it("files where the caller's --artifact names", () => {
    expect(
      vantaEvidenceFilingPath({
        artifactPath: "/tmp/e.json",
        atlasRoot: "/state/atlas/vanta",
        generatedAt: "2026-01-01T00:00:00.000Z",
        kind: "vanta-controls-evidence",
      }),
    ).toBe("/tmp/e.json");
  });

  it("derives the atlas-root path when no --artifact was passed", () => {
    expect(
      vantaEvidenceFilingPath({
        artifactPath: null,
        atlasRoot: "/state/atlas/vanta",
        generatedAt: "2026-01-01T00:00:00.000Z",
        kind: "vanta-controls-evidence",
      }),
    ).toBe("/state/atlas/vanta/evidence/vanta-controls-evidence-2026-01-01T00-00-00-000Z.json");
  });
});

describe("failingControlsSection", () => {
  const rows = [
    {
      externalId: "CTL-1",
      name: "Laptop encryption",
      providerId: "c1",
      status: "IN_PROGRESS",
      testsPassing: 1,
      testsTotal: 2,
    },
    {
      externalId: null,
      name: "Nameless",
      providerId: "c2",
      status: "NO_EVIDENCE_MAPPED",
      testsPassing: 0,
      testsTotal: 3,
    },
  ];

  it("says a complete posture is complete rather than printing an empty heading", () => {
    expect(failingControlsSection({ rows: [], shown: 25 })).toEqual([
      "every control this workspace holds is COMPLETED",
    ]);
  });

  // The grade is on every row because the four Vanta uses are not one thing: NO_EVIDENCE_MAPPED is a gap
  // nobody has started, IN_PROGRESS is work under way, and collapsing them would lose the difference.
  it("names each control by the id its own reader recognises, and the grade Vanta gave it", () => {
    expect(failingControlsSection({ rows, shown: 25 })).toEqual([
      "2 control(s) are not COMPLETED:",
      "- CTL-1: Laptop encryption — IN_PROGRESS, 1/2 tests passing",
      "- c2: Nameless — NO_EVIDENCE_MAPPED, 0/3 tests passing",
    ]);
  });

  it("says how many rows it withheld rather than trailing off", () => {
    expect(failingControlsSection({ rows, shown: 1 })).toEqual([
      "2 control(s) are not COMPLETED, showing 1:",
      "- CTL-1: Laptop encryption — IN_PROGRESS, 1/2 tests passing",
      "… and 1 more — pass --json for every row",
    ]);
  });
});
