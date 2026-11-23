/**
 * Where `@openai/codex-sdk`'s own vendored Codex CLI lives on this machine — the binary every pass spends
 * through, and so the one a check on a pass has to ask.
 *
 * Resolved exactly the way the SDK's `findCodexPath` resolves it — from the SDK's own directory, the same six targets, `codex.exe` on
 * Windows, the packaged layout before the unpackaged one, and the directories the SDK puts in front of PATH —
 * never a `codex` on PATH: on the owner's machine PATH carries codex-cli 0.155.1 behind a cmux wrapper while
 * `package.json` pins the SDK at 0.153.4, and two builds can read one home's configuration into two
 * different MCP server lists (`./browserDoor.ts`, Codex review r2). Pinning the path with `codexPathOverride`
 * makes the SDK skip its own PATH prepend, so {@link withCodexPathDirs} restores it (Codex review r16:
 * `vendor/<triple>/codex-path` carries the `rg` a thread searches with).
 */
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A Codex binary a launch runs, and the directories that launch puts in front of PATH for it. */
export interface CodexCli {
  readonly path: string;
  readonly pathDirs: readonly string[];
}

/** Which vendored package and target triple carry the CLI for each `<platform>-<arch>`, in the SDK's own table. */
const PLATFORM_PACKAGES: ReadonlyMap<string, { readonly pkg: string; readonly triple: string }> = new Map([
  ["android-arm64", { pkg: "@openai/codex-linux-arm64", triple: "aarch64-unknown-linux-musl" }],
  ["android-x64", { pkg: "@openai/codex-linux-x64", triple: "x86_64-unknown-linux-musl" }],
  ["darwin-arm64", { pkg: "@openai/codex-darwin-arm64", triple: "aarch64-apple-darwin" }],
  ["darwin-x64", { pkg: "@openai/codex-darwin-x64", triple: "x86_64-apple-darwin" }],
  ["linux-arm64", { pkg: "@openai/codex-linux-arm64", triple: "aarch64-unknown-linux-musl" }],
  ["linux-x64", { pkg: "@openai/codex-linux-x64", triple: "x86_64-unknown-linux-musl" }],
  ["win32-arm64", { pkg: "@openai/codex-win32-arm64", triple: "aarch64-pc-windows-msvc" }],
  ["win32-x64", { pkg: "@openai/codex-win32-x64", triple: "x86_64-pc-windows-msvc" }],
]);

/** Whether a path is a regular file, false when it is absent or anything else. */
function isFile({ path }: { path: string }): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Whether a path is a directory, false when it is absent or anything else. */
function isDirectory({ path }: { path: string }): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The binary in one vendored package root, in the SDK's order: the packaged layout, then the unpackaged one. */
function packagedCli({ packageRoot, binary }: { packageRoot: string; binary: string }): CodexCli | undefined {
  const packaged = join(packageRoot, "bin", binary);
  if (isFile({ path: packaged }) && isFile({ path: join(packageRoot, "codex-package.json") })) {
    return { path: packaged, pathDirs: [join(packageRoot, "codex-path")].filter((path) => isDirectory({ path })) };
  }
  const unpackaged = join(packageRoot, "codex", binary);
  if (isFile({ path: unpackaged })) {
    return { path: unpackaged, pathDirs: [join(packageRoot, "path")].filter((path) => isDirectory({ path })) };
  }
  return undefined;
}

/**
 * The SDK's own entry module, resolved the way an `import` of it is — through whatever linker installed it,
 * a non-hoisted tree or Plug'n'Play included (Codex review r18, r19) — or undefined when it is not installed.
 */
function sdkEntry(): string | undefined {
  try {
    return fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
  } catch {
    return undefined;
  }
}

/**
 * The SDK's vendored Codex CLI for this platform, and the directories the SDK would put in front of PATH.
 *
 * @returns the CLI, or the reason this machine has none
 */
export function vendoredCodexCli(): CodexCli | { readonly reason: string } {
  const platform = PLATFORM_PACKAGES.get(`${process.platform}-${process.arch}`);
  if (platform === undefined) {
    return { reason: `no vendored Codex CLI for ${process.platform}-${process.arch}` };
  }
  const sdk = sdkEntry();
  if (sdk === undefined) {
    return { reason: "@openai/codex-sdk is not installed" };
  }
  let vendor: string;
  try {
    // From the SDK's own directory, as the SDK resolves it: a non-hoisted install nests @openai/codex under it.
    const codexRequire = createRequire(createRequire(sdk).resolve("@openai/codex/package.json"));
    vendor = join(dirname(codexRequire.resolve(`${platform.pkg}/package.json`)), "vendor");
  } catch {
    return { reason: `the vendored Codex CLI package ${platform.pkg} is not installed` };
  }
  const binary = process.platform === "win32" ? "codex.exe" : "codex";
  const cli = packagedCli({ binary, packageRoot: join(vendor, platform.triple) });
  if (cli === undefined) {
    return { reason: `the vendored Codex CLI package ${platform.pkg} carries no ${binary} for ${platform.triple}` };
  }
  return cli;
}

/** The PATH key the SDK writes: `PATH` off Windows; on it `Path` if present, else the last spelling, else `PATH`. */
function pathEnvKey({ env, platform }: { env: Readonly<Record<string, string>>; platform: NodeJS.Platform }): string {
  if (platform !== "win32") {
    return "PATH";
  }
  const keys = Object.keys(env).filter((key) => key.toLowerCase() === "path");
  if (keys.includes("Path")) {
    return "Path";
  }
  const last = keys.at(-1);
  if (last === undefined) {
    return "PATH";
  }
  return last;
}

/**
 * An environment with a CLI's directories in front of PATH, as the SDK's own `prependPathDirs` builds it:
 * on Windows the one PATH key is found whatever its case and every other spelling is dropped.
 *
 * @param env the launch environment, left untouched
 * @param pathDirs the directories to put first, in order; each appears once
 * @param platform the platform whose PATH key rules apply
 * @returns a new environment
 */
export function withCodexPathDirs({
  env,
  pathDirs,
  platform = process.platform,
}: {
  env: Readonly<Record<string, string>>;
  pathDirs: readonly string[];
  platform?: NodeJS.Platform;
}): Record<string, string> {
  if (pathDirs.length === 0) {
    return { ...env };
  }
  const next: Record<string, string> = { ...env };
  const pathKey = pathEnvKey({ env: next, platform });
  if (platform === "win32") {
    Object.keys(next)
      .filter((key) => key.toLowerCase() === "path" && key !== pathKey)
      .forEach((key) => {
        delete next[key];
      });
  }
  const existing = next[pathKey];
  const entries = existing === undefined ? [] : existing.split(delimiter);
  next[pathKey] = [...pathDirs, ...entries.filter((entry) => entry.length > 0 && !pathDirs.includes(entry))].join(
    delimiter,
  );
  return next;
}
