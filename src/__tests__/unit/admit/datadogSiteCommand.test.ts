/**
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { classifyDatadogSiteCommand } from "../../../admit/datadogSiteCommand.js";
import { evaluateHookPayload } from "../../../admit/hookPayload.js";

const ENV = { DD_SITE: "ap1.datadoghq.com" };

describe("classifyDatadogSiteCommand", () => {
  it("blocks a raw open of app.datadoghq.com when the install is on ap1", () => {
    const verdict = classifyDatadogSiteCommand({ command: "open https://app.datadoghq.com/", env: ENV });
    expect(verdict.blocked).toBe(true);
    expect((verdict as { message: string }).message).toContain("open https://app.datadoghq.com/ blocked because");
  });

  it("finds the open inside a compound line and through quotes", () => {
    const verdict = classifyDatadogSiteCommand({
      command: "cd /tmp && xdg-open 'https://app.datadoghq.com/logs'",
      env: ENV,
    });
    expect(verdict.blocked).toBe(true);
  });

  it("allows an open of the install's own console", () => {
    expect(classifyDatadogSiteCommand({ command: "open https://ap1.datadoghq.com/logs", env: ENV })).toEqual({
      blocked: false,
    });
  });

  it("does not read a URL that is only an argument to something other than a browser launcher", () => {
    expect(classifyDatadogSiteCommand({ command: "echo https://app.datadoghq.com/", env: ENV })).toEqual({
      blocked: false,
    });
  });

  it("honours the inline hatch on its own segment only", () => {
    const covered = "SLOPWEAVER_ALLOW_DATADOG_SITE=1 open https://app.datadoghq.com/";
    expect(classifyDatadogSiteCommand({ command: covered, env: ENV })).toEqual({ blocked: false });
    const leaked = `${covered}; open https://us3.datadoghq.com/`;
    expect(classifyDatadogSiteCommand({ command: leaked, env: ENV }).blocked).toBe(true);
  });

  it("looks inside a shell wrapper — the r1 review's counterexample", () => {
    const wrapped = "bash -c 'open https://app.datadoghq.com/logs'";
    expect(classifyDatadogSiteCommand({ command: wrapped, env: ENV }).blocked).toBe(true);
  });

  it("opens a combined short-flag cluster such as -lc — the r2 review's counterexample", () => {
    const wrapped = "bash -lc 'open https://app.datadoghq.com/logs'";
    expect(classifyDatadogSiteCommand({ command: wrapped, env: ENV }).blocked).toBe(true);
  });

  it("looks past nohup, command and a path-qualified launcher", () => {
    expect(
      classifyDatadogSiteCommand({ command: "nohup /usr/bin/open https://app.datadoghq.com/", env: ENV }).blocked,
    ).toBe(true);
    expect(classifyDatadogSiteCommand({ command: "command open https://us3.datadoghq.com/", env: ENV }).blocked).toBe(
      true,
    );
  });

  it("decodes a $'…' launcher or address the way bash hands it over, top level or wrapped", () => {
    const commands = [
      "$'\\x6fpen' https://app.datadoghq.com/",
      "open $'https://app.\\x64atadoghq.com/'",
      "bash -c $'\\x6fpen https://app.datadoghq.com/'",
    ];
    expect(commands.map((command) => classifyDatadogSiteCommand({ command, env: ENV }).blocked)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("allows a wrapped open of the install's own console", () => {
    expect(classifyDatadogSiteCommand({ command: "sh -c 'open https://ap1.datadoghq.com/'", env: ENV })).toEqual({
      blocked: false,
    });
  });
});

describe("evaluateHookPayload's Datadog site walk", () => {
  it("blocks a Bash open of the wrong site when the hook passes its environment", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      env: ENV,
      payload: { tool_input: { command: "open https://app.datadoghq.com/" }, tool_name: "Bash" },
    });
    expect(decision.block).toBe(true);
  });
});
