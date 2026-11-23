import { describe, expect, it } from "vitest";

import { classifyAdcSigninCommand, isAdcSigninLogin } from "../../../admit/adcSigninCommand.js";
import { evaluateHookPayload } from "../../../admit/hookPayload.js";

const judge = ({ command, env = {} }: { command: string; env?: Record<string, string> }) =>
  classifyAdcSigninCommand({ command, env });

describe("isAdcSigninLogin", () => {
  it("catches the sign-in, with flags around its words", () => {
    expect([
      isAdcSigninLogin({ tokens: ["gcloud", "auth", "application-default", "login"] }),
      isAdcSigninLogin({
        tokens: ["gcloud", "--project", "x", "auth", "application-default", "login", "--no-launch-browser"],
      }),
      isAdcSigninLogin({ tokens: ["/opt/homebrew/bin/gcloud", "auth", "application-default", "login"] }),
    ]).toEqual([true, true, true]);
  });

  it("passes every other gcloud line, and a line that only names the command", () => {
    expect([
      isAdcSigninLogin({ tokens: ["gcloud", "auth", "application-default", "print-access-token"] }),
      isAdcSigninLogin({ tokens: ["gcloud", "auth", "login"] }),
      isAdcSigninLogin({
        tokens: ["slopweaver", "hand", "post", "--literal", "gcloud auth application-default login"],
      }),
      isAdcSigninLogin({ tokens: [] }),
    ]).toEqual([false, false, false, false]);
  });
});

