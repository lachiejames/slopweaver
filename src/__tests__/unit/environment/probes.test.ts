/**
 * The environment probes as a pure grading: facts in, exact probes out. Every case starts from a healthy
 * machine and breaks one thing, so each assertion names the one probe that thing should move.
 */
import { describe, expect, it } from "vitest";

import type { EnvironmentFacts, EnvironmentProbe } from "../../../environment/facts.js";
import { managerOfNodePath, zshErrorLocation, zshReportedError, zshStartupFiles } from "../../../environment/gather.js";
import { environmentProbes, probeTally } from "../../../environment/probes.js";
import { meetsFloor, parseVersionFloor } from "../../../environment/runtimeProbes.js";
import { HEALTHY_MACHINE as HEALTHY } from "../../environmentFacts.js";

/** The healthy machine with some facts replaced. */
function machine(over: Partial<EnvironmentFacts>): EnvironmentFacts {
  return { ...HEALTHY, ...over };
}

/** The healthy machine with some binaries taken off PATH. */
function without(...names: (keyof EnvironmentFacts["onPath"])[]): EnvironmentFacts["onPath"] {
  const onPath = { ...HEALTHY.onPath };
  for (const name of names) {
    onPath[name] = null;
  }
  return onPath;
}

/** The one probe with this id. */
function probe({ facts, id }: { facts: EnvironmentFacts; id: string }): EnvironmentProbe {
  return environmentProbes({ facts }).find((candidate) => candidate.id === id)!;
}

describe("environmentProbes on a healthy machine", () => {
  it("grades every probe ok, in fix order, never omitting one", () => {
    const probes = environmentProbes({ facts: HEALTHY });
    expect(probes.map((p) => `${p.id}:${p.verdict}`)).toEqual([
      "node:ok",
      "yarn:ok",
      "git:ok",
      "bash:ok",
      "docker:ok",
      "node-manager:ok",
      "slopweaver:ok",
      "gh:ok",
      "cmux:ok",
      "claude:ok",
      "codex:ok",
      "supabase-cli:ok",
      "zsh-profile:ok",
      "datadog-agent:ok",
    ]);
    expect(probeTally({ probes })).toEqual({ fatal: 0, unchecked: 0, warnings: 0 });
  });
});

describe("the fatal probes", () => {
  it("node below the floor is fatal and names the manager and the pin", () => {
    const facts = machine({ runningNode: { execPath: "/u/.nvm/node", version: "v22.3.0" }, nodeManager: "nvm" });
    expect(probe({ facts, id: "node" })).toEqual({
      fix: "`nvm install 24.21.0` (.nvmrc pins 24.21.0)",
      id: "node",
      says: "Node v22.3.0 via nvm is below the >=24.11 this checkout requires",
      scope: "slopweaver",
      verdict: "fatal",
      withoutFix:
        "Slopweaver may start, but code written for the pinned Node can fail in ways that name nothing useful",
    });
  });

  it("node missing from PATH is fatal", () => {
    expect(probe({ facts: machine({ onPath: without("node") }), id: "node" }).verdict).toBe("fatal");
  });

  it("an unparseable floor is unchecked, never a false miss", () => {
    const facts = machine({ pins: { engineFloor: "^24 || ^26", nvmrc: null, supabaseCli: null } });
    expect(probe({ facts, id: "node" }).verdict).toBe("unchecked");
  });

  it("no yarn and no corepack on PATH is fatal, pointing at the corepack beside node when there is one", () => {
    const facts = machine({ corepackBesideNode: "/u/node/bin/corepack", onPath: without("yarn", "corepack") });
    const yarn = probe({ facts, id: "yarn" });
    expect(yarn.verdict).toBe("fatal");
    expect(yarn.fix).toBe(
      "`/u/node/bin/corepack enable` — your Node ships corepack, but your version manager does not put it on PATH",
    );
  });

  it("corepack alone on PATH is enough for yarn", () => {
    expect(probe({ facts: machine({ onPath: without("yarn") }), id: "yarn" }).verdict).toBe("ok");
  });

  it("git missing is fatal, and the tally counts it", () => {
    const probes = environmentProbes({ facts: machine({ onPath: without("git") }) });
    expect(probes.find((p) => p.id === "git")!.verdict).toBe("fatal");
    expect(probeTally({ probes })).toEqual({ fatal: 1, unchecked: 0, warnings: 0 });
  });

  it("no Docker at all is fatal, because the local store runs in it", () => {
    const facts = machine({ dockerApp: false, onPath: without("docker") });
    expect(probe({ facts, id: "docker" })).toEqual({
      fix: "install Docker Desktop (https://www.docker.com/products/docker-desktop)",
      id: "docker",
      says: "Docker is not installed — neither the Docker Desktop app nor a `docker` CLI",
      scope: "slopweaver",
      verdict: "fatal",
      withoutFix:
        "connecting and pulling sources still work, but there is no local store: `supabase start` needs Docker, so `store` reads and the bot's history leg cannot run",
    });
  });

  it("Docker Desktop installed names the store it runs", () => {
    expect(probe({ facts: HEALTHY, id: "docker" }).says).toBe(
      "Docker Desktop is installed — the local store runs in it",
    );
  });

  it("a docker CLI without the app is accepted, and says the runtime behind it was not checked", () => {
    const docker = probe({ facts: machine({ dockerApp: false }), id: "docker" });
    expect(`${docker.scope}:${docker.verdict}`).toBe("slopweaver:ok");
    expect(docker.says).toBe(
      "no Docker Desktop app, but a `docker` CLI at /usr/local/bin/docker — whether a runtime serves it was not checked",
    );
  });
});

