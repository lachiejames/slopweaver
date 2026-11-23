/**
 * The plan launch fails CLOSED: no binary, an unreadable MCP list, or a server it cannot stub each stop the mint
 * before any app-server starts. The reader is a plain fake function passed in, never a mock.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { planLaunchFacts, type ReadMcpList, readMcpListLive } from "../../../talk/planLaunch.js";
import { PlanLaunchErrors } from "../../../talk/planLaunchErrors.js";

const BINARY = "/vendored/codex";
const ENV = { SLOPWEAVER_CODEX_APP_SERVER: BINARY };
const ROUTED_HOME = "/stores/codex-one";

describe("planLaunchFacts", () => {
  it("resolves the pinned binary, the routed home's MCP servers, and the credentials to strip", () => {
    const asked: { codexHome: string; executable: string }[] = [];
    const readMcpList: ReadMcpList = ({ codexHome, executable }) => {
      asked.push({ codexHome, executable });
      return ok(JSON.stringify([{ name: "trajectory" }]));
    };
    expect(unwrap(planLaunchFacts({ codexHome: ROUTED_HOME, env: ENV, readMcpList }))).toEqual({
      executable: BINARY,
      mcpServers: ["trajectory"],
      unsetEnv: ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"],
    });
    // The list is read off the ROUTED home, the one the child runs on — never the ambient one.
    expect(asked).toEqual([{ codexHome: ROUTED_HOME, executable: BINARY }]);
  });

  it("stops when the MCP list cannot be read", () => {
    const readMcpList: ReadMcpList = () => err(PlanLaunchErrors.mcpListExited({ status: 1, stderr: "boom\n" }));
    expect(unwrapErr(planLaunchFacts({ codexHome: ROUTED_HOME, env: ENV, readMcpList }))).toEqual({
      code: "MCP_LIST_FAILED",
      message: "codex mcp list --json exited 1: boom",
    });
  });

  it("stops when a listed server cannot be stubbed", () => {
    const readMcpList: ReadMcpList = () => ok(JSON.stringify([{ name: "x=y" }]));
    expect(unwrapErr(planLaunchFacts({ codexHome: ROUTED_HOME, env: ENV, readMcpList }))).toEqual({
      code: "MCP_SERVER_UNSTUBBABLE",
      message: 'codex mcp list --json named a server this mint cannot stub: "x=y"',
      name: "x=y",
    });
  });
});

describe("readMcpListLive", () => {
  it("names the missing binary rather than running anything", () => {
    expect(unwrapErr(readMcpListLive({ codexHome: ROUTED_HOME, executable: "/nowhere/codex" }))).toEqual({
      code: "CLI_ABSENT",
      message: "the vendored Codex CLI is not at /nowhere/codex — run yarn install",
      path: "/nowhere/codex",
    });
  });
});
