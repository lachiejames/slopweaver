// deleted-with-code: parsePolicyImport, parsePolicyDrift, importHumanLines, driftHumanLines
import { describe, expect, it } from "vitest";

import { parsePolicyRender } from "../../../cli/commands/policy/core.js";
import { VantaVerbErrors } from "../../../cli/commands/vanta/errors.js";
import { parseUploadPolicyVersionOptions, UPLOAD_FLAGS } from "../../../cli/commands/vanta/policyUploadOptions.js";
import { VANTA_UPLOAD_POLICY_VERSION_USAGE } from "../../../cli/commands/vanta/policyUploadRun.js";
import { parsePolicyVersionsOptions } from "../../../cli/commands/vanta/policyVersionRun.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("parsePolicyRender", () => {
  it("requires both --file and --out", () => {
    const parsed = parsePolicyRender({ rest: [] });
    expect(parsed.isErr()).toBe(true);
    expect([...unwrapErr(parsed)]).toStrictEqual([
      "--file <path> is required: the policy markdown to render",
      "--out <path> is required: where to write the PDF",
    ]);
  });

  it("takes the markdown in and the PDF out", () => {
    const options = unwrap(parsePolicyRender({ rest: ["--file", "a.md", "--out", "a.pdf"] }));
    expect(options.file).toBe("a.md");
    expect(options.out).toBe("a.pdf");
  });

  it("refuses an undeclared flag by name rather than ignoring it", () => {
    const parsed = parsePolicyRender({ rest: ["--file", "a.md", "--out", "a.pdf", "--publish"] });
    expect([...unwrapErr(parsed)]).toStrictEqual(["unknown flag: --publish"]);
  });

  it("refuses a value flag followed by another flag, rather than reading the flag as its value", () => {
    const parsed = parsePolicyRender({ rest: ["--file", "--json", "--out", "a.pdf"] });
    expect([...unwrapErr(parsed)]).toStrictEqual(["--file requires a value"]);
  });
});

describe("parsePolicyVersionsOptions", () => {
  it("requires --policy", () => {
    const refusal = unwrapErr(parsePolicyVersionsOptions({ defaultHome: "/home", rest: [] }));
    expect(refusal).toStrictEqual(VantaVerbErrors.policyMissing());
    expect(refusal.message).toBe("--policy <id> is required: the Vanta policy whose version menu should be described");
  });

  it("refuses an empty --policy with a different code from a missing one", () => {
    const refusal = unwrapErr(parsePolicyVersionsOptions({ defaultHome: "/home", rest: ["--policy", ""] }));
    expect(refusal).toStrictEqual(VantaVerbErrors.policyEmpty());
    expect(refusal.code).toBe("INVALID_FLAG_VALUE");
  });

  it("takes the policy and an explicit tenant", () => {
    const options = unwrap(
      parsePolicyVersionsOptions({ defaultHome: "/home", rest: ["--policy", "p1", "--tenant", "acme"] }),
    );
    expect(options.policyId).toBe("p1");
    expect(options.tenant).toBe("acme");
    expect(options.home).toBe("/home");
  });

  it("takes a named --home over the default", () => {
    const options = unwrap(
      parsePolicyVersionsOptions({ defaultHome: "/home", rest: ["--policy", "p1", "--home", "/h"] }),
    );
    expect(options.home).toBe("/h");
  });

  it("refuses a dangling --tenant by name rather than reading it as not passed", () => {
    const refusal = unwrapErr(
      parsePolicyVersionsOptions({ defaultHome: "/home", rest: ["--policy", "p", "--tenant"] }),
    );
    expect(refusal.code).toBe("FLAGS_REFUSED");
    expect(refusal).toStrictEqual(VantaVerbErrors.flagsRefused({ reasons: ["--tenant requires a value"] }));
  });

  it("refuses --home followed by --json, rather than reading a home called --json", () => {
    const refusal = unwrapErr(
      parsePolicyVersionsOptions({ defaultHome: "/home", rest: ["--policy", "p", "--home", "--json"] }),
    );
    expect(refusal).toStrictEqual(VantaVerbErrors.flagsRefused({ reasons: ["--home requires a value"] }));
  });
});

