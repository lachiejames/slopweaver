/**
 * The runtime probes — Node, its manager, yarn, git, bash and Docker: what Slopweaver cannot start, install,
 * hook or keep a store without. Every miss here but the manager's is FATAL, and `doctor` exits non-zero on one.
 */
import { type EnvironmentFacts, type EnvironmentProbe, type NodeManager, okProbe, uncheckedProbe } from "./facts.js";

/** The recommended Node manager: the one this organisation's other repository already pins with. */
const RECOMMENDED_MANAGER = "proto";

/**
 * Parse a `>=MAJOR[.MINOR[.PATCH]]` floor into three numbers.
 *
 * @param floor the `engines.node` value
 * @returns the floor as `[major, minor, patch]`, or `null` for any other range shape
 */
export function parseVersionFloor({ floor }: { floor: string }): readonly [number, number, number] | null {
  const match = /^>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(floor.trim());
  if (match === null) {
    return null;
  }
  // An omitted minor or patch is a zero by the range's own meaning: `>=24.11` admits 24.11.0.
  const [major, minor, patch] = [match[1], match[2], match[3]].map((part) => (part === undefined ? 0 : Number(part)));
  return [major!, minor!, patch!];
}

/**
 * Whether a `vMAJOR.MINOR.PATCH` version meets a floor.
 *
 * @param version the running version, as `process.version` prints it
 * @param floor the parsed floor
 * @returns true when the version is at or above it; `null` when the version does not parse
 */
export function meetsFloor({
  version,
  floor,
}: {
  version: string;
  floor: readonly [number, number, number];
}): boolean | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version.trim());
  if (match === null) {
    return null;
  }
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < 3; index += 1) {
    const have = parts[index]!;
    const need = floor[index]!;
    if (have !== need) {
      return have > need;
    }
  }
  return true;
}

/** How to install a Node version with the manager in use, or with the recommended one. */
function installNodeCommand({ manager, version }: { manager: NodeManager | null; version: string }): string {
  switch (manager) {
    case "nvm":
      return `nvm install ${version}`;
    case "volta":
      return `volta install node@${version}`;
    case "fnm":
      return `fnm install ${version}`;
    case "asdf":
      return `asdf install nodejs ${version}`;
    case "mise":
      return `mise install node@${version}`;
    case "homebrew":
      return `brew upgrade node, or move to ${RECOMMENDED_MANAGER} and \`proto install node ${version}\``;
    case "proto":
    case null:
      return `proto install node ${version}`;
    default: {
      const unreachable: never = manager;
      return unreachable;
    }
  }
}

/** The version to recommend installing: `.nvmrc`'s exact pin, else the floor itself. */
function recommendedNode({ facts }: { facts: EnvironmentFacts }): string {
  if (facts.pins.nvmrc !== null) {
    return facts.pins.nvmrc;
  }
  if (facts.pins.engineFloor !== null) {
    return facts.pins.engineFloor.replace(/^>=\s*/u, "");
  }
  return "the current LTS";
}

/** Who serves Node, in words. */
function managerWords({ manager }: { manager: NodeManager | null }): string {
  if (manager === null) {
    return "no recognised version manager";
  }
  return manager;
}

