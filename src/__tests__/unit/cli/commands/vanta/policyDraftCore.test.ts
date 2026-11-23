import { describe, expect, it } from "vitest";

import {
  buildVantaDraftEditPlan,
  DRAFT_SAVE_CONTROL,
  type VantaDraftSnapshot,
  vantaDraftEditDigest,
} from "../../../../../atlas/vanta/policyDraft.js";
import {
  EDIT_POLICY_DRAFT_UNAPPROVED_CODE,
  vantaEditPolicyDraftApprovalGate,
} from "../../../../../atlas/vanta/policyDraftApproval.js";
import { vantaDraftEditSnippet, vantaDraftObserveSnippet } from "../../../../../browser/vantaPolicyEditorSnippet.js";
import {
  parseVantaEditPolicyDraftOptions,
  renderVantaEditDryRun,
  vantaPolicyEditorUrl,
} from "../../../../../cli/commands/vanta/policyDraftCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const snapshot: VantaDraftSnapshot = {
  controls: [DRAFT_SAVE_CONTROL],
  finalUrl: "https://app.vanta.com/c/acme/policies/p-1/edit?language=EN",
  observedAtIso: "2026-09-12T03:40:00.000Z",
  regionCount: 1,
  regionTextLengths: [4000],
  text: "Alpha beta gamma.\n",
  title: "Policy Editor: Alpha - Vanta",
};

describe("parseVantaEditPolicyDraftOptions", () => {
  it("resolves a complete invocation", () => {
    const options = unwrap(
      parseVantaEditPolicyDraftOptions({
        rest: [
          "--policy",
          "p-1",
          "--find",
          "18",
          "--replace",
          "eighteen",
          "--approve",
          "abc",
          "--dry-run",
          "--tenant",
          "acme",
        ],
      }),
    );
    expect(options.policy).toBe("p-1");
    expect(options.find).toBe("18");
    expect(options.replace).toBe("eighteen");
    expect(options.approve).toBe("abc");
    expect(options.dryRun).toBe(true);
    expect(options.tenant).toBe("acme");
  });

  it("defaults the approval to none rather than to an empty digest", () => {
    const options = unwrap(
      parseVantaEditPolicyDraftOptions({ rest: ["--policy", "p-1", "--find", "a", "--replace", "b"] }),
    );
    expect(options.approve).toBe(null);
    expect(options.tenant).toBe(null);
  });

  it("accepts an empty --replace, which is how a run of text is deleted", () => {
    const options = unwrap(
      parseVantaEditPolicyDraftOptions({ rest: ["--policy", "p-1", "--find", "a", "--replace", ""] }),
    );
    expect(options.replace).toBe("");
  });

  it("refuses an invocation with no policy", () => {
    const problems = unwrapErr(parseVantaEditPolicyDraftOptions({ rest: ["--find", "a", "--replace", "b"] }));
    expect(problems[0]).toBe("--policy takes the policy id this substitution is for");
  });

  it("reports every missing flag at once rather than one at a time", () => {
    expect(unwrapErr(parseVantaEditPolicyDraftOptions({ rest: [] })).length).toBe(3);
  });
});

describe("vantaPolicyEditorUrl", () => {
  it("builds the editor address beneath the tenant root", () => {
    expect(vantaPolicyEditorUrl({ policy: "p-1", tenantSlug: "acme" })).toBe(
      "https://app.vanta.com/c/acme/policies/p-1/edit",
    );
  });

  it("escapes a policy id that would otherwise change the path", () => {
    expect(vantaPolicyEditorUrl({ policy: "a/b", tenantSlug: "acme" })).toBe(
      "https://app.vanta.com/c/acme/policies/a%2Fb/edit",
    );
  });
});

