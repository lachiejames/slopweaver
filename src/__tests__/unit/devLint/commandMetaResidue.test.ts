import { describe, expect, it } from "vitest";

import { scanMetaResidue } from "../../../devLint/commandMetaResidue.js";

describe("scanMetaResidue", () => {
  it("flags a metadata field re-added through a variable, which TypeScript accepts", () => {
    // MEASURED: `const legacy = { doorRouted: false, run };  defineCommand(legacy)` produces ZERO
    // typecheck errors, because excess-property checking only fires on a fresh object literal at the call
    // site. That is why a text residue check exists at all.
    const hits = scanMetaResidue({
      content: "const legacy = { doorRouted: false, run: runAudit };\n",
      path: "src/cli/commands/audit/run.ts",
    });
    expect(hits).toEqual([
      {
        field: "doorRouted",
        line: 1,
        path: "src/cli/commands/audit/run.ts",
        text: "const legacy = { doorRouted: false, run: runAudit };",
      },
    ]);
  });

  it("does NOT flag a DoorMeta request, which legitimately carries effect and requiresApproval", () => {
    // The first version of this gate listed the shared fields and reported eighteen hits, every one a
    // correct `throughDoor` request. A gate that cries wolf gets suppressed.
    const hits = scanMetaResidue({
      content: 'meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },\n',
      path: "src/cli/commands/slack/pollRun.ts",
    });
    expect(hits).toEqual([]);
  });

  it("ignores the field names when they appear in prose", () => {
    const hits = scanMetaResidue({
      content: " * The `doorRouted` flag lives in the manifest.\n// dryParseSafe: explained above\n",
      path: "src/cli/commands/x/run.ts",
    });
    expect(hits).toEqual([]);
  });

  it("finds nothing in a module that declares only its behaviour", () => {
    const hits = scanMetaResidue({
      content: "export const auditRunCommand = defineCommand({ run: runAudit });\n",
      path: "src/cli/commands/audit/run.ts",
    });
    expect(hits).toEqual([]);
  });
});

describe("scanMetaResidue — spellings a review pass slipped past the first version", () => {
  it("catches a DOUBLE-QUOTED key", () => {
    const hits = scanMetaResidue({
      content: 'const legacy = { "doorRouted": false, run: runAudit };\n',
      path: "src/cli/commands/audit/run.ts",
    });
    expect(hits.map((h) => h.field)).toEqual(["doorRouted"]);
  });

  it("catches a SINGLE-QUOTED key", () => {
    const hits = scanMetaResidue({
      content: "const legacy = { 'dryParseSafe': true, run: x };\n",
      path: "src/cli/commands/audit/run.ts",
    });
    expect(hits.map((h) => h.field)).toEqual(["dryParseSafe"]);
  });
});

describe("scanMetaResidue — computed keys", () => {
  it("catches a COMPUTED quoted key, which the quoted-only version missed", () => {
    const hits = scanMetaResidue({
      content: 'const legacy = { ["doorRouted"]: false, run: runAudit };\n',
      path: "src/cli/commands/audit/run.ts",
    });
    expect(hits.map((h) => h.field)).toEqual(["doorRouted"]);
  });

  it("catches a computed single-quoted key with spacing", () => {
    const hits = scanMetaResidue({
      content: "const legacy = { [ 'diagnostic' ] : true, run: x };\n",
      path: "src/cli/commands/audit/run.ts",
    });
    expect(hits.map((h) => h.field)).toEqual(["diagnostic"]);
  });

  it("still ignores a DoorMeta request, which shares no field with this list", () => {
    const hits = scanMetaResidue({
      content: 'meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },\n',
      path: "src/cli/commands/slack/pollRun.ts",
    });
    expect(hits).toEqual([]);
  });
});
