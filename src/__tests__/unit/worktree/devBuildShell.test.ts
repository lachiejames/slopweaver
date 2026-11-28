import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  builtCliPresent,
  devBuildFailureDetail,
  discardBrokenBuild,
  supportsDevBuild,
  worktreeDevBuildArgv,
} from "../../../worktree/shell.js";

describe("worktreeDevBuildArgv", () => {
  it("runs dev build from source with --yield-to-lap, so provisioning never stalls 120 s through a lap", () => {
    expect(worktreeDevBuildArgv()).toEqual(["src/cli/index.ts", "dev", "build", "--yield-to-lap"]);
  });
});

const roots: string[] = [];

/** A throwaway directory, removed in the `afterEach` below, inside the per-file temp sandbox. */
function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "devbuild-"));
  roots.push(root);
  return root;
}

/** Whether a directory ENTRY is there, not following a symlink — the question the production code asks. */
function lstatSyncOrUndefined({ path }: { path: string }): string | undefined {
  try {
    lstatSync(path);
    return "present";
  } catch {
    return undefined;
  }
}

/** Write an empty file, creating every directory above it. */
function touch({ root, relative }: { root: string; relative: string }): void {
  const path = join(root, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodSync(root, 0o755);
    rmSync(root, { force: true, recursive: true });
  }
});

/** This repository's own declared package name, read from the file the production constant mirrors. */
const OWN_PACKAGE_NAME = ((): string => {
  const parsed: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "../../../..", "package.json"), "utf8"));
  return String((parsed as { name: unknown }).name);
})();

/** A worktree that looks like this repository to `supportsDevBuild`, missing whichever part is named. */
function emitterTree({ root, name = OWN_PACKAGE_NAME }: { root: string; name?: string }): string {
  touch({ relative: "src/cli/index.ts", root });
  touch({ relative: "node_modules/.bin/tsx", root });
  writeFileSync(join(root, "package.json"), `{ "name": ${JSON.stringify(name)} }\n`);
  return root;
}

describe("supportsDevBuild", () => {
  it("is true for a tree carrying the emitter entrypoint, a tsx to run it with, and this package's name", () => {
    expect(supportsDevBuild({ path: emitterTree({ root: newRoot() }) })).toBe(true);
  });

  it("names the package this file's own constant claims, so the two cannot drift apart", () => {
    expect(OWN_PACKAGE_NAME).toBe("slopweaver");
  });

  it("is false for ANOTHER repository with the same layout — the case that sent cleanup at its build", () => {
    // `worktree create --repo <foreign>` reaches repositories that have a src/cli/index.ts and a tsx and are
    // not this one. Handing THEIR CLI `dev build` either fakes an emit (exit 0 on an unknown verb) or, on a
    // non-zero exit, points `discardBrokenBuild` at a dist-cli this emit never wrote — which for a foreign
    // `tsc` configured with `outDir: "dist-cli"` is `--build`'s own successful output.
    const root = emitterTree({ name: "another-cli", root: newRoot() });

    expect(supportsDevBuild({ path: root })).toBe(false);
  });

  it("is false for a tree with no package.json to identify itself with at all", () => {
    const root = newRoot();
    touch({ relative: "src/cli/index.ts", root });
    touch({ relative: "node_modules/.bin/tsx", root });

    expect(supportsDevBuild({ path: root })).toBe(false);
  });

  it("is false for a package.json that is not JSON, rather than throwing out of provisioning", () => {
    const root = emitterTree({ root: newRoot() });
    writeFileSync(join(root, "package.json"), "{ not json\n");

    expect(supportsDevBuild({ path: root })).toBe(false);
  });

  it("is false for a repository that is not this one, however its dependencies are installed", () => {
    const root = newRoot();
    touch({ relative: "node_modules/.bin/tsx", root });

    expect(supportsDevBuild({ path: root })).toBe(false);
  });

  it("is false before the install has put a tsx there, which is every worktree at `git worktree add`", () => {
    const root = newRoot();
    touch({ relative: "src/cli/index.ts", root });

    expect(supportsDevBuild({ path: root })).toBe(false);
  });

  it("is false for a directory that does not exist at all", () => {
    expect(supportsDevBuild({ path: join(newRoot(), "never-created") })).toBe(false);
  });
});

