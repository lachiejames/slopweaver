import { describe, expect, it } from "vitest";

import { DATADOG_SITE_OVERRIDE_ENV, datadogSiteRefusal, wrongDatadogSite } from "../../../datadog/siteGuard.js";

const AP1 = "ap1.datadoghq.com";

describe("wrongDatadogSite", () => {
  it("names the right console when the address is US1 and DD_SITE is ap1", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://app.datadoghq.com/logs" })).toBe(
      "app.datadoghq.com is not this install's Datadog site — DD_SITE is ap1.datadoghq.com, so the console is https://ap1.datadoghq.com",
    );
  });

  it("allows the install's own console host", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://ap1.datadoghq.com/monitors/1" })).toBe(undefined);
  });

  it("refuses another regional console, not only US1", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://us3.datadoghq.com/logs" })).toContain("us3.datadoghq.com");
  });

  it("leaves hosts that are not consoles alone", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://docs.datadoghq.com/logs/" })).toBe(undefined);
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://api.datadoghq.com/api/v1/validate" })).toBe(undefined);
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://duckduckgo.com" })).toBe(undefined);
  });

  it("refuses every console when DD_SITE is unset, since no site is a safe default", () => {
    expect(wrongDatadogSite({ ddSite: undefined, url: "https://ap1.datadoghq.com/logs" })).toContain(
      "DD_SITE is not set",
    );
  });

  it("names only the host when DD_SITE is unset, so a long address cannot crowd out why", () => {
    const url = `https://app.datadoghq.com/logs?q=${"a".repeat(2000)}`;
    expect(wrongDatadogSite({ ddSite: undefined, url })).toMatch(
      /^app\.datadoghq\.com is a Datadog console, and this install's site cannot be checked: DD_SITE is not set/u,
    );
  });

  it("judges a host written with a trailing root dot as that host", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://app.datadoghq.com./logs" })).toContain(
      "app.datadoghq.com is not this install's Datadog site",
    );
  });

  it("refuses the dead app.ap1 host and names the console — the console-voice monitor link", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://app.ap1.datadoghq.com/monitors/1000002/edit" })).toBe(
      "app.ap1.datadoghq.com is not a Datadog console — no site serves one there, so it opens a sign-in wall; the console is https://ap1.datadoghq.com",
    );
  });

  it("names this install's console for a dead host derived from another site", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://app.us3.datadoghq.com/logs" })).toBe(
      "app.us3.datadoghq.com is not a Datadog console — no site serves one there, so it opens a sign-in wall; the console is https://ap1.datadoghq.com",
    );
  });

  it("names the dead host's own console when DD_SITE is unset", () => {
    expect(wrongDatadogSite({ ddSite: undefined, url: "https://APP.AP1.datadoghq.com./monitors/1" })).toBe(
      "app.ap1.datadoghq.com is not a Datadog console — no site serves one there, so it opens a sign-in wall; the console is https://ap1.datadoghq.com",
    );
  });

  it("leaves a longer host that merely contains the dead one alone", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://xapp.ap1.datadoghq.com/logs" })).toBe(undefined);
  });

  it("compares the host case-insensitively", () => {
    expect(wrongDatadogSite({ ddSite: AP1, url: "https://APP.DatadogHQ.com/logs" })).toContain("app.datadoghq.com");
  });
});

describe("datadogSiteRefusal", () => {
  it("renders the four-line refusal naming the command, the right host and the hatch", () => {
    const lines = datadogSiteRefusal({
      command: "slopweaver browser open",
      env: { DD_SITE: AP1 },
      url: "https://app.datadoghq.com/logs",
    })!.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("slopweaver browser open blocked because");
    expect(lines[0]).toContain("https://ap1.datadoghq.com");
    expect(lines[2]).toBe(
      `To override use the designated escape hatch ${DATADOG_SITE_OVERRIDE_ENV}=1 slopweaver browser open.`,
    );
  });

  it("refuses a browser inspect of the dead host, naming the console to retry on", () => {
    const refusal = datadogSiteRefusal({
      command: "slopweaver browser inspect",
      env: { DD_SITE: AP1 },
      url: "https://app.ap1.datadoghq.com/monitors/1000002/edit",
    })!.split("\n");
    expect(refusal[0]).toContain("slopweaver browser inspect blocked because");
    expect(refusal[0]).toContain(
      "(app.ap1.datadoghq.com is not a Datadog console — no site serves one there, so it opens a sign-in wall; the console is https://ap1.datadoghq.com)",
    );
  });

  it("opens for the hatch", () => {
    const env = { DD_SITE: AP1, [DATADOG_SITE_OVERRIDE_ENV]: "1" };
    expect(datadogSiteRefusal({ command: "x", env, url: "https://app.datadoghq.com/logs" })).toBe(undefined);
  });
});
