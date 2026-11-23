import { describe, expect, it } from "vitest";

import { INVALID_DATADOG_CONSOLE_HOSTS, invalidDatadogConsoleHosts } from "../../../datadog/invalidConsoleHost.js";

/** The link the bot actually posted. */
const OFFENDING_URL = "https://app.ap2.datadoghq.com/monitors/1000001";

describe("INVALID_DATADOG_CONSOLE_HOSTS — derived from the console-host table", () => {
  it("bans app.<site> for exactly the sites whose console is elsewhere", () => {
    expect(INVALID_DATADOG_CONSOLE_HOSTS).toEqual([
      { correctHost: "us3.datadoghq.com", invalidHost: "app.us3.datadoghq.com" },
      { correctHost: "us5.datadoghq.com", invalidHost: "app.us5.datadoghq.com" },
      { correctHost: "ap1.datadoghq.com", invalidHost: "app.ap1.datadoghq.com" },
      { correctHost: "ap2.datadoghq.com", invalidHost: "app.ap2.datadoghq.com" },
      { correctHost: "us2.ddog-gov.com", invalidHost: "app.us2.ddog-gov.com" },
      { correctHost: "uk1.datadoghq.com", invalidHost: "app.uk1.datadoghq.com" },
    ]);
  });
});

describe("invalidDatadogConsoleHosts", () => {
  it("finds the host in the URL the bot posted, naming ap2.datadoghq.com", () => {
    expect(invalidDatadogConsoleHosts({ text: `monitor: ${OFFENDING_URL}` })).toEqual([
      { correctHost: "ap2.datadoghq.com", invalidHost: "app.ap2.datadoghq.com", matched: "app.ap2.datadoghq.com" },
    ]);
  });

  it("finds it inside a Slack mrkdwn link and a markdown destination", () => {
    const text = `<${OFFENDING_URL}|monitor 1000001> and [the monitor](${OFFENDING_URL}).`;
    expect(invalidDatadogConsoleHosts({ text }).map((hit) => hit.matched)).toEqual([
      "app.ap2.datadoghq.com",
      "app.ap2.datadoghq.com",
    ]);
  });

  it("finds it whatever the case, quoting it as written", () => {
    expect(invalidDatadogConsoleHosts({ text: "HTTPS://App.AP2.DatadogHQ.com/monitors/1000001" })).toEqual([
      { correctHost: "ap2.datadoghq.com", invalidHost: "app.ap2.datadoghq.com", matched: "App.AP2.DatadogHQ.com" },
    ]);
  });

  it("reads one layer of percent-encoded hostname characters", () => {
    expect(invalidDatadogConsoleHosts({ text: "https%3A%2F%2Fapp%2eap2%2Edatadoghq.com%2Fmonitors" })).toEqual([
      { correctHost: "ap2.datadoghq.com", invalidHost: "app.ap2.datadoghq.com", matched: "app%2eap2%2Edatadoghq.com" },
    ]);
  });

  it("finds a URL percent-encoded into another one's query string", () => {
    expect(
      invalidDatadogConsoleHosts({ text: "https://example.com/?next=https%3A%2F%2Fapp.ap2.datadoghq.com%2Fmonitors" })
        .length,
    ).toBe(1);
  });

  it("leaves an escape of a non-printable character as written", () => {
    expect(invalidDatadogConsoleHosts({ text: "%0Aapp.ap2.datadoghq.com" }).map((hit) => hit.matched)).toEqual([
      "app.ap2.datadoghq.com",
    ]);
  });

  it("counts a sentence-ending full stop as the end of the host", () => {
    expect(invalidDatadogConsoleHosts({ text: "It lives on app.ap2.datadoghq.com." }).length).toBe(1);
  });

  it("reports every occurrence and every banned site", () => {
    const text = `${OFFENDING_URL} ${OFFENDING_URL} https://app.us3.datadoghq.com/logs`;
    expect(invalidDatadogConsoleHosts({ text }).map((hit) => hit.correctHost)).toEqual([
      "ap2.datadoghq.com",
      "ap2.datadoghq.com",
      "us3.datadoghq.com",
    ]);
  });

  it("passes the real consoles, including the unprefixed sites whose console IS app.", () => {
    const text = [
      "https://ap2.datadoghq.com/monitors/1000001",
      "https://app.datadoghq.com/logs",
      "https://app.datadoghq.eu/logs",
      "https://app.ddog-gov.com/logs",
    ].join(" ");
    expect(invalidDatadogConsoleHosts({ text })).toEqual([]);
  });

  it("passes a longer hostname that merely contains the banned one", () => {
    const text = "xapp.ap2.datadoghq.com app.ap2.datadoghq.com.example.org app.ap2.datadoghq.community";
    expect(invalidDatadogConsoleHosts({ text })).toEqual([]);
  });

  it("reads a non-ASCII character after the host as a boundary, even one Unicode case folding maps to ASCII", () => {
    const text = "app.ap2.datadoghq.comſ app.ap2.datadoghq.comK app.ap2.datadoghq.comé";
    expect(invalidDatadogConsoleHosts({ text }).map((hit) => hit.matched)).toEqual([
      "app.ap2.datadoghq.com",
      "app.ap2.datadoghq.com",
      "app.ap2.datadoghq.com",
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(invalidDatadogConsoleHosts({ text: "" })).toEqual([]);
  });
});
