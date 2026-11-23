/**
 * The plugin-mirror incident, reproduced against the real `lib/gitRepo.ts` — the test that would have caught
 * a composed and reviewed bot answer being destroyed at send time.
 *
 * ## What is actually being reproduced
 *
 * A marketplace plugin install copies this repository's source files into
 * `~/.claude/plugins/data/<plugin>/mirror/…` as a plain directory tree with NO `.git` anywhere above them.
 * A module resolving its repository from its OWN file (`repoRootOf`, anchored on `import.meta.url`) is then
 * asking git about a directory that is in no repository, and `git rev-parse --show-toplevel` fails —
 * deterministically, on every call, for the life of that install. `src/live/turn/posterAnswer.ts` did that
 * while building the admit door's gate list, so the ask's terminal row read
 * `Command failed: git -C …/mirror/a/src/live/turn rev-parse --show-toplevel, fatal: not a git repository`.
 *
 * So the fixture is the install shape, not a stand-in for it: `lib/gitRepo.ts` is COPIED into a mirror
 * directory carrying no `.git`, and the process is then run with its `cwd` in a real repository somewhere
 * else entirely — the exact divergence the incident turned on, since the operator's checkout was a perfectly
 * good repository the whole time. `gitRepo.ts` imports nothing but node builtins, which is what makes
 * copying the one real module (rather than reimplementing its two lines) possible.
 *
 * ## Why it is falsifiable in both directions
 *
 * The same child asserts BOTH families against the same mirror: `repoRootOf` must still throw (delete the
 * mirror shape and this stops being a test of anything) and `runningCheckoutRoot` must answer the cwd's
 * repository (delete its `cwd` anchor for an `import.meta.url` one and it throws instead). Neither can pass
 * by accident.
 *
 * Filesystem + subprocess only — a temp repo and a temp mirror, no network — which
 * `.claude/rules/testing.md` permits for exactly this kind of real round-trip.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// register-class: module-anchored-repo-lookup-in-a-runtime-verb (docs/recurring-failure-register/bindings.md)

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** This suite's own file, the anchor every path below is resolved from. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The real module under test, and the `tsx` that runs the probe — both from this checkout. */
const REAL_GIT_REPO_MODULE = resolve(HERE, "../../../lib/gitRepo.ts");
const TSX_BIN = resolve(HERE, "../../../../node_modules/.bin/tsx");

/** A fresh temp git repo with one commit — the operator's checkout, standing somewhere the mirror is not. */
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mirror-cwd-repo-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("commit", "--allow-empty", "-m", "seed");
  return dir;
}

/**
 * A plugin mirror: the real `gitRepo.ts` at the depth an install puts it, under no repository at all.
 *
 * The nesting mirrors `…/mirror/a/src/lib/` rather than dropping the file at the top, because the whole
 * failure is that git walks PARENTS looking for `.git` and finds none — a shallow fixture would test the
 * same thing with less of the shape it is standing in for.
 */
function pluginMirror(): { readonly probePath: string } {
  const root = mkdtempSync(join(tmpdir(), "plugin-mirror-"));
  fixtureDirs.push(root);
  const libDir = join(root, "mirror", "a", "src", "lib");
  mkdirSync(libDir, { recursive: true });
  cpSync(REAL_GIT_REPO_MODULE, join(libDir, "gitRepo.ts"));
  const probePath = join(root, "mirror", "a", "src", "lib", "probe.ts");
  writeFileSync(probePath, PROBE_SOURCE, "utf8");
  return { probePath };
}

/**
 * The probe that runs INSIDE the mirror — it must live there, because the whole question is what a module
 * resolves when its own file is in a directory tree carrying no `.git`.
 *
 * It prints one JSON line so the assertions read exact values rather than parsing prose out of a stack.
 */
const PROBE_SOURCE = `import { repoRootOf, runningCheckoutBranch, runningCheckoutRoot } from "./gitRepo.js";

let moduleAnchored: string;
try {
  moduleAnchored = \`resolved:\${repoRootOf({ importMetaUrl: import.meta.url })}\`;
} catch (error) {
  moduleAnchored = \`threw:\${error instanceof Error ? error.message : String(error)}\`;
}
process.stdout.write(
  JSON.stringify({
    branch: runningCheckoutBranch() ?? null,
    cwdAnchored: runningCheckoutRoot(),
    moduleAnchored,
  }),
);
`;

/** Run the probe from `cwd`, and decode the one JSON line it prints. */
function runProbe({ cwd, probePath }: { cwd: string; probePath: string }): {
  readonly branch: string | null;
  readonly cwdAnchored: string;
  readonly moduleAnchored: string;
} {
  const stdout = execFileSync(TSX_BIN, [probePath], { cwd, encoding: "utf8" });
  return JSON.parse(stdout) as { branch: string | null; cwdAnchored: string; moduleAnchored: string };
}

describe(
  "a module running from a plugin mirror",
  () => {
    it("cannot resolve a repository from its own file, and says so the way the incident did", () => {
      const { probePath } = pluginMirror();
      const result = runProbe({ cwd: tempRepo(), probePath });
      expect(result.moduleAnchored.startsWith("threw:")).toBe(true);
      expect(result.moduleAnchored).toContain("not a git repository");
    });

    it("resolves the checkout the process is STANDING in, which the mirror never touches", () => {
      const repo = tempRepo();
      const { probePath } = pluginMirror();
      expect(runProbe({ cwd: repo, probePath }).cwdAnchored).toBe(realpathSync(repo));
    });

    it("names that checkout's branch, so a spawn plan is not left calling it detached", () => {
      const repo = tempRepo();
      const { probePath } = pluginMirror();
      expect(runProbe({ cwd: repo, probePath }).branch).toBe("main");
    });

    it("answers the raw cwd rather than throwing when the process stands outside a repository too", () => {
      const bare = mkdtempSync(join(tmpdir(), "mirror-cwd-bare-"));
      fixtureDirs.push(bare);
      const { probePath } = pluginMirror();
      const result = runProbe({ cwd: bare, probePath });
      expect(result.cwdAnchored).toBe(realpathSync(bare));
      expect(result.branch).toBeNull();
    });
  },
  REAL_GIT_TIMEOUT_MS,
);