describe("the warning probes", () => {
  it("a dangling slopweaver link names the link and its target", () => {
    const facts = machine({
      danglingSlopweaver: { link: "/u/.local/bin/slopweaver", target: "/gone/bin/slopweaver" },
      onPath: without("slopweaver"),
    });
    const slopweaver = probe({ facts, id: "slopweaver" });
    expect(slopweaver.verdict).toBe("warning");
    expect(slopweaver.says).toBe(
      "/u/.local/bin/slopweaver is a broken link — it points at /gone/bin/slopweaver, which is not there.",
    );
  });

  it("a zsh function covering a missing slopweaver is named as interactive-only", () => {
    const facts = machine({ onPath: without("slopweaver"), zshrcDefinesSlopweaver: true });
    expect(probe({ facts, id: "slopweaver" }).says).toBe(
      "`slopweaver` is not on PATH. Your ~/.zshrc defines a `slopweaver` function, which covers an interactive terminal only — hooks, `timeout` and spawned sessions never see a shell function.",
    );
  });

  it("a failed gh login with no fallback warns and names both fallbacks", () => {
    const facts = machine({ deep: { ...HEALTHY.deep!, ghAuth: "failed" } });
    expect(probe({ facts, id: "gh" })).toEqual({
      fix: "`gh auth login`",
      id: "gh",
      says: "gh at /opt/homebrew/bin/gh is not logged in, and neither fallback is set — GITHUB_TOKEN/GH_TOKEN in the environment, or `slopweaver secrets set github-token`",
      scope: "slopweaver",
      verdict: "warning",
      withoutFix: "GitHub reads are unauthenticated: public repositories only, at a much lower rate limit",
    });
  });

  it("a failed gh login is ok when the secrets-file fallback is ready", () => {
    const facts = machine({ deep: { ...HEALTHY.deep!, ghAuth: "failed" }, githubFallback: "secrets-file" });
    expect(probe({ facts, id: "gh" }).verdict).toBe("ok");
  });

  it("two node managers on PATH warn", () => {
    const facts = machine({ managersOnPath: ["nvm", "proto"], nodeManager: "nvm" });
    expect(probe({ facts, id: "node-manager" }).says).toBe(
      "2 Node managers are on PATH (nvm, proto) — nvm serves `node` today",
    );
  });

  it("cmux, claude and codex missing each warn, never fatal", () => {
    const probes = environmentProbes({ facts: machine({ onPath: without("cmux", "claude", "codex") }) });
    expect(probes.filter((p) => p.verdict !== "ok").map((p) => `${p.id}:${p.verdict}`)).toEqual([
      "cmux:warning",
      "claude:warning",
      "codex:warning",
    ]);
  });

  it("a cmux socket that does not answer warns with what was heard", () => {
    const facts = machine({ deep: { ...HEALTHY.deep!, cmuxSocket: { answered: false, detail: "ECONNREFUSED" } } });
    expect(probe({ facts, id: "cmux" }).says).toBe(
      "cmux at /opt/homebrew/bin/cmux, but its control socket did not answer (ECONNREFUSED)",
    );
  });
});

