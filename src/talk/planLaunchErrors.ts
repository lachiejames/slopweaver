/**
 * Why this machine cannot launch a plan-funded Talk call — the plan launch's own typed union, one per bounded
 * module (`.claude/rules/error-handling.md`). Every variant stops the mint before an app-server starts: a server
 * the launch cannot name is a server that would start inside the owner's call.
 */

/** The vendored Codex CLI could not be resolved from the environment. */
export interface CliUnresolvedError {
  readonly code: "CLI_UNRESOLVED";
  readonly message: string;
}

/** The resolved Codex CLI is not on disk. */
export interface CliAbsentError {
  readonly code: "CLI_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** `codex mcp list --json` could not run, or ran and failed. */
export interface McpListFailedError {
  readonly code: "MCP_LIST_FAILED";
  readonly message: string;
}

/** `codex mcp list --json` printed something that is not a list of servers. */
export interface McpListUnreadableError {
  readonly code: "MCP_LIST_UNREADABLE";
  readonly message: string;
}

/** A configured MCP server whose name cannot be written into the stub's config key. */
export interface McpServerUnstubbableError {
  readonly code: "MCP_SERVER_UNSTUBBABLE";
  readonly message: string;
  readonly name: unknown;
}

/** Every way the plan launch fails closed. */
export type PlanLaunchError =
  CliUnresolvedError | CliAbsentError | McpListFailedError | McpListUnreadableError | McpServerUnstubbableError;

/** The factories for {@link PlanLaunchError}. */
export const PlanLaunchErrors = {
  cliAbsent: ({ path }: { path: string }): CliAbsentError => ({
    code: "CLI_ABSENT",
    message: `the vendored Codex CLI is not at ${path} — run yarn install`,
    path,
  }),
  cliUnresolved: ({ reason }: { reason: string }): CliUnresolvedError => ({ code: "CLI_UNRESOLVED", message: reason }),
  mcpListExited: ({ status, stderr }: { status: number | null; stderr: string }): McpListFailedError => ({
    code: "MCP_LIST_FAILED",
    message: `codex mcp list --json exited ${String(status)}: ${stderr.trim().slice(0, 400)}`,
  }),
  mcpListNotAList: (): McpListUnreadableError => ({
    code: "MCP_LIST_UNREADABLE",
    message: "codex mcp list --json printed something other than a list of servers",
  }),
  mcpListNotJson: ({ cause }: { cause: unknown }): McpListUnreadableError => ({
    code: "MCP_LIST_UNREADABLE",
    message: `codex mcp list --json printed something that is not JSON: ${String(cause)}`,
  }),
  mcpListUnrunnable: ({ cause }: { cause: Error }): McpListFailedError => ({
    code: "MCP_LIST_FAILED",
    message: `codex mcp list --json could not run: ${cause.message}`,
  }),
  mcpServerUnstubbable: ({ name }: { name: unknown }): McpServerUnstubbableError => ({
    code: "MCP_SERVER_UNSTUBBABLE",
    message: `codex mcp list --json named a server this mint cannot stub: ${JSON.stringify(name)}`,
    name,
  }),
} as const;
