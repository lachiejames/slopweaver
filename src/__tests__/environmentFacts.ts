/**
 * A healthy machine's environment facts, shared by the environment probe tests: everything on PATH, Node at the
 * pin via proto, every costed probe answered. A test breaks one fact and asserts the one probe it moves.
 */
import type { EnvironmentFacts } from "../environment/facts.js";

/** A machine on which every probe grades ok. */
export const HEALTHY_MACHINE: EnvironmentFacts = {
  ambientSupabase: null,
  corepackBesideNode: null,
  danglingSlopweaver: null,
  datadogAgent: true,
  deep: {
    cmuxSocket: { answered: true },
    ghAuth: "ok",
    zshStartup: { errorAt: null, timedOut: false, zshReportedError: false },
  },
  dockerApp: true,
  githubFallback: null,
  installedSupabaseCli: "2.109.1",
  localBinSlopweaver: null,
  managersOnPath: ["proto"],
  nodeManager: "proto",
  onPath: {
    bash: "/bin/bash",
    claude: "/u/.local/bin/claude",
    cmux: "/opt/homebrew/bin/cmux",
    codex: "/opt/homebrew/bin/codex",
    corepack: "/u/.proto/shims/corepack",
    "datadog-agent": null,
    docker: "/usr/local/bin/docker",
    gh: "/opt/homebrew/bin/gh",
    git: "/usr/bin/git",
    node: "/u/.proto/shims/node",
    slopweaver: "/u/.local/bin/slopweaver",
    yarn: "/u/.proto/shims/yarn",
  },
  pins: { engineFloor: ">=24.11", nvmrc: "24.21.0", supabaseCli: "2.109.1" },
  runningNode: { execPath: "/u/.proto/tools/node/24.21.0/bin/node", version: "v24.21.0" },
  zshrcDefinesSlopweaver: false,
};