describe("the pinned Supabase CLI", () => {
  const NO_LOCAL_STORE =
    "the local store cannot start, so the console draws nothing and every `store` verb refuses until a store is reachable";

  it("the pinned Supabase CLI installed at its pin is ok", () => {
    expect(probe({ facts: HEALTHY, id: "supabase-cli" })).toEqual({
      fix: null,
      id: "supabase-cli",
      says: "the Supabase CLI is pinned and installed at 2.109.1",
      scope: "slopweaver",
      verdict: "ok",
      withoutFix: null,
    });
  });

  it("a pinned CLI that is not installed warns, and the fix is yarn install", () => {
    expect(probe({ facts: machine({ installedSupabaseCli: null }), id: "supabase-cli" })).toEqual({
      fix: "`yarn install` in this checkout",
      id: "supabase-cli",
      says: "the Supabase CLI is pinned at 2.109.1 but not installed in this checkout",
      scope: "slopweaver",
      verdict: "warning",
      withoutFix: NO_LOCAL_STORE,
    });
  });

  it("an installed CLI that differs from the pin names both versions", () => {
    expect(probe({ facts: machine({ installedSupabaseCli: "2.100.0" }), id: "supabase-cli" })).toEqual({
      fix: "`yarn install` in this checkout",
      id: "supabase-cli",
      says: "the Supabase CLI installed here is 2.100.0, but `package.json` pins 2.109.1",
      scope: "slopweaver",
      verdict: "warning",
      withoutFix: "`yarn store:start` runs 2.100.0, whose Docker images can differ from the ones the pin names",
    });
  });

  it("a checkout with no pin says so, and yarn install is not offered as the fix", () => {
    const facts = machine({ pins: { ...HEALTHY.pins, supabaseCli: null } });
    expect(probe({ facts, id: "supabase-cli" })).toEqual({
      fix: "restore `dependencies.supabase` in this checkout's `package.json` (`git checkout package.json yarn.lock`)",
      id: "supabase-cli",
      says: "this checkout's `package.json` pins no Supabase CLI version",
      scope: "slopweaver",
      verdict: "warning",
      withoutFix: `nothing says which Supabase the store runs, so ${NO_LOCAL_STORE}`,
    });
  });

  it("a supabase on PATH outside this checkout is named as unused and never moves the verdict", () => {
    const graded = probe({ facts: machine({ ambientSupabase: "/opt/homebrew/bin/supabase" }), id: "supabase-cli" });
    expect(graded.verdict).toBe("ok");
    expect(graded.says).toBe(
      "the Supabase CLI is pinned and installed at 2.109.1; `yarn store:*` runs only this checkout's dependency binary, never the `supabase` on PATH at /opt/homebrew/bin/supabase",
    );
  });
});

describe("developer health", () => {
  it("the Datadog agent missing is a warning scoped to the dev environment, never fatal", () => {
    const facts = machine({ datadogAgent: false, onPath: without("datadog-agent") });
    const health = environmentProbes({ facts }).filter((p) => p.scope === "dev-environment" && p.verdict !== "ok");
    expect(health.map((p) => `${p.id}:${p.verdict}`)).toEqual(["datadog-agent:warning"]);
  });

  it("a zsh profile error names its file and line", () => {
    const zshStartup = { errorAt: "/u/.zshrc:12", timedOut: false, zshReportedError: true };
    const facts = machine({ deep: { ...HEALTHY.deep!, zshStartup } });
    expect(probe({ facts, id: "zsh-profile" }).says).toBe(
      "your zsh profile reports an error on startup — the error is at /u/.zshrc:12",
    );
  });

  it("a zsh error outside the startup files still warns, without quoting it", () => {
    const zshStartup = { errorAt: null, timedOut: false, zshReportedError: true };
    const facts = machine({ deep: { ...HEALTHY.deep!, zshStartup } });
    expect(probe({ facts, id: "zsh-profile" }).says).toBe(
      "your zsh profile reports an error on startup — the error is in a file it sources or evals (run `zsh -i -c exit` to see where)",
    );
  });

  it("a timeout blames startup or exit, never startup alone", () => {
    const zshStartup = { errorAt: null, timedOut: true, zshReportedError: false };
    const facts = machine({ deep: { ...HEALTHY.deep!, zshStartup } });
    expect(probe({ facts, id: "zsh-profile" }).says).toBe(
      "an interactive zsh did not start and exit within the time limit",
    );
  });

  it("a spawn this probe could not read to the end is unchecked, never a profile error", () => {
    const facts = machine({ deep: { ...HEALTHY.deep!, zshStartup: "unreadable" } });
    expect(probe({ facts, id: "zsh-profile" }).verdict).toBe("unchecked");
  });
});

describe("without --deep", () => {
  it("leaves gh, cmux and the zsh profile unchecked rather than graded on silence", () => {
    const probes = environmentProbes({ facts: machine({ deep: null }) });
    expect(probes.filter((p) => p.verdict === "unchecked").map((p) => p.id)).toEqual(["gh", "cmux", "zsh-profile"]);
    expect(probeTally({ probes })).toEqual({ fatal: 0, unchecked: 3, warnings: 0 });
  });

  it("grades gh ok without a login check when an environment token is set", () => {
    expect(probe({ facts: machine({ deep: null, githubFallback: "env" }), id: "gh" }).verdict).toBe("ok");
  });
});