describe("builtCliPresent", () => {
  it("is true only with BOTH files `bin/slopweaver` demands before it routes to a build", () => {
    const root = newRoot();
    touch({ relative: "dist-cli/.slopweaver-build.json", root });
    touch({ relative: "dist-cli/cli/index.js", root });

    expect(builtCliPresent({ path: root })).toBe(true);
  });

  it("is false for JavaScript with no manifest — exactly what a failed emit leaves standing", () => {
    const root = newRoot();
    touch({ relative: "dist-cli/cli/index.js", root });

    expect(builtCliPresent({ path: root })).toBe(false);
  });

  it("is false for a manifest with no entrypoint under it", () => {
    const root = newRoot();
    touch({ relative: "dist-cli/.slopweaver-build.json", root });

    expect(builtCliPresent({ path: root })).toBe(false);
  });

  it("is false for the worktree every provision starts from, which has no dist-cli at all", () => {
    expect(builtCliPresent({ path: newRoot() })).toBe(false);
  });

  it("is false for DIRECTORIES at those two names, because the launcher's own test is `-f`", () => {
    const root = newRoot();
    mkdirSync(join(root, "dist-cli", ".slopweaver-build.json"), { recursive: true });
    mkdirSync(join(root, "dist-cli", "cli", "index.js"), { recursive: true });

    expect(builtCliPresent({ path: root })).toBe(false);
  });
});

describe("devBuildFailureDetail", () => {
  it("reads stderr when the emit crashed there", () => {
    expect(devBuildFailureDetail({ error: { stderr: "esbuild: EACCES\n", stdout: "" } })).toBe("esbuild: EACCES");
  });

  it("falls through to STDOUT, which is where `dev build` prints an unsuccessful smoke verdict", () => {
    expect(devBuildFailureDetail({ error: { stderr: "  \n", stdout: "smoke: catalog exited 1\n" } })).toBe(
      "smoke: catalog exited 1",
    );
  });

  it("reads a Buffer stream, which is what execFileSync leaves without an encoding", () => {
    expect(devBuildFailureDetail({ error: { stderr: Buffer.from("boom\n") } })).toBe("boom");
  });

  it("keeps only the last five lines, so one line of report never carries a whole build log", () => {
    const error = { stderr: ["one", "two", "three", "four", "five", "six", "seven"].join("\n") };

    expect(devBuildFailureDetail({ error })).toBe("three · four · five · six · seven");
  });

  it("names the thrown message when neither stream said anything", () => {
    expect(devBuildFailureDetail({ error: new Error("spawn ENOENT") })).toBe("spawn ENOENT");
  });
});

