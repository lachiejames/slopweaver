import { describe, expect, it } from "vitest";
import { type ConnectDeps, parseConnectArgs, runConnectWithDeps } from "../../../../../cli/commands/connect/run.js";
import type { ConnectCheckReport } from "../../../../../connect/types.js";
import { finaliseReport } from "../../../../../connect/types.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

interface Captured {
  readonly deps: ConnectDeps;
  readonly out: string[];
  readonly errors: string[];
  readonly calls: string[];
}

const readyReport = ({ source }: { source: ConnectCheckReport["source"] }): ConnectCheckReport =>
  finaliseReport({ capabilities: [{ detail: "ok", id: "auth", status: "ok" }], source, tokenPresent: true });

const notReadyReport = ({ source }: { source: ConnectCheckReport["source"] }): ConnectCheckReport =>
  finaliseReport({
    capabilities: [{ detail: "gap", id: "scope:read:org", status: "missing" }],
    source,
    tokenPresent: true,
  });

/** A full ConnectDeps fake (plain functions). `slackReport`/`githubReport` seed the dispatched report. */
function fakeDeps({
  slackReport = readyReport({ source: "slack" }),
  githubReport = readyReport({ source: "github" }),
  outlookReport = readyReport({ source: "outlook" }),
  orgResult = ok("acme"),
  botToken = "xoxb",
}: {
  slackReport?: ConnectCheckReport;
  githubReport?: ConnectCheckReport;
  outlookReport?: ConnectCheckReport;
  orgResult?: Result<string>;
  /** `null` means "no bot token configured" — `undefined` would silently take the default. */
  botToken?: string | null;
}): Captured {
  const out: string[] = [];
  const errors: string[] = [];
  const calls: string[] = [];
  const deps: ConnectDeps = {
    connectDatadog: async ({ home = "default-home" }) => {
      calls.push(`datadog:${home}`);
      return readyReport({ source: "datadog" });
    },
    connectGithub: async ({ org, token = "none" }) => {
      calls.push(`github:${org}:${token}`);
      return githubReport;
    },
    connectGmail: async ({ home = "default-home" }) => {
      calls.push(`gmail:${home}`);
      return readyReport({ source: "gmail" });
    },
    connectLinear: async () => {
      calls.push("linear");
      return readyReport({ source: "linear" });
    },
    connectNotion: async () => {
      calls.push("notion");
      return readyReport({ source: "notion" });
    },
    connectOutlook: async ({ home = "default-home" }) => {
      calls.push(`outlook:${home}`);
      return outlookReport;
    },
    connectSlack: async ({ kind, writeToken = "no-bot-token" }) => {
      calls.push(`slack:${kind}:${writeToken}`);
      return slackReport;
    },
    githubToken: ({ home = "default-home" }) => `gh-tok@${home}`,
    linearToken: () => "lin-tok",
    logger: {
      error: ({ msg }) => {
        errors.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    notionToken: () => "notion-tok",
    resolveGithubOrg: () => orgResult,
    slackTokens: () => ({ kind: "user", read: "xoxp", ...(botToken === null ? {} : { write: botToken }) }),
  };
  return { calls, deps, errors, out };
}

const argv = ({ rest }: { rest: readonly string[] }): readonly string[] => ["node", "cli", "connect", ...rest];

describe("parseConnectArgs", () => {
  it("parses a source + flags", () => {
    expect(unwrap(parseConnectArgs({ rest: ["slack", "--check", "--json"] }))).toEqual({ json: true, source: "slack" });
  });

  it("parses outlook as a preflight target", () => {
    expect(unwrap(parseConnectArgs({ rest: ["outlook", "--check"] }))).toEqual({ json: false, source: "outlook" });
  });

  it("rejects a missing source", () => {
    expect(unwrapErr(parseConnectArgs({ rest: ["--check"] }))[0]).toContain("missing source");
  });

  it("rejects an unknown source", () => {
    expect(unwrapErr(parseConnectArgs({ rest: ["jira"] }))[0]).toContain("unknown source: jira");
  });
});

describe("runConnectWithDeps", () => {
  it("dispatches to Slack and emits value-free JSON, exit 0 when ready", async () => {
    const cap = fakeDeps({});
    const code = await runConnectWithDeps({ argv: argv({ rest: ["slack", "--check", "--json"] }), deps: cap.deps });
    expect(code).toBe(0);
    // The BOT token is handed through alongside the read token: the write preflight probes it on its own,
    // never inferring "sends are possible" from the xoxp that won the read chain.
    expect(cap.calls).toEqual(["slack:user:xoxb"]);
    expect(JSON.parse(cap.out[0]!).source).toBe("slack");
  });

  it("passes NO write token through when only a read token is configured", async () => {
    const cap = fakeDeps({ botToken: null });

    await runConnectWithDeps({ argv: argv({ rest: ["slack", "--check"] }), deps: cap.deps });

    expect(cap.calls).toEqual(["slack:user:no-bot-token"]);
  });

  it("exits 3 (a diagnostic finding) when the connection is not ready", async () => {
    const cap = fakeDeps({ slackReport: notReadyReport({ source: "slack" }) });
    const code = await runConnectWithDeps({ argv: argv({ rest: ["slack", "--check", "--json"] }), deps: cap.deps });
    expect(code).toBe(3);
  });

  it("resolves the org then probes GitHub with the resolved token", async () => {
    const cap = fakeDeps({});
    await runConnectWithDeps({ argv: argv({ rest: ["github", "--check", "--repo", "acme/app"] }), deps: cap.deps });
    expect(cap.calls).toEqual(["github:acme:gh-tok@default-home"]);
  });

  it("resolves the GitHub token from the --home it was given, never the ambient one", async () => {
    const cap = fakeDeps({});
    await runConnectWithDeps({
      argv: argv({ rest: ["github", "--check", "--repo", "acme/app", "--home", "/homes/b"] }),
      deps: cap.deps,
    });
    expect(cap.calls).toEqual(["github:acme:gh-tok@/homes/b"]);
  });

  it("returns a not-ready report (no probe) when the org cannot be resolved", async () => {
    const cap = fakeDeps({ orgResult: err(["no origin remote"]) });
    const code = await runConnectWithDeps({ argv: argv({ rest: ["github", "--check", "--json"] }), deps: cap.deps });
    expect(code).toBe(3);
    expect(cap.calls).toEqual([]);
  });

  it("dispatches Datadog with the named home and no token argument", async () => {
    const cap = fakeDeps({});
    const code = await runConnectWithDeps({
      argv: argv({ rest: ["datadog", "--check", "--json", "--home", "/h"] }),
      deps: cap.deps,
    });
    expect(code).toBe(0);
    expect(cap.calls).toEqual(["datadog:/h"]);
    expect(JSON.parse(cap.out[0]!).source).toBe("datadog");
  });

  it("dispatches Outlook only to its own preflight, with the named home", async () => {
    const cap = fakeDeps({});
    const code = await runConnectWithDeps({
      argv: argv({ rest: ["outlook", "--check", "--json", "--home", "/h"] }),
      deps: cap.deps,
    });
    expect(code).toBe(0);
    expect(cap.calls).toEqual(["outlook:/h"]);
    expect(JSON.parse(cap.out[0]!).source).toBe("outlook");
  });

  it("exits 3 when the Outlook preflight finds a hard gap", async () => {
    const cap = fakeDeps({ outlookReport: notReadyReport({ source: "outlook" }) });
    const code = await runConnectWithDeps({ argv: argv({ rest: ["outlook", "--check"] }), deps: cap.deps });
    expect(code).toBe(3);
  });

  it("rejects an unknown source I/O-free (no probe dispatched)", async () => {
    const cap = fakeDeps({});
    const code = await runConnectWithDeps({ argv: argv({ rest: ["jira", "--check"] }), deps: cap.deps });
    expect(code).toBe(2);
    expect(cap.calls).toEqual([]);
  });
});