describe("parseVersionFloor and meetsFloor", () => {
  it("reads an omitted minor or patch as zero", () => {
    expect(parseVersionFloor({ floor: ">=24.11" })).toEqual([24, 11, 0]);
  });

  it("refuses any range that is not a single floor", () => {
    expect(parseVersionFloor({ floor: "^24" })).toBe(null);
  });

  it("compares part by part", () => {
    expect(meetsFloor({ floor: [24, 11, 0], version: "v24.11.0" })).toBe(true);
    expect(meetsFloor({ floor: [24, 11, 0], version: "v24.10.9" })).toBe(false);
    expect(meetsFloor({ floor: [24, 11, 0], version: "v25.0.0" })).toBe(true);
  });

  it("is null for a version that does not parse", () => {
    expect(meetsFloor({ floor: [24, 11, 0], version: "nightly" })).toBe(null);
  });
});

describe("managerOfNodePath", () => {
  it("recognises a proto shim by its own path", () => {
    expect(managerOfNodePath({ nodePath: "/u/.proto/shims/node", resolved: "/u/.proto/shims/node" })).toBe("proto");
  });

  it("recognises Homebrew only through the link's resolved Cellar path", () => {
    expect(
      managerOfNodePath({ nodePath: "/usr/local/bin/node", resolved: "/usr/local/Cellar/node/24.1.0/bin/node" }),
    ).toBe("homebrew");
  });

  it("is null for a node no manager installed", () => {
    expect(managerOfNodePath({ nodePath: "/usr/bin/node", resolved: "/usr/bin/node" })).toBe(null);
  });
});

describe("zshStartupFiles", () => {
  it("lists the system file then the per-user file under ZDOTDIR, in zsh's read order", () => {
    expect(zshStartupFiles({ zdotdir: "/u" })).toEqual([
      "/etc/zshenv",
      "/u/.zshenv",
      "/etc/zprofile",
      "/u/.zprofile",
      "/etc/zshrc",
      "/u/.zshrc",
      "/etc/zlogin",
      "/u/.zlogin",
    ]);
  });
});

describe("zshErrorLocation", () => {
  const startupFiles = zshStartupFiles({ zdotdir: "/u" });

  it("keeps only the file and line zsh named, never the text after them", () => {
    const stderr = "\n/u/.zshrc:12: command not found: export TOKEN=abc\n";
    expect(zshErrorLocation({ startupFiles, stderr })).toBe("/u/.zshrc:12");
  });

  it("never echoes a token a profile printed in the file:line shape (Codex review r1)", () => {
    const stderr = "ghp_supersecret:12: startup note";
    expect(stderr).toContain("ghp_supersecret");
    expect(zshErrorLocation({ startupFiles, stderr })).toBe(null);
  });

  it("never echoes a real file's path a profile printed when it is not a startup file (Codex review r2)", () => {
    const stderr = "/tmp/ghp_SUPERSECRET:12: note";
    expect(stderr).toContain("ghp_SUPERSECRET");
    expect(zshErrorLocation({ startupFiles, stderr })).toBe(null);
  });

  it("never echoes a line number longer than six digits", () => {
    expect(zshErrorLocation({ startupFiles, stderr: "/u/.zshrc:1234567: note" })).toBe(null);
  });

  it("finds the startup file's error past a line a tool wrote first", () => {
    const stderr = "stty: stdin isn't a terminal\n/u/.zshrc:4: command not found: nope\n";
    expect(zshErrorLocation({ startupFiles, stderr })).toBe("/u/.zshrc:4");
  });

  it("is null when no file is named, or stderr is empty", () => {
    expect(zshErrorLocation({ startupFiles, stderr: "something went wrong: TOKEN=abc" })).toBe(null);
    expect(zshErrorLocation({ startupFiles, stderr: "  \n" })).toBe(null);
  });
});

describe("zshReportedError", () => {
  it("is false for a tool's own stderr, such as stty with no terminal (Codex review r3)", () => {
    expect(zshReportedError({ stderr: "stty: stdin isn't a terminal\n" })).toBe(false);
    expect(zshReportedError({ stderr: "" })).toBe(false);
  });

  it("is true for zsh's error prefix from a sourced file or an eval", () => {
    expect(zshReportedError({ stderr: "/u/.zsh/aliases.zsh:3: parse error near `}'\n" })).toBe(true);
    expect(zshReportedError({ stderr: "(eval):1: command not found: brew\n" })).toBe(true);
  });
});
