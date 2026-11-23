/**
 * `datadog alert-digest`'s SHELL, over injected edges.
 *
 * Everything here is a path the verb takes BEFORE it reaches Datadog, which is the half a unit test can
 * hold: the flag refusal, the probe-document refusals and the window refusal all decide before a client is
 * ever constructed. That is not a limitation worked around — it is the property worth pinning, because a
 * scheduled row that is going to fail should fail on its own configuration rather than after spending a
 * rate-limit budget. The counting half is exercised for real by running the verb; the arithmetic over what
 * it counted is `unit/datadog/alertProbe.test.ts`.
 *
 * **These cases are also the witness that the refusals are environment-INDEPENDENT.** CI holds no `DD_*`
 * variable and a developer's shell does, so an ordering that resolved the Datadog config before judging a
 * caller's own flags would answer the same input two different ways on the two machines. That is exactly
 * what happened, measured once: the window case below passed locally and failed in CI, which is how
 * the ordering defect was found. Do not add a case here that needs a credential to reach its assertion.
 */
import { describe, expect, it } from "vitest";

import { ALERT_DIGEST_RESIDUE } from "../../../../../cli/commands/datadog/alertDigestCore.js";
import {
  type DatadogAlertDigestDeps,
  runDatadogAlertDigestWith,
} from "../../../../../cli/commands/datadog/alertDigestRun.js";

/** Recording edges. `nowMs` is pinned so a window refusal is decided against a known instant. */
function deps(): DatadogAlertDigestDeps & { readonly out: string[]; readonly diag: string[] } {
  const out: string[] = [];
  const diag: string[] = [];
  return {
    diag,
    nowMs: () => 1_789_438_486_508,
    out,
    writeDiagnostic: (line) => diag.push(line),
    writeOut: (line) => out.push(line),
  };
}

/** One valid probe, as a JSON document the verb reads inline. */
const ONE_PROBE = JSON.stringify({
  probes: [
    {
      id: "sends",
      kind: "logs-count",
      query: "service:example-api status:error",
      severityWhenFiring: "orange",
      title: "send failures",
      why: "the outer send catch",
    },
  ],
});

describe("datadog alert-digest — what it decides before reaching Datadog", () => {
  it("prints its own usage on --help and exits clean", async () => {
    const injected = deps();
    const code = await runDatadogAlertDigestWith({ deps: injected, rest: ["--help"] });
    expect(code).toBe(0);
    expect(injected.out[0]).toContain("usage: slopweaver datadog alert-digest");
    expect(injected.diag).toEqual([]);
  });

  it("refuses a missing --probes as a caller mistake, naming the flag", async () => {
    const injected = deps();
    const code = await runDatadogAlertDigestWith({ deps: injected, rest: ["--label", "Knock"] });
    expect(code).toBe(2);
    expect(injected.diag.some((line) => line.includes("--probes is required"))).toBe(true);
    expect(injected.out).toEqual([]);
  });

  it("refuses a --probes value that is neither JSON nor a readable file", async () => {
    const injected = deps();
    const code = await runDatadogAlertDigestWith({
      deps: injected,
      rest: ["--probes", "/nowhere/probes.json", "--label", "Knock"],
    });
    expect(code).toBe(2);
    expect(injected.diag.some((line) => line.includes("is not a readable file"))).toBe(true);
    expect(injected.diag.some((line) => line.includes("/nowhere/probes.json"))).toBe(true);
  });

  it("refuses a probe document that parses as JSON but is not a probe set", async () => {
    const injected = deps();
    const code = await runDatadogAlertDigestWith({
      deps: injected,
      rest: ["--probes", '{"checks":[]}', "--label", "Knock"],
    });
    expect(code).toBe(2);
    expect(injected.diag.some((line) => line.includes("not a probe set"))).toBe(true);
  });

  it("refuses a malformed probe document as unreadable rather than as an empty set", async () => {
    const injected = deps();
    const code = await runDatadogAlertDigestWith({ deps: injected, rest: ["--probes", "{oops", "--label", "Knock"] });
    expect(code).toBe(2);
    expect(injected.diag.some((line) => line.includes("could not be read as JSON"))).toBe(true);
  });

  it("refuses an unparseable window before constructing a client", async () => {
    const injected = deps();
    const code = await runDatadogAlertDigestWith({
      deps: injected,
      rest: ["--probes", ONE_PROBE, "--label", "Knock", "--window", "a fortnight"],
    });
    expect(code).toBe(2);
    expect(injected.diag.some((line) => line.includes("is not a window"))).toBe(true);
    expect(injected.out).toEqual([]);
  });

  it("refuses --form and --json together, since they are two different documents", async () => {
    const injected = deps();
    const code = await runDatadogAlertDigestWith({
      deps: injected,
      rest: ["--probes", ONE_PROBE, "--label", "Knock", "--form", "--json"],
    });
    expect(code).toBe(2);
    expect(injected.diag.some((line) => line.includes("not both"))).toBe(true);
  });

  it("states its residue rather than leaving a zero to read as good news", () => {
    expect(ALERT_DIGEST_RESIDUE.length).toBeGreaterThan(0);
    expect(ALERT_DIGEST_RESIDUE.some((line) => line.includes("PHRASE"))).toBe(true);
    expect(ALERT_DIGEST_RESIDUE.some((line) => line.includes("the trend compares TOTALS"))).toBe(true);
  });
});
