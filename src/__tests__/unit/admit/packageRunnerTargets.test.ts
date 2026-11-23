import { describe, expect, it } from "vitest";

import { packageName, runnerCallPayload, runnerTargets } from "../../../admit/packageRunnerTargets.js";

/** The candidate package names a runner command yields, in order. */
function names({ command }: { command: string }): readonly string[] {
  return runnerTargets({ words: command.split(" ") }).map((target) => target.name);
}

describe("packageName", () => {
  it("drops a version from a scoped or bare spec, and lowercases", () => {
    expect(packageName({ text: "@playwright/cli@0.1.2" })).toBe("@playwright/cli");
    expect(packageName({ text: "Playwright@latest" })).toBe("playwright");
    expect(packageName({ text: "playwright" })).toBe("playwright");
  });
});

describe("runnerTargets", () => {
  it("finds the bin past a direct runner's known options", () => {
    expect(names({ command: "npx -y playwright open" })).toEqual(["playwright"]);
    expect(names({ command: "npx -p @playwright/cli playwright-cli open" })).toEqual(["playwright-cli"]);
  });

  it("reads an unknown option both ways, so a bin behind its value is a candidate", () => {
    expect(names({ command: "npx -w web playwright open" })).toEqual(["web", "playwright"]);
    expect(names({ command: "npx --cache /tmp/c -y playwright codegen" })).toEqual(["/tmp/c", "playwright"]);
  });

  it("never reads a known flag as taking a value, nor an attached --option=value", () => {
    expect(names({ command: "yarn --silent add @playwright/mcp" })).toEqual(["add"]);
    expect(names({ command: "npx --workspace=web playwright open" })).toEqual(["playwright"]);
  });

  it("reads a manager's bin by name, or past its run subcommand, but never npm's own subcommand", () => {
    expect(names({ command: "yarn playwright test" })).toEqual(["playwright"]);
    expect(names({ command: "pnpm --filter web dlx @playwright/cli open" })).toEqual(["@playwright/cli"]);
    expect(names({ command: "npm install playwright" })).toEqual([]);
    expect(names({ command: "npm exec playwright -- open" })).toEqual(["playwright"]);
  });

  it("names nothing for a program that is no runner", () => {
    expect(names({ command: "git status" })).toEqual([]);
  });
});

describe("runnerCallPayload", () => {
  it("reads the command string npx, npm exec or pnpm dlx hands a shell", () => {
    expect(runnerCallPayload({ words: ["npx", "--yes", "-c", "playwright open x"] })).toBe("playwright open x");
    expect(runnerCallPayload({ words: ["npx", "--call=playwright open x"] })).toBe("playwright open x");
    expect(runnerCallPayload({ words: ["npm", "exec", "--call", "playwright open x"] })).toBe("playwright open x");
    expect(runnerCallPayload({ words: ["pnpm", "dlx", "-c", "playwright open x"] })).toBe("playwright open x");
  });

  it("reads nothing past --, from a manager with no call subcommand, or from a non-runner", () => {
    expect(runnerCallPayload({ words: ["npx", "eslint", "--", "-c", "x"] })).toBe(undefined);
    expect(runnerCallPayload({ words: ["npm", "run", "-c", "x"] })).toBe(undefined);
    expect(runnerCallPayload({ words: ["git", "-c", "x"] })).toBe(undefined);
  });

  it("reads no -c past the bin, which is the bin's own option", () => {
    expect(runnerCallPayload({ words: ["yarn", "dlx", "prettier", "-c", "chromium"] })).toBe(undefined);
    expect(runnerCallPayload({ words: ["npx", "-y", "prettier", "-c", "chromium"] })).toBe(undefined);
    expect(runnerCallPayload({ words: ["npx", "-p", "prettier", "prettier", "-c", "x"] })).toBe(undefined);
  });

  it("reads a -c past a known valued option's value, or past an unknown option's possible value", () => {
    expect(runnerCallPayload({ words: ["npx", "-p", "playwright", "-c", "playwright open x"] })).toBe(
      "playwright open x",
    );
    expect(runnerCallPayload({ words: ["npx", "-w", "web", "-c", "playwright open x"] })).toBe("playwright open x");
  });
});
