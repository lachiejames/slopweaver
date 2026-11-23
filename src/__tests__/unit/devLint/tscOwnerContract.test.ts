import { describe, expect, it } from "vitest";

import {
  assessCompilerContract,
  COMPILER_POLICIES,
  mentionsOwner,
  ownerPathFor,
  policyManifests,
  readCompilerOwner,
  type TscOwnerContractError,
  TscOwnerContractErrors,
} from "../../../devLint/tscOwnerContract.js";
import { TYPESCRIPT_PIN, TYPESCRIPT_PIN_MANIFESTS } from "../../../devLint/typescriptPin.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The root `typecheck` the flip lands, under the owner. */
const ROOT_OWNED =
  "bash scripts/tsc-owner.sh --timeout-seconds 1140 --grace-seconds 5 --rss-ceiling-mib 10240 -- node_modules/.bin/tsc --noEmit -p tsconfig.json";

/** The desktop `build` the flip lands, reaching the owner from its own directory. */
const DESKTOP_OWNED =
  "bash ../scripts/tsc-owner.sh --timeout-seconds 540 --grace-seconds 5 --rss-ceiling-mib 4096 -- node_modules/.bin/tsc -p tsconfig.json";

/** The root `typecheck` TypeScript 6 runs today. */
const ROOT_V8 = "node --max-old-space-size=10240 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json";

/**
 * The error one root command reads to.
 *
 * @param command the script's command text
 * @returns the owner contract's refusal
 */
const refusalOf = ({ command }: { command: string }): TscOwnerContractError =>
  unwrapErr(readCompilerOwner({ command, manifest: "package.json" }));

describe("COMPILER_POLICIES", () => {
  it("covers the live pin, so the gate always has a policy to judge by", () => {
    expect(COMPILER_POLICIES.get(TYPESCRIPT_PIN)).toBe("native-owner");
  });

  it("judges TypeScript 7.1 by the native owner", () => {
    expect(COMPILER_POLICIES.get("7.1.0-beta")).toBe("native-owner");
  });
});

describe("ownerPathFor", () => {
  it("reaches the owner from each manifest's own directory", () => {
    expect(ownerPathFor({ manifest: "package.json" })).toBe("scripts/tsc-owner.sh");
    expect(ownerPathFor({ manifest: "desktop/package.json" })).toBe("../scripts/tsc-owner.sh");
  });
});