describe("parseUploadPolicyVersionOptions", () => {
  it("accepts exactly the flags the usage line advertises", () => {
    const accepted = [...UPLOAD_FLAGS.value, ...UPLOAD_FLAGS.boolean].map((flag) => `--${flag}`);
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.filter((flag) => !VANTA_UPLOAD_POLICY_VERSION_USAGE.includes(flag))).toEqual([]);
  });

  it("refuses a missing policy before a missing markdown, with the missing-flag code", () => {
    const refusal = unwrapErr(parseUploadPolicyVersionOptions({ defaultHome: "/home", rest: [] }));
    expect(refusal).toStrictEqual(VantaVerbErrors.uploadPolicyMissing());
    expect(refusal.code).toBe("FLAG_MISSING");
  });

  it("refuses a missing markdown by its own flag once the policy is given", () => {
    const refusal = unwrapErr(parseUploadPolicyVersionOptions({ defaultHome: "/home", rest: ["--policy", "p"] }));
    expect(refusal).toStrictEqual(VantaVerbErrors.uploadFileMissing());
    expect(refusal.code).toBe("FLAG_MISSING");
  });

  it("refuses an empty policy id and an empty path with the invalid-value code, apart from missing ones", () => {
    const policy = unwrapErr(
      parseUploadPolicyVersionOptions({ defaultHome: "/home", rest: ["--policy", "", "--file", ""] }),
    );
    expect(policy).toStrictEqual(VantaVerbErrors.policyEmpty());
    expect(policy.code).toBe("INVALID_FLAG_VALUE");
    const file = unwrapErr(
      parseUploadPolicyVersionOptions({ defaultHome: "/home", rest: ["--policy", "p", "--file", ""] }),
    );
    expect(file).toStrictEqual(VantaVerbErrors.uploadFileEmpty());
    expect(file.code).toBe("INVALID_FLAG_VALUE");
  });

  it("names an empty value before a missing flag beside it, in either order", () => {
    const fileEmpty = unwrapErr(parseUploadPolicyVersionOptions({ defaultHome: "/home", rest: ["--file", ""] }));
    expect(fileEmpty).toStrictEqual(VantaVerbErrors.uploadFileEmpty());
    const policyEmpty = unwrapErr(parseUploadPolicyVersionOptions({ defaultHome: "/home", rest: ["--policy", ""] }));
    expect(policyEmpty).toStrictEqual(VantaVerbErrors.policyEmpty());
  });

  it("records the source commit as unrecorded rather than refusing without one", () => {
    const options = unwrap(
      parseUploadPolicyVersionOptions({ defaultHome: "/home", rest: ["--policy", "p", "--file", "p.md"] }),
    );
    expect(options.sourceCommit).toBe("unrecorded");
    expect(options.dryRun).toBe(false);
    expect(options.approve).toBe(null);
  });

  it("takes an approval digest and a dry run", () => {
    const options = unwrap(
      parseUploadPolicyVersionOptions({
        defaultHome: "/home",
        rest: ["--policy", "p", "--file", "p.md", "--approve", "abc123", "--dry-run"],
      }),
    );
    expect(options.approve).toBe("abc123");
    expect(options.dryRun).toBe(true);
  });

  it("refuses --home followed by --json, rather than reading a home called --json", () => {
    const problems = unwrapErr(
      parseUploadPolicyVersionOptions({
        defaultHome: "/home",
        rest: ["--policy", "p", "--file", "p.md", "--home", "--json"],
      }),
    );
    expect(problems).toStrictEqual(VantaVerbErrors.flagsRefused({ reasons: ["--home requires a value"] }));
  });
});
