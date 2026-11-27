/*
 * Which worker a prepared launch starts: the vendor picks the arm, a Claude launch carries its routed credential by
 * path, and a Codex launch is refused unless its browser door was judged against this run of the app.
 */
import { describe, expect, it } from "vitest";

import type { AppLaunchSpec } from "../../src/sessionControlProtocol";
import { type SessionPaths, workerLaunchOf } from "../../src/workerLaunchOf";

const PATHS: SessionPaths = {
  claude: { claudePath: "/app/claude", workerEntry: "/app/claudeAgentWorker.js" },
  codex: { adapterEntry: "/app/codex-acp.js", codexPath: "/app/codex", workerEntry: "/app/codexAcpWorker.js" },
};

/** The transcript id the app minted for a Claude launch; a Codex launch never carries it. */
const TRANSCRIPT = "a0000107-0000-4000-8000-000000000118";

const CODEX: AppLaunchSpec = {
  codexHome: "/h/codex-one",
  directory: "/work/acme",
  judgedInstanceId: "instance-a",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "codex",
};

const CLAUDE: AppLaunchSpec = {
  claudeMdExcludes: ["/work/acme/AGENTS.md"],
  credential: { kind: "store", secureStorageDir: "/h/claude-two" },
  directory: "/work/acme",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "claude",
};

describe("workerLaunchOf", () => {
  it("starts the Codex worker for a Codex launch judged against this run", () => {
    expect(
      workerLaunchOf({
        claudeTranscriptId: TRANSCRIPT,
        instanceId: "instance-a",
        paths: PATHS,
        sessionId: "0b5e",
        spec: CODEX,
      }),
    ).toEqual({
      config: {
        adapterEntry: "/app/codex-acp.js",
        codexHome: "/h/codex-one",
        codexPath: "/app/codex",
        directory: "/work/acme",
        sessionId: "0b5e",
        vendor: "codex",
      },
      kind: "launch",
      workerEntry: "/app/codexAcpWorker.js",
    });
  });

  it("refuses a Codex launch judged against another run of the app", () => {
    expect(
      workerLaunchOf({
        claudeTranscriptId: TRANSCRIPT,
        instanceId: "instance-b",
        paths: PATHS,
        sessionId: "0b5e",
        spec: CODEX,
      }),
    ).toEqual({
      kind: "refused",
      why:
        "the browser door was judged against app instance instance-a, but this is instance-b, " +
        "which may run another Codex binary, so the launch is refused; spawn again",
    });
  });

  it("starts the Claude worker on the packaged binary with the routed credential, whatever the instance", () => {
    expect(
      workerLaunchOf({
        claudeTranscriptId: TRANSCRIPT,
        instanceId: "instance-b",
        paths: PATHS,
        sessionId: "0b5e",
        spec: CLAUDE,
      }),
    ).toEqual({
      config: {
        claudeMdExcludes: ["/work/acme/AGENTS.md"],
        claudePath: "/app/claude",
        credential: { kind: "store", secureStorageDir: "/h/claude-two" },
        directory: "/work/acme",
        sessionId: "0b5e",
        vendor: "claude",
        vendorSessionId: TRANSCRIPT,
      },
      kind: "launch",
      workerEntry: "/app/claudeAgentWorker.js",
    });
  });

  it("continues a Claude transcript the journal recorded under its own id, never a newly minted one", () => {
    const launch = workerLaunchOf({
      claudeTranscriptId: TRANSCRIPT,
      instanceId: "instance-a",
      paths: PATHS,
      resumeVendorSessionId: "recorded-claude",
      sessionId: "0b5e",
      spec: CLAUDE,
    });
    expect(launch).toMatchObject({
      config: { resumeVendorSessionId: "recorded-claude", vendorSessionId: "recorded-claude" },
      kind: "launch",
    });
  });

  it("continues a Codex thread the journal recorded", () => {
    const launch = workerLaunchOf({
      claudeTranscriptId: TRANSCRIPT,
      instanceId: "instance-a",
      paths: PATHS,
      resumeVendorSessionId: "recorded-thread",
      sessionId: "0b5e",
      spec: CODEX,
    });
    expect(launch).toMatchObject({ config: { resumeVendorSessionId: "recorded-thread", vendor: "codex" } });
  });

  // The exact-shape cases above are the witness that a launch naming no state home gives its worker none.
  it("carries a launch's state home onto either vendor's worker", () => {
    const of = ({ spec }: { spec: AppLaunchSpec }) =>
      workerLaunchOf({
        claudeTranscriptId: TRANSCRIPT,
        instanceId: "instance-a",
        paths: PATHS,
        sessionId: "0b5e",
        spec,
      });
    expect(of({ spec: { ...CODEX, stateHome: "/scratch/home" } })).toMatchObject({
      config: { stateHome: "/scratch/home", vendor: "codex" },
    });
    expect(of({ spec: { ...CLAUDE, stateHome: "/scratch/home" } })).toMatchObject({
      config: { stateHome: "/scratch/home", vendor: "claude" },
    });
  });

  it("carries a Claude launch's model, effort and plugin directory", () => {
    const launch = workerLaunchOf({
      claudeTranscriptId: TRANSCRIPT,
      instanceId: "instance-a",
      paths: PATHS,
      sessionId: "0b5e",
      spec: { ...CLAUDE, effort: "max", model: "opus", pluginDir: "/work/acme" },
    });
    expect(launch).toEqual({
      config: {
        claudeMdExcludes: ["/work/acme/AGENTS.md"],
        claudePath: "/app/claude",
        credential: { kind: "store", secureStorageDir: "/h/claude-two" },
        directory: "/work/acme",
        effort: "max",
        model: "opus",
        pluginDir: "/work/acme",
        sessionId: "0b5e",
        vendor: "claude",
        vendorSessionId: TRANSCRIPT,
      },
      kind: "launch",
      workerEntry: "/app/claudeAgentWorker.js",
    });
  });
});