describe("vantaEditPolicyDraftApprovalGate", () => {
  it("passes when the supplied digest matches exactly", () => {
    const gate = vantaEditPolicyDraftApprovalGate({ expected: "abc123", supplied: "abc123" });
    expect(
      gate({
        action: { kind: "verb", noun: "write", verb: "vanta edit-policy-draft" },
        artifact: {},
        meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/nope", requiresApproval: true },
      }).length,
    ).toBe(0);
  });

  it("holds with no approval at all, and names the digest to use", () => {
    const gate = vantaEditPolicyDraftApprovalGate({ expected: "abc123", supplied: null });
    const findings = gate({
      action: { kind: "verb", noun: "write", verb: "vanta edit-policy-draft" },
      artifact: {},
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/nope", requiresApproval: true },
    });
    expect(findings[0]?.severity).toBe("hold");
    expect(findings[0]?.code).toBe(EDIT_POLICY_DRAFT_UNAPPROVED_CODE);
    expect(findings[0]?.correction).toContain("--approve abc123");
  });

  it("holds on a digest for a different substitution", () => {
    const gate = vantaEditPolicyDraftApprovalGate({ expected: "abc123", supplied: "def456" });
    const findings = gate({
      action: { kind: "verb", noun: "write", verb: "vanta edit-policy-draft" },
      artifact: {},
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/nope", requiresApproval: true },
    });
    expect(findings[0]?.summary).toContain("def456");
  });
});

describe("renderVantaEditDryRun", () => {
  it("prints the diff Vanta has none of, and the digest that unlocks it", () => {
    const plan = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "BETA", snapshot }));
    const lines = renderVantaEditDryRun({
      digest: vantaDraftEditDigest({ plan }),
      plan,
      title: snapshot.title,
    });
    expect(lines[0]).toBe("edit-policy-draft (dry run) — Policy Editor: Alpha - Vanta");
    expect(lines[3]).toBe("- Alpha beta gamma.");
    expect(lines[4]).toBe("+ Alpha BETA gamma.");
    expect(lines[6]).toBe(
      `nothing was typed. To apply this exact substitution: --approve ${vantaDraftEditDigest({ plan })}`,
    );
  });
});

describe("vantaDraftObserveSnippet", () => {
  it("carries the address and the settle as JSON literals, never as concatenated source", () => {
    const source = vantaDraftObserveSnippet({
      screenshotPath: "/tmp/a.png",
      settleMs: 6000,
      url: "https://app.vanta.com/c/acme/policies/p-1/edit",
    });
    expect(source).toContain('const url = "https://app.vanta.com/c/acme/policies/p-1/edit";');
    expect(source).toContain("const settleMs = 6000;");
  });

  it("has no write-capable call in it at all", () => {
    const source = vantaDraftObserveSnippet({ screenshotPath: "/tmp/a.png", settleMs: 10, url: "https://x.invalid/" });
    expect(source).not.toContain("insertText");
    expect(source).not.toContain(".click(");
  });

  it("escapes a URL that would otherwise close the string literal", () => {
    const source = vantaDraftObserveSnippet({
      screenshotPath: "/tmp/a.png",
      settleMs: 10,
      url: 'https://x.invalid/"; process.exit(1); //',
    });
    expect(source).toContain('const url = "https://x.invalid/\\"; process.exit(1); //";');
  });
});

describe("vantaDraftEditSnippet", () => {
  const source = vantaDraftEditSnippet({
    expectedText: "Alpha BETA gamma.\n",
    find: "beta",
    replace: "BETA",
    screenshotPath: "/tmp/a.png",
    settleMs: 6000,
    url: "https://app.vanta.com/c/acme/policies/p-1/edit",
  });

  it("carries both strings as JSON literals, never as source", () => {
    expect(source).toContain('const find = "beta";');
    expect(source).toContain('const replace = "BETA";');
  });

  it("types through the keyboard rather than writing the DOM", () => {
    // MEASURED: `document.execCommand("insertText", …)` moved the DOM, the editor's own model
    // never saw it, and Vanta saved the original while every in-page signal read green.
    expect(source).toContain("page.keyboard.insertText(replace)");
    expect(source).not.toContain("execCommand");
  });

  it("reopens the editor and re-reads before it reports anything persisted", () => {
    expect(source).toContain("persisted = (await draftText()) === expectedText;");
  });

  it("never reaches for the control that submits a policy for approval", () => {
    expect(source).not.toContain("Assign approver and submit");
  });

  it("clicks only the draft's own save control", () => {
    expect(source).toContain('name: "Save and close", exact: true');
  });
});