describe("classifyAdcSigninCommand", () => {
  it("refuses the sign-in with the four-line refusal naming the verb and its own hatch", () => {
    const verdict = judge({ command: "gcloud auth application-default login" });
    expect(verdict.blocked).toBe(true);
    const message = (verdict as { message: string }).message;
    expect(message.split("\n")[0]).toContain(
      "gcloud auth application-default login blocked because it opens a browser sign-in",
    );
    expect(message).toContain("slopweaver google adc --row <your row>");
    expect(message).toContain("SLOPWEAVER_ALLOW_ADC_SIGNIN=1 gcloud auth application-default login");
  });

  it("looks through a shell wrapper, a prefix command and a compound line", () => {
    expect([
      judge({ command: "bash -c 'gcloud auth application-default login'" }).blocked,
      judge({ command: "nohup gcloud auth application-default login" }).blocked,
      judge({ command: "cd /tmp && gcloud auth application-default login" }).blocked,
    ]).toEqual([true, true, true]);
  });

  it("catches the sign-in behind a wrapper, a quoted or escaped name, and a glued control character", () => {
    const forms = [
      "timeout 600 gcloud auth application-default login",
      "sudo -u me gcloud auth application-default login",
      "time gcloud auth application-default login",
      "nice -n 10 gcloud auth application-default login",
      "caffeinate -i gcloud auth application-default login",
      "script -q /dev/null gcloud auth application-default login",
      "exec -a x gcloud auth application-default login",
      "command -p gcloud auth application-default login",
      '"gcloud" auth application-default login',
      "\\gcloud auth application-default login",
      "g''cloud auth application-default login",
      "gcloud auth application-default login&",
      "gcloud auth application-default login>/dev/null",
      "{ gcloud auth application-default login; }",
      "! gcloud auth application-default login",
      "if true; then gcloud auth application-default login; fi",
      "true&gcloud auth application-default login",
      "echo waiting & gcloud auth application-default login",
      "$'gcloud' auth application-default login",
      "gcloud auth application-default $'login'",
      "gtimeout 600 gcloud auth application-default login",
      "arch -arm64 gcloud auth application-default login",
      "stdbuf -o0 gcloud auth application-default login",
      "unbuffer gcloud auth application-default login",
      "builtin exec gcloud auth application-default login",
      "if false; then :; elif gcloud auth application-default login; then :; fi",
      "gcloud auth login --update-adc",
      // A `-c` word followed by its `$0`: the quoted word is the whole payload, never one quoted program name.
      "sh -c 'gcloud auth application-default login' sh",
      "bash -c 'gcloud auth application-default login' _",
      "bash -lc 'gcloud auth application-default login' --",
      "zsh -c 'gcloud auth application-default login' zsh",
      'bash -c "gcloud auth application-default login" x',
      "sh -c 'timeout 600 gcloud auth application-default login' sh",
      "bash -c 'gcloud auth '\"application-default login\"",
      "sh -c gcloud\\ auth\\ application-default\\ login",
      // An option between `-c` and the script, and an ANSI-C quoted script: the r2 review's three spellings.
      "sh -c -- 'gcloud auth application-default login'",
      "bash -c -x 'gcloud auth application-default login' sh",
      "bash -c $'gcloud auth application-default login'",
      // Its double-quoted twin, the r3 review's: `$"…"` is the locale quote, the quoted text itself.
      'bash -c $"gcloud auth application-default login"',
      'sh -c $"gcloud auth application-default login" sh',
      "bash -c 'bash -c $\"gcloud auth application-default login\"'",
      "CLOUDSDK_CONFIG='/Users/x/My Config' gcloud auth application-default login",
      // A `$'…'` escape bash decodes, at top level, as a whole script, and as half of a word glued to a quoted run.
      "$'\\x67cloud' auth application-default login",
      "bash -c $'\\x67cloud auth application-default login'",
      "bash -c 'gc'$'\\x6coud auth application-default login'",
      // A `$'…'` assignment whose `\'` is not its close: the command after it is still read as the command.
      "x=$'\\'' gcloud auth application-default login",
    ];
    expect(forms.filter((command) => !judge({ command }).blocked)).toEqual([]);
  });

  it("reads a backslash inside single quotes as itself, so a different program name never becomes gcloud", () => {
    expect(judge({ command: "'g\\cloud' auth application-default login" }).blocked).toBe(false);
  });

  it("passes a line whose wrapper runs some OTHER program that merely names the sign-in", () => {
    const lines = [
      "time grep -rn 'gcloud auth application-default login' src",
      "! grep -rq 'gcloud auth application-default login' src",
      "timeout 30 grep gcloud auth application-default login file",
      "nice git commit -m 'a seat never runs gcloud auth application-default login'",
      "- a seat never runs gcloud auth application-default login itself",
      "git commit -m 'refuse gcloud auth application-default login' 2>&1",
      "gcloud auth application-default print-access-token",
      "gcloud auth login",
    ];
    expect(lines.filter((command) => judge({ command }).blocked)).toEqual([]);
  });

  it("opens only on its own hatch, ambient or inline on that segment", () => {
    expect([
      judge({ command: "gcloud auth application-default login", env: { SLOPWEAVER_ALLOW_ADC_SIGNIN: "1" } }).blocked,
      judge({ command: "SLOPWEAVER_ALLOW_ADC_SIGNIN=1 gcloud auth application-default login" }).blocked,
      judge({ command: "gcloud auth application-default login", env: { SLOPWEAVER_ALLOW_RAW: "1" } }).blocked,
    ]).toEqual([false, false, true]);
  });

  it("passes the chair's own hand post line carrying the command as its literal", () => {
    const command =
      "slopweaver hand post --id adc-signin-r --what 'Sign in' --literal 'gcloud auth application-default login' --row r";
    expect(judge({ command }).blocked).toBe(false);
  });
});

describe("evaluateHookPayload", () => {
  const payload = { tool_input: { command: "gcloud auth application-default login" }, tool_name: "Bash" };

  it("still refuses the sign-in when the raw break-glass is set", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: true,
      env: {},
      payload,
    });
    expect(decision.block).toBe(true);
  });

  it("lets a print-access-token read through on the raw break-glass, as before", () => {
    const read = { tool_input: { command: "gcloud auth application-default print-access-token" }, tool_name: "Bash" };
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: true,
      env: {},
      payload: read,
    });
    expect(decision.block).toBe(false);
  });
});