describe("readCompilerOwner", () => {
  it("reads the root owner command the flip lands", () => {
    expect(unwrap(readCompilerOwner({ command: ROOT_OWNED, manifest: "package.json" }))).toEqual({
      command: ["node_modules/.bin/tsc", "--noEmit", "-p", "tsconfig.json"],
      graceSeconds: 5,
      lockTimeoutSeconds: undefined,
      rssCeilingMiB: 10240,
      timeoutSeconds: 1140,
    });
  });

  it("reads the optional compile-lease wait when a script gives one", () => {
    const command = ROOT_OWNED.replace("--rss-ceiling-mib 10240", "--rss-ceiling-mib 10240 --lock-timeout-seconds 600");
    expect(unwrap(readCompilerOwner({ command, manifest: "package.json" })).lockTimeoutSeconds).toBe(600);
  });

  it("refuses a compile-lease wait given twice, as the owner itself does", () => {
    const command = ROOT_OWNED.replace(
      "--rss-ceiling-mib 10240",
      "--lock-timeout-seconds 600 --rss-ceiling-mib 10240 --lock-timeout-seconds 600",
    );
    expect(refusalOf({ command })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({ option: "--lock-timeout-seconds", why: "is given twice" }),
    );
  });

  it("reads the desktop owner command by its own relative path", () => {
    expect(unwrap(readCompilerOwner({ command: DESKTOP_OWNED, manifest: "desktop/package.json" })).rssCeilingMiB).toBe(
      4096,
    );
  });

  it("refuses the desktop path from the root manifest", () => {
    expect(refusalOf({ command: DESKTOP_OWNED })).toEqual(
      TscOwnerContractErrors.wrongOwner({ expected: "scripts/tsc-owner.sh" }),
    );
  });

  it("refuses the direct Node command TypeScript 6 needs, since a V8 flag bounds nothing native", () => {
    expect(refusalOf({ command: ROOT_V8 }).code).toBe("WRONG_MEMORY_CONTRACT");
  });

  it("refuses a ceiling arriving through NODE_OPTIONS", () => {
    expect(refusalOf({ command: `NODE_OPTIONS=--max-old-space-size=1 ${ROOT_OWNED}` }).code).toBe(
      "WRONG_MEMORY_CONTRACT",
    );
  });

  it("refuses a bare compiler with no owner", () => {
    expect(refusalOf({ command: "tsc -p tsconfig.json" })).toEqual(
      TscOwnerContractErrors.wrongOwner({ expected: "scripts/tsc-owner.sh" }),
    );
  });

  it("refuses a command with a shell operator, which no reader can say the owner's exit survives", () => {
    expect(refusalOf({ command: `${ROOT_OWNED} || true` }).code).toBe("UNREADABLE_COMMAND");
  });

  it("refuses words joined by a carriage return, which the shell reads as one command name (Codex 8b r2)", () => {
    expect(refusalOf({ command: ROOT_OWNED.replaceAll(" ", "\r") })).toEqual(
      TscOwnerContractErrors.wrongOwner({ expected: "scripts/tsc-owner.sh" }),
    );
  });

  it("refuses a bare parenthesis, which the shell reads as syntax rather than an argument (Codex 8b r2)", () => {
    expect(refusalOf({ command: `${ROOT_OWNED} )` }).code).toBe("UNREADABLE_COMMAND");
  });

  it("refuses a missing `--`, since the owner then has no command", () => {
    const command = "bash scripts/tsc-owner.sh --timeout-seconds 1 --grace-seconds 1 --rss-ceiling-mib 1";
    expect(refusalOf({ command })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({ option: "--", why: "is missing, so no command follows" }),
    );
  });

  it("refuses an option given twice", () => {
    const command = ROOT_OWNED.replace("--grace-seconds 5", "--grace-seconds 5 --grace-seconds 1");
    expect(refusalOf({ command })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({ option: "--grace-seconds", why: "is given twice" }),
    );
  });

  it("refuses a zero, a leading zero and a negative value, as the owner does", () => {
    const zero = ROOT_OWNED.replace("--timeout-seconds 1140", "--timeout-seconds 0");
    const padded = ROOT_OWNED.replace("--timeout-seconds 1140", "--timeout-seconds 01140");
    const negative = ROOT_OWNED.replace("--rss-ceiling-mib 10240", "--rss-ceiling-mib -1");
    const notPositive = "is not a positive whole number";
    expect(refusalOf({ command: zero })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({ option: "--timeout-seconds", why: notPositive }),
    );
    expect(refusalOf({ command: padded })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({ option: "--timeout-seconds", why: notPositive }),
    );
    expect(refusalOf({ command: negative })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({ option: "--rss-ceiling-mib", why: notPositive }),
    );
  });

  it("refuses a value past nine digits, whose Bash comparison would never fire (Codex 8b r2)", () => {
    const nine = ROOT_OWNED.replace("--timeout-seconds 1140", "--timeout-seconds 999999999");
    const ten = ROOT_OWNED.replace("--timeout-seconds 1140", "--timeout-seconds 1000000000");
    expect(unwrap(readCompilerOwner({ command: nine, manifest: "package.json" })).timeoutSeconds).toBe(999999999);
    expect(refusalOf({ command: ten })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({
        option: "--timeout-seconds",
        why: "is at most nine digits, which the owner itself enforces",
      }),
    );
  });

  it("refuses a grace past five, which the owner itself refuses", () => {
    const command = ROOT_OWNED.replace("--grace-seconds 5", "--grace-seconds 6");
    expect(refusalOf({ command })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({
        option: "--grace-seconds",
        why: "is at most 5, which the owner itself enforces",
      }),
    );
  });

  it("refuses an option the owner does not take", () => {
    const command = ROOT_OWNED.replace("--grace-seconds 5", "--grace-seconds 5 --verbose 1");
    expect(refusalOf({ command })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({ option: "--verbose", why: "is not one the owner takes" }),
    );
  });

  it("refuses a missing bound", () => {
    const command = ROOT_OWNED.replace("--rss-ceiling-mib 10240 ", "");
    expect(refusalOf({ command })).toEqual(
      TscOwnerContractErrors.invalidOwnerOption({ option: "--rss-ceiling-mib", why: "is missing" }),
    );
  });

  it("refuses an owner bounding something other than the compiler", () => {
    const command = ROOT_OWNED.replace("node_modules/.bin/tsc", "node_modules/.bin/vitest");
    expect(refusalOf({ command })).toEqual(TscOwnerContractErrors.missingCompiler());
  });
});

