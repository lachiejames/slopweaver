/**
 * The environment section's renderers, the per-area probe modules `environmentProbes` composes, and the usage
 * line that names `--deep` — each read directly, so a module that stops matching what `doctor` prints fails here.
 */
import { describe, expect, it } from "vitest";

import { DOCTOR_USAGE } from "../../../cli/commands/doctor/usage.js";
import type { EnvironmentProbe } from "../../../environment/facts.js";
import { datadogAgentProbe, zshProfileProbe } from "../../../environment/healthProbes.js";
import { environmentProbes } from "../../../environment/probes.js";
import { environmentSection, verdictLine } from "../../../environment/render.js";
import { dockerProbe } from "../../../environment/runtimeProbes.js";
import { supabaseCliProbe } from "../../../environment/storeProbes.js";
import { cmuxProbe, githubProbe, hostProbe, slopweaverProbe } from "../../../environment/toolProbes.js";
import { HEALTHY_MACHINE } from "../../environmentFacts.js";

const OK_AGENT: EnvironmentProbe = {
  fix: null,
  id: "datadog-agent",
  says: "the Datadog agent is installed",
  scope: "dev-environment",
  verdict: "ok",
  withoutFix: null,
};

const MISSING_GIT: EnvironmentProbe = {
  fix: "install git",
  id: "git",
  says: "git is not on PATH",
  scope: "slopweaver",
  verdict: "fatal",
  withoutFix: "nothing that commits, pushes or reads history can run",
};

describe("environmentSection", () => {
  it("renders one line per probe, and a fix and its cost under a non-ok one", () => {
    expect(environmentSection({ deep: true, probes: [OK_AGENT, MISSING_GIT] })).toEqual([
      "environment (every probe, including gh login, the cmux socket and zsh startup):",
      "  [ok] datadog-agent (developer health, not a Slopweaver requirement) — the Datadog agent is installed",
      "  [FATAL] git — git is not on PATH",
      "      fix: install git",
      "      continuing without it: nothing that commits, pushes or reads history can run",
    ]);
  });

  it("says which probes did not run without --deep", () => {
    expect(environmentSection({ deep: false, probes: [OK_AGENT] })[0]).toBe(
      "environment (free probes only — `doctor --deep` also checks gh login, the cmux socket and zsh startup):",
    );
  });

  it("renders nothing when there are no probes", () => {
    expect(environmentSection({ deep: false, probes: [] })).toEqual([]);
  });
});

describe("verdictLine", () => {
  it("names the one fatal probe", () => {
    expect(verdictLine({ probes: [OK_AGENT, MISSING_GIT] })).toBe(
      "FATAL — Slopweaver cannot run on this machine until git is fixed",
    );
  });

  it("names every fatal probe, in order", () => {
    const missingNode = { ...MISSING_GIT, id: "node" };
    expect(verdictLine({ probes: [missingNode, MISSING_GIT] })).toBe(
      "FATAL — Slopweaver cannot run on this machine until node, git are fixed",
    );
  });

  it("counts warnings, and is a plain ok when every probe is", () => {
    const warning = { ...MISSING_GIT, verdict: "warning" as const };
    expect(verdictLine({ probes: [OK_AGENT, warning] })).toBe("ok — 1 warning(s) above");
    expect(verdictLine({ probes: [OK_AGENT] })).toBe("ok");
  });
});

describe("the per-area probe modules", () => {
  it("are exactly the probes environmentProbes lists under the same ids", () => {
    const facts = HEALTHY_MACHINE;
    const direct = [
      slopweaverProbe({ facts }),
      githubProbe({ facts }),
      cmuxProbe({ facts }),
      hostProbe({ facts, name: "claude" }),
      hostProbe({ facts, name: "codex" }),
      supabaseCliProbe({ facts }),
      dockerProbe({ facts }),
      zshProfileProbe({ facts }),
      datadogAgentProbe({ facts }),
    ];
    const listed = environmentProbes({ facts });
    expect(direct.map((p) => p.id)).toEqual([
      "slopweaver",
      "gh",
      "cmux",
      "claude",
      "codex",
      "supabase-cli",
      "docker",
      "zsh-profile",
      "datadog-agent",
    ]);
    expect(direct.map((p) => listed.find((candidate) => candidate.id === p.id))).toEqual(direct);
  });
});

describe("DOCTOR_USAGE", () => {
  it("names both flags on its usage line", () => {
    expect(DOCTOR_USAGE.split("\n")[0]).toBe("usage: slopweaver doctor [--deep] [--json]");
  });
});
