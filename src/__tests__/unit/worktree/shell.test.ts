/**
 * {@link sharedDepsRoot} — which plugin-data directory the shared dependency tree is resolved under, read in
 * the order the host's two variables take precedence over the conventional directory.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SUPERVISOR_GRACE_SECONDS,
  SUPERVISOR_SCRIPT,
  sharedDepsRoot,
  supervisorArgv,
} from "../../../worktree/shell.js";

describe("sharedDepsRoot", () => {
  const originalPluginData = process.env["PLUGIN_DATA"];
  const originalClaudePluginData = process.env["CLAUDE_PLUGIN_DATA"];

  afterEach(() => {
    if (originalPluginData === undefined) {
      delete process.env["PLUGIN_DATA"];
    } else {
      process.env["PLUGIN_DATA"] = originalPluginData;
    }
    if (originalClaudePluginData === undefined) {
      delete process.env["CLAUDE_PLUGIN_DATA"];
    } else {
      process.env["CLAUDE_PLUGIN_DATA"] = originalClaudePluginData;
    }
  });

  it("resolves under PLUGIN_DATA when it is set, ahead of CLAUDE_PLUGIN_DATA", () => {
    process.env["PLUGIN_DATA"] = "/plugin-data";
    process.env["CLAUDE_PLUGIN_DATA"] = "/claude-plugin-data";

    expect(sharedDepsRoot()).toBe("/plugin-data/cli-deps/node_modules");
  });

  it("resolves under CLAUDE_PLUGIN_DATA when PLUGIN_DATA is unset", () => {
    delete process.env["PLUGIN_DATA"];
    process.env["CLAUDE_PLUGIN_DATA"] = "/claude-plugin-data";

    expect(sharedDepsRoot()).toBe("/claude-plugin-data/cli-deps/node_modules");
  });

  it("keeps a PLUGIN_DATA that is set but empty, resolving relative to it", () => {
    process.env["PLUGIN_DATA"] = "";
    process.env["CLAUDE_PLUGIN_DATA"] = "/claude-plugin-data";

    expect(sharedDepsRoot()).toBe("cli-deps/node_modules");
  });

  it("resolves under the conventional plugin-data directory when neither variable is set", () => {
    delete process.env["PLUGIN_DATA"];
    delete process.env["CLAUDE_PLUGIN_DATA"];

    expect(sharedDepsRoot()).toBe(
      join(homedir(), ".claude", "plugins", "data", "slopweaver", "cli-deps", "node_modules"),
    );
  });
});

describe("SUPERVISOR_SCRIPT", () => {
  it("runs its job in a process group of its own with the fork's stderr kept off the job's, TERMs it with a grace before SIGKILL on a signal, and SIGKILLs it on exit", () => {
    expect(SUPERVISOR_SCRIPT.split("\n")).toEqual([
      "grace=$1",
      "shift",
      "reap() {",
      '  if [ -z "$!" ]; then return; fi',
      '  if [ "$1" = term ]; then',
      '    kill -TERM -- "-$!" 2>/dev/null',
      '    kill -CONT -- "-$!" 2>/dev/null',
      "    tries=0",
      '    while kill -0 -- "-$!" 2>/dev/null && [ "$tries" -lt $((grace * 100)) ]; do sleep 0.01; tries=$((tries + 1)); done',
      "  fi",
      '  kill -KILL -- "-$!" 2>/dev/null',
      '  wait "$!" 2>/dev/null',
      "  tries=0",
      '  while kill -0 -- "-$!" 2>/dev/null && [ "$tries" -lt 500 ]; do sleep 0.01; tries=$((tries + 1)); done',
      "}",
      "trap 'reap term; exit 143' TERM",
      "trap 'reap term; exit 130' INT",
      "trap 'reap term; exit 129' HUP",
      "exec 3>&2 2>/dev/null || exec 3>/dev/null 2>/dev/null",
      "set -m",
      '"$@" 2>&3 3>&- &',
      "exec 2>&3 3>&-",
      "set +m",
      'wait "$!" 2>/dev/null',
      "status=$?",
      "reap kill",
      'exit "$status"',
    ]);
  });

  it("hands the script its run name, then the grace, then the job, in that order", () => {
    expect(supervisorArgv({ args: ["build"], graceSeconds: 7, name: "supervise-x", program: "yarn" })).toEqual([
      "-c",
      SUPERVISOR_SCRIPT,
      "supervise-x",
      "7",
      "yarn",
      "build",
    ]);
  });

  it("gives a signalled job's group fifteen seconds, over the compiler owner's worst case of a five-second grace and a five-second settle", () => {
    expect(SUPERVISOR_GRACE_SECONDS).toBe(15);
  });

  it("installs every trap before the job starts, so no signal finds the shell undefended with a job running", () => {
    const lines = SUPERVISOR_SCRIPT.split("\n");
    const launch = lines.indexOf('"$@" 2>&3 3>&- &');
    const traps = lines.flatMap((line, index) => (line.startsWith("trap ") ? [index] : []));
    expect(traps.length).toBe(3);
    expect(traps.filter((index) => index > launch)).toEqual([]);
  });
});