describe("mentionsOwner", () => {
  it("sees the owner's name spliced from quoted fragments, which the shell joins (Codex 8b r1)", () => {
    expect(mentionsOwner({ command: 'bash scripts/tsc-"owner.sh" -- true' })).toBe(true);
    expect(mentionsOwner({ command: "bash scripts/tsc-'owner.sh' -- true && true" })).toBe(true);
    expect(mentionsOwner({ command: "bash scripts/tsc\\-owner.sh -- true" })).toBe(true);
    expect(mentionsOwner({ command: "bash scripts/tsc-owne\\\nr.sh" })).toBe(true);
    expect(mentionsOwner({ command: "node x.js" })).toBe(false);
  });
});

describe("policyManifests", () => {
  it("keeps the V8 policy on the root manifest, as it always was", () => {
    expect(policyManifests({ policy: "v8-heap" })).toEqual(["package.json"]);
  });

  it("widens the owner policy to every manifest that pins TypeScript", () => {
    expect(policyManifests({ policy: "native-owner" })).toEqual(TYPESCRIPT_PIN_MANIFESTS);
  });
});

describe("assessCompilerContract", () => {
  it("passes today's root scripts under the V8 policy, naming them bare as before", () => {
    const manifests = [{ path: "package.json", scripts: { lint: "tsx x.ts", typecheck: ROOT_V8 } }];
    expect(assessCompilerContract({ manifests, policy: "v8-heap" })).toEqual({
      compilerScripts: ["typecheck"],
      findings: [],
    });
  });

  it("refuses today's root script under the owner policy, so the flip cannot keep it", () => {
    const manifests = [{ path: "package.json", scripts: { typecheck: ROOT_V8 } }];
    expect(assessCompilerContract({ manifests, policy: "native-owner" }).findings).toEqual([
      {
        line: `\`typecheck\` runs the TypeScript compiler and ${TscOwnerContractErrors.wrongMemoryContract({ why: "it carries a V8 heap ceiling, which bounds nothing a native compiler spends — the owner's `--rss-ceiling-mib` is its bound" }).message}: ${ROOT_V8}`,
        script: "typecheck",
      },
    ]);
  });

  it("selects desktop's bare compiler under the owner policy and names it by manifest", () => {
    const manifests = [{ path: "desktop/package.json", scripts: { build: "tsc -p tsconfig.json" } }];
    const assessed = assessCompilerContract({ manifests, policy: "native-owner" });
    expect(assessed.compilerScripts).toEqual(["desktop/package.json#build"]);
    expect(assessed.findings.map((finding) => finding.script)).toEqual(["desktop/package.json#build"]);
  });

  it("passes every owner command the flip lands", () => {
    const manifests = [
      { path: "desktop/package.json", scripts: { build: DESKTOP_OWNED } },
      { path: "package.json", scripts: { typecheck: ROOT_OWNED } },
      { path: "site/package.json", scripts: { build: "next build" } },
    ];
    expect(assessCompilerContract({ manifests, policy: "native-owner" })).toEqual({
      compilerScripts: ["desktop/package.json#build", "typecheck"],
      findings: [],
    });
  });

  it("selects a quote-spliced owner running no compiler, and refuses it (Codex 8b r2)", () => {
    const command = 'bash ../scripts/tsc-"owner.sh" --timeout-seconds 1 --grace-seconds 1 --rss-ceiling-mib 1 -- true';
    const manifests = [{ path: "desktop/package.json", scripts: { probe: command } }];
    expect(assessCompilerContract({ manifests, policy: "native-owner" }).findings.map((f) => f.script)).toEqual([
      "desktop/package.json#probe",
    ]);
  });

  it("selects a misspelt owner even though it names no compiler, and refuses it", () => {
    const command = ROOT_OWNED.replace("node_modules/.bin/tsc", "node_modules/.bin/tsx");
    const manifests = [{ path: "package.json", scripts: { build: command } }];
    expect(assessCompilerContract({ manifests, policy: "native-owner" }).findings.length).toBe(1);
  });
});