/**
 * `node`: on `PATH`, and at least the `engines.node` floor. FATAL either way.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function nodeProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "node";
  const scope = "slopweaver";
  const manager = managerWords({ manager: facts.nodeManager });
  const want = recommendedNode({ facts });
  const install = installNodeCommand({ manager: facts.nodeManager, version: want });
  if (facts.onPath.node === null) {
    return {
      fix: `install Node ${want}: \`${install}\`, then open a new terminal so PATH picks it up`,
      id,
      says: `\`node\` is not on PATH (this check is running on ${facts.runningNode.execPath}, reached some other way)`,
      scope,
      verdict: "fatal",
      withoutFix:
        "the launcher still runs when `.nvmrc`'s exact version is installed under a version manager (it looks there before PATH), but the PreToolUse hook and every spawned session call `node` from PATH",
    };
  }
  const running = facts.runningNode.version;
  const declared = facts.pins.engineFloor;
  const floor = declared === null ? null : parseVersionFloor({ floor: declared });
  if (declared === null || floor === null) {
    const says = `Node ${running} via ${manager}; the version floor could not be read from package.json's engines.node, so it was not compared`;
    return uncheckedProbe({ id, says, scope });
  }
  const meets = meetsFloor({ floor, version: running });
  if (meets === null) {
    const says = `Node ${running} via ${manager}; that version string did not parse, so it was not compared with ${declared}`;
    return uncheckedProbe({ id, says, scope });
  }
  if (!meets) {
    return {
      fix: `\`${install}\` (.nvmrc pins ${want})`,
      id,
      says: `Node ${running} via ${manager} is below the ${declared} this checkout requires`,
      scope,
      verdict: "fatal",
      withoutFix:
        "Slopweaver may start, but code written for the pinned Node can fail in ways that name nothing useful",
    };
  }
  return okProbe({ id, says: `Node ${running} via ${manager} (needs ${declared})`, scope });
}

/**
 * The node-manager probe: which one serves Node, and whether two are fighting over PATH. A WARNING only.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function nodeManagerProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "node-manager";
  const scope = "slopweaver";
  if (facts.managersOnPath.length > 1) {
    return {
      fix: `keep one: remove the others' PATH lines from your shell profile (${RECOMMENDED_MANAGER} is the recommended one)`,
      id,
      says: `${String(facts.managersOnPath.length)} Node managers are on PATH (${facts.managersOnPath.join(", ")}) — ${managerWords({ manager: facts.nodeManager })} serves \`node\` today`,
      scope,
      verdict: "warning",
      withoutFix:
        "whichever is first on PATH wins, so a new terminal or a reordered profile silently changes your Node",
    };
  }
  if (facts.nodeManager === null) {
    return {
      fix: `install ${RECOMMENDED_MANAGER} (https://moonrepo.dev/proto) and \`proto install node ${recommendedNode({ facts })}\``,
      id,
      says: "`node` is not served by a recognised version manager",
      scope,
      verdict: "warning",
      withoutFix: "nothing breaks today; upgrading Node to a new pin is a manual job",
    };
  }
  return okProbe({ id, says: `Node is managed by ${facts.nodeManager}`, scope });
}

/**
 * `yarn`, or a `corepack` that provides it: FATAL at install time.
 *
 * Corepack sitting beside Node but OFF `PATH` stays fatal: the install script's `corepack enable` resolves it
 * by name, so it cannot find that one and the install fails — the fix names the exact binary to run instead.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function yarnProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "yarn";
  const scope = "slopweaver";
  if (facts.onPath.yarn !== null) {
    return okProbe({ id, says: `yarn at ${facts.onPath.yarn}`, scope });
  }
  if (facts.onPath.corepack !== null) {
    const says = `yarn comes from corepack (${facts.onPath.corepack}); the install runs \`corepack enable\``;
    return okProbe({ id, says, scope });
  }
  const withoutFix =
    "dependencies cannot be installed, so a fresh install or a lockfile change leaves the CLI unable to start";
  if (facts.corepackBesideNode !== null) {
    return {
      fix: `\`${facts.corepackBesideNode} enable\` — your Node ships corepack, but your version manager does not put it on PATH`,
      id,
      says: "neither `yarn` nor `corepack` is on PATH",
      scope,
      verdict: "fatal",
      withoutFix,
    };
  }
  return {
    fix: "`proto install yarn` (it reads package.json's packageManager pin), or `corepack enable` on a Node that ships it",
    id,
    says: "neither `yarn` nor `corepack` is on PATH, and the running Node ships no corepack",
    scope,
    verdict: "fatal",
    withoutFix,
  };
}

/**
 * A binary whose absence is FATAL because Slopweaver runs it by name on every path.
 *
 * @param facts what `./gather.ts` found
 * @param name the binary
 * @param fix how to put it back
 * @param withoutFix what stops working without it
 * @returns the graded probe
 */
export function requiredBinaryProbe({
  facts,
  name,
  fix,
  withoutFix,
}: {
  facts: EnvironmentFacts;
  name: "git" | "bash";
  fix: string;
  withoutFix: string;
}): EnvironmentProbe {
  const found = facts.onPath[name];
  if (found !== null) {
    return okProbe({ id: name, says: `${name} at ${found}`, scope: "slopweaver" });
  }
  return { fix, id: name, says: `\`${name}\` is not on PATH`, scope: "slopweaver", verdict: "fatal", withoutFix };
}

/**
 * Docker: the local store is `supabase start`, which runs in it, so a machine with no container runtime has
 * no store. Docker Desktop is the APP, since a `docker` CLI alone can be another runtime's (colima, OrbStack),
 * which is accepted — though only the CLI's path was seen, never that the runtime behind it is running.
 *
 * @param facts what `./gather.ts` found
 * @returns the graded probe
 */
export function dockerProbe({ facts }: { facts: EnvironmentFacts }): EnvironmentProbe {
  const id = "docker";
  const scope = "slopweaver";
  if (facts.dockerApp) {
    return okProbe({ id, says: "Docker Desktop is installed — the local store runs in it", scope });
  }
  if (facts.onPath.docker !== null) {
    const says = `no Docker Desktop app, but a \`docker\` CLI at ${facts.onPath.docker} — whether a runtime serves it was not checked`;
    return okProbe({ id, says, scope });
  }
  return {
    fix: "install Docker Desktop (https://www.docker.com/products/docker-desktop)",
    id,
    says: "Docker is not installed — neither the Docker Desktop app nor a `docker` CLI",
    scope,
    verdict: "fatal",
    withoutFix:
      "connecting and pulling sources still work, but there is no local store: `supabase start` needs Docker, so `store` reads and the bot's history leg cannot run",
  };
}
