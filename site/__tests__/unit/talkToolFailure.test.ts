/*
 * A failed voice tool reaches the model with its refusal WHOLE — the four-line hatch refusal's first line
 * included, since that is where the Datadog site guard names the right host. Every Datadog host in this file reads
 * a synthetic site (`ap1`, and `us3` for the wrong one) rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { talkToolFailureDetail } from "../../lib/talkToolFailure";

const TITLE = "slopweaver browser present --json";

/** The Datadog site guard's refusal as the verb prints it: four lines, the host on the first. */
const SITE_REFUSAL = [
  "slopweaver browser present blocked because app.datadoghq.com is not this install's Datadog site — DD_SITE is ap1.datadoghq.com, so the console is https://ap1.datadoghq.com.",
  "Legitimate exceptions may include the page belongs to a second Datadog organisation.",
  "To override use the designated escape hatch SLOPWEAVER_ALLOW_DATADOG_SITE=1 slopweaver browser present.",
  "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.",
].join("\n");

/** The same guard's refusal with DD_SITE unset, as the verb prints it: its first line is the longest. */
const UNSET_REFUSAL =
  "slopweaver browser present blocked because the address is a Datadog console on a site other than this install's DD_SITE, and Datadog sites are separate orgs — the wrong one shows a sign-in wall or an empty org, never an error (app.datadoghq.com is a Datadog console, and this install's site cannot be checked: DD_SITE is not set, and it has no safe default — the SDK would fall back to datadoghq.com (US1), a different org that answers queries with silence rather than an error. Export one of: datadoghq.com, us3.datadoghq.com, us5.datadoghq.com, ap1.datadoghq.com, ap2.datadoghq.com, datadoghq.eu, ddog-gov.com, us2.ddog-gov.com, uk1.datadoghq.com).\nLegitimate exceptions may include the page belongs to a second Datadog organisation on another site that this install genuinely has an account in; DD_SITE itself is what is wrong, and the page is being opened once to confirm which site the org lives on.\nTo override use the designated escape hatch SLOPWEAVER_ALLOW_DATADOG_SITE=1 slopweaver browser present.\nUse good judgement to determine whether the owner would approve of this, then proceed or correct your approach.";

describe("talkToolFailureDetail", () => {
  it("keeps a four-line refusal's first line, where the right host is named", () => {
    const detail = talkToolFailureDetail({
      outcome: { err: `${SITE_REFUSAL}\n`, exitCode: 1, notMeasured: "tail", ok: false, out: "", tookMs: 5 },
      title: TITLE,
    });
    expect(detail).toBe(`${TITLE} exited 1: ${SITE_REFUSAL.split("\n").join(" · ")}`);
    expect(detail).toContain("so the console is https://ap1.datadoghq.com");
  });

  it("keeps only the last six lines of a longer stderr", () => {
    const err = ["one", "two", "three", "four", "five", "six", "seven"].join("\n");
    const detail = talkToolFailureDetail({
      outcome: { err, exitCode: 2, notMeasured: "tail", ok: false, out: "", tookMs: 5 },
      title: TITLE,
    });
    expect(detail).toBe(`${TITLE} exited 2: two · three · four · five · six · seven`);
  });

  it("cuts a one-line flood by its middle, keeping its head and its tail", () => {
    const detail = talkToolFailureDetail({
      outcome: {
        err: `START${"x".repeat(5000)}END`,
        exitCode: 1,
        notMeasured: "tail",
        ok: false,
        out: "",
        tookMs: 5,
      },
      title: TITLE,
    });
    expect(detail).toBe(`${TITLE} exited 1: START${"x".repeat(745)}…${"x".repeat(746)}END`);
  });

  it("keeps a whole refusal below a long line, which pays for the budget alone", () => {
    const detail = talkToolFailureDetail({
      outcome: {
        err: `${"x".repeat(3000)}\n${SITE_REFUSAL}`,
        exitCode: 1,
        notMeasured: "tail",
        ok: false,
        out: "",
        tookMs: 5,
      },
      title: TITLE,
    });
    const refusal = SITE_REFUSAL.split("\n").join(" · ");
    expect(detail.endsWith(` · ${refusal}`)).toBe(true);
    expect(detail.length - `${TITLE} exited 1: `.length).toBe(1500);
  });

  it("keeps a whole unset-DD_SITE refusal below two floods", () => {
    const detail = talkToolFailureDetail({
      outcome: {
        err: [`A${"x".repeat(3000)}`, `B${"y".repeat(3000)}`, UNSET_REFUSAL].join("\n"),
        exitCode: 1,
        notMeasured: "tail",
        ok: false,
        out: "",
        tookMs: 5,
      },
      title: TITLE,
    });
    const refusal = UNSET_REFUSAL.split("\n").join(" · ");
    expect(detail.endsWith(` · ${refusal}`)).toBe(true);
    expect(detail).toContain("this install's site cannot be checked: DD_SITE is not set");
    expect(detail.startsWith(`${TITLE} exited 1: A${"x".repeat(39)}…${"x".repeat(39)} · B`)).toBe(true);
    expect(detail.length - `${TITLE} exited 1: `.length).toBe(1500);
  });

  it("says only the exit when the verb printed nothing to stderr", () => {
    const detail = talkToolFailureDetail({
      outcome: { err: "  \n", exitCode: 1, notMeasured: "tail", ok: false, out: "", tookMs: 5 },
      title: TITLE,
    });
    expect(detail).toBe(`${TITLE} exited 1`);
  });

  it("keeps a timeout's own sentence, which carries no exit code", () => {
    const notMeasured = `${TITLE} did not answer within 75s`;
    const detail = talkToolFailureDetail({
      outcome: { err: "partial", exitCode: undefined, notMeasured, ok: false, out: "", tookMs: 75_000 },
      title: TITLE,
    });
    expect(detail).toBe(notMeasured);
  });
});