describe("discardBrokenBuild", () => {
  it("removes the whole unstamped built tree a failed emit left, so nothing can run out of it", () => {
    const root = newRoot();
    touch({ relative: "dist-cli/cli/index.js", root });
    touch({ relative: "dist-cli/builtCli/guard.js", root });

    expect(discardBrokenBuild({ path: root })).toBe("removed");
    expect(existsSync(join(root, "dist-cli"))).toBe(false);
  });

  it("leaves the SOURCE beside it alone — the tree it just made runnable", () => {
    const root = newRoot();
    touch({ relative: "dist-cli/cli/index.js", root });
    writeFileSync(join(root, "src-marker.ts"), "export const kept = 1;\n");

    discardBrokenBuild({ path: root });

    expect(readFileSync(join(root, "src-marker.ts"), "utf8")).toBe("export const kept = 1;\n");
  });

  it("LEAVES a still-stamped build alone — a failure that never started the emitter cleared no manifest", () => {
    // Measured before this check existed: a `node_modules/.bin/tsx` at mode 0644 makes `execFileSync` throw
    // EACCES before the emitter runs, and the reused worktree's working `dist-cli` was deleted to tidy up
    // after an attempt that had done nothing. Whatever went wrong, a stamped tree is one `builtCli/guard.ts`
    // refuses on its own. Repro: `chmod 0644 node_modules/.bin/tsx` and provision over a built worktree.
    const root = newRoot();
    touch({ relative: "dist-cli/.slopweaver-build.json", root });
    touch({ relative: "dist-cli/cli/index.js", root });

    expect(discardBrokenBuild({ path: root })).toBe("guarded");
    expect(existsSync(join(root, "dist-cli", "cli", "index.js"))).toBe(true);
  });

  it("removes NOTHING when it cannot read whether the stamp is there, and says it could not", () => {
    // The same launch failure that leaves a build untouched can be why its manifest is unreachable, so a
    // stat that answered EACCES must not license a removal. Repro: point dist-cli at a store directory, then
    // `chmod 000` that store — both the manifest and the emitter's own tsx answer EACCES.
    const root = newRoot();
    const store = newRoot();
    touch({ relative: "build/.slopweaver-build.json", root: store });
    touch({ relative: "build/cli/index.js", root: store });
    symlinkSync(join(store, "build"), join(root, "dist-cli"));
    chmodSync(store, 0o000);

    expect(discardBrokenBuild({ path: root })).toBe("unreadable");

    chmodSync(store, 0o755);
    expect(existsSync(join(store, "build", "cli", "index.js"))).toBe(true);
    expect(lstatSyncOrUndefined({ path: join(root, "dist-cli") })).toBe("present");
  });

  it("says nothing was there when the emit failed before writing a byte", () => {
    const root = newRoot();

    expect(discardBrokenBuild({ path: root })).toBe("absent");
  });

  it("removes a DANGLING dist-cli symlink, which `existsSync` would have called absent", () => {
    // `existsSync` follows the link and answers false when the target is not there, so the entry it is asked
    // about survives a cleanup that believed it had nothing to do — and the next emit then fails on a
    // `dist-cli` that cannot be written through. `lstatSync` answers about the link itself.
    const root = newRoot();
    symlinkSync(join(root, "never-created"), join(root, "dist-cli"));

    expect(discardBrokenBuild({ path: root })).toBe("removed");
    expect(lstatSyncOrUndefined({ path: join(root, "dist-cli") })).toBe(undefined);
  });

  it("never calls an unreadable tree absent — a stat that threw has established nothing", () => {
    // Only ENOENT/ENOTDIR mean nothing is there. Measured before this distinction existed: EACCES read as
    // absent, so the report said "this worktree runs from source" over surviving JavaScript. Repro:
    // `chmod 0600 <worktree>` and provision over it.
    const root = newRoot();
    const worktree = join(root, "worktree");
    touch({ relative: "worktree/dist-cli/cli/index.js", root });
    chmodSync(worktree, 0o600);

    expect(discardBrokenBuild({ path: worktree })).toBe("unreadable");

    chmodSync(worktree, 0o755);
    expect(existsSync(join(worktree, "dist-cli", "cli", "index.js"))).toBe(true);
  });

  it("answers `kept` rather than THROWING when the built tree cannot be removed", () => {
    // `rmSync`'s `force` suppresses a missing path and nothing else, so an unwritable parent raises EPERM
    // here — and an exception escaping this would turn provisioning's deliberately non-fatal emit into a
    // failed provision. Repro without the guard: `chmod 0555 dist-cli/cli` and provision over it.
    const root = newRoot();
    touch({ relative: "dist-cli/cli/index.js", root });
    chmodSync(join(root, "dist-cli", "cli"), 0o555);

    expect(discardBrokenBuild({ path: root })).toBe("kept");
    expect(existsSync(join(root, "dist-cli", "cli", "index.js"))).toBe(true);

    chmodSync(join(root, "dist-cli", "cli"), 0o755);
  });
});
