import { describe, expect, it } from "vitest";

import { checkHandoverDoc, checkWholeSuiteGateProbes } from "../../../handover/check.js";
import { COMMAND_PROBE_TIMEOUT_MS } from "../../../handover/commandProbe.js";

describe("checkWholeSuiteGateProbes", () => {
  it("flags the measured case — a bare `yarn lint` probe against a 30s budget", () => {
    const findings = checkWholeSuiteGateProbes({ line: '  - command: "yarn lint"', lineNumber: 9 });

    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toBe(9);
    expect(findings[0]!.message).toContain("runs the whole `lint` script with nothing narrowing it");
  });

  it("names the runner's own budget, so the message cannot drift from COMMAND_PROBE_TIMEOUT_MS", () => {
    const findings = checkWholeSuiteGateProbes({ line: "  - command: yarn validate", lineNumber: 1 });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain(`${String(COMMAND_PROBE_TIMEOUT_MS / 1000)}s probe budget`);
  });

  it("states the budget as a risk rather than asserting a timeout it cannot time", () => {
    // `yarn hygiene` is flagged and completes in 5.4s (`time yarn hygiene`), so a message claiming this
    // probe WILL time out would be false on a script the check itself reports.
    const findings = checkWholeSuiteGateProbes({ line: "  - command: yarn hygiene", lineNumber: 1 });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("weak evidence however long it takes");
    expect(findings[0]!.message).toContain("spending an unbounded lap");
  });

  it("flags `npm run <script>`, where the run word narrows nothing", () => {
    const findings = checkWholeSuiteGateProbes({ line: '  - command: "npm run lint"', lineNumber: 1 });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("runs the whole `lint` script");
  });

  it("flags `pnpm test`", () => {
    const findings = checkWholeSuiteGateProbes({ line: '  - command: "pnpm test"', lineNumber: 1 });

    expect(findings.length).toBe(1);
  });

  it("flags a whole-suite segment that is piped into an assertion — the pipe does not shorten the lap", () => {
    const findings = checkWholeSuiteGateProbes({
      line: "  - command: \"yarn lint | grep -q 'no findings'\"",
      lineNumber: 1,
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("runs the whole `lint` script");
  });

  it("reports each unnarrowed script run in a compound command separately", () => {
    const findings = checkWholeSuiteGateProbes({ line: '  - command: "yarn typecheck && yarn lint"', lineNumber: 4 });

    expect(findings.length).toBe(2);
    expect(findings[0]!.message).toContain("runs the whole `typecheck` script");
    expect(findings[1]!.message).toContain("runs the whole `lint` script");
  });

  it("passes the reference's own ACCEPTED example — a scoped test run", () => {
    const findings = checkWholeSuiteGateProbes({
      line: '  - command: "yarn test:unit github/merge --coverage.enabled=false"',
      lineNumber: 1,
    });

    expect(findings).toEqual([]);
  });

  it("passes a scoped vitest invocation", () => {
    const findings = checkWholeSuiteGateProbes({
      line: '  - command: "yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/handover"',
      lineNumber: 1,
    });

    expect(findings).toEqual([]);
  });

  it("passes a single gate's own entry point", () => {
    const findings = checkWholeSuiteGateProbes({
      line: '  - command: "yarn tsx src/devLint/jsdocTags.entry.ts"',
      lineNumber: 1,
    });

    expect(findings).toEqual([]);
  });

  it("passes a bare manager invocation, which names no script at all", () => {
    expect(checkWholeSuiteGateProbes({ line: '  - command: "yarn"', lineNumber: 1 })).toEqual([]);
  });

  it("passes a manager flag, which is not a script name", () => {
    expect(checkWholeSuiteGateProbes({ line: '  - command: "yarn --version"', lineNumber: 1 })).toEqual([]);
  });

  it("stays silent on a command substitution, where nothing static can see what runs", () => {
    const findings = checkWholeSuiteGateProbes({ line: '  - command: "test -n \\"$(yarn lint)\\""', lineNumber: 1 });

    expect(findings).toEqual([]);
  });

  it("stays silent on a probe that runs no package-manager script", () => {
    const findings = checkWholeSuiteGateProbes({
      line: "  - command: \"slopweaver handover list --json | jq -e '.rows'\"",
      lineNumber: 1,
    });

    expect(findings).toEqual([]);
  });

  it("stays silent on prose that merely mentions `yarn lint` outside a `command:` field", () => {
    const findings = checkWholeSuiteGateProbes({
      line: "MEASURED 8 Sep 2026: `yarn lint` exited 0 at 337s while the probe reported a failure.",
      lineNumber: 3,
    });

    expect(findings).toEqual([]);
  });
});

describe("checkHandoverDoc — whole-suite gate probes", () => {
  it("reaches the caller, carrying the line the probe was written on", () => {
    const findings = checkHandoverDoc({
      resolves: () => true,
      text: 'doneWhen:\n  - command: "yarn lint"\n',
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toBe(2);
    expect(findings[0]!.message).toContain("runs the whole `lint` script with nothing narrowing it");
  });

  it("leaves a scoped probe alone end to end", () => {
    const findings = checkHandoverDoc({
      resolves: () => true,
      text: 'doneWhen:\n  - command: "yarn test:unit handover/wholeSuiteGateProbe --coverage.enabled=false"\n',
    });

    expect(findings).toEqual([]);
  });
});
