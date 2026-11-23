/**
 * The `yarn test:e2e` entry point, the effectful shell of the console's browser lane: decide whether this change can
 * move what the lane proves, and when it cannot, pass with the not-applicable line rather than skip; otherwise build
 * the CLI and the console from this checkout and run Playwright Test over them (`config/playwright/console.ts`). Every
 * decision is in `./desktopE2eApplicability.ts`; this file only reads, spawns and prints, and exports nothing.
 *
 * Nothing is cached between runs: the console and the CLI are built from the checked-out tree every time, so a stale
 * build can never pass a change it does not contain. The dependency restore CI does before this is keyed on every file
 * the install reads, with no fallback key, so it cannot either.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { desktopE2eApplicable, desktopE2eBase, NOT_APPLICABLE_LINE } from "./desktopE2eApplicability.js";

/** The lane's Playwright config. */
const PLAYWRIGHT_CONFIG = "config/playwright/console.ts";

/**
 * The bound on one build or test step. CI's `desktop-e2e` job is capped at 15 minutes, and its first run took 231s
 * whole (run 42372896552), so a step past 12 minutes is stuck rather than slow.
 */
const STEP_TIMEOUT_MS = 12 * 60_000;

/** The bound on fetching the base commit and diffing against it, each one network round or less. */
const GIT_TIMEOUT_MS = 60_000;

/**
 * Print a line under the lane's name.
 *
 * @param line what to print
 */
function say({ line }: { line: string }): void {
  process.stdout.write(`desktop-e2e: ${line}\n`);
}

/**
 * Run one command with inherited output.
 *
 * @param cwd the repository root
 * @param command the binary
 * @param args its arguments
 * @param env extra environment for this one child
 * @returns its exit status, or 1 when it did not exit normally
 */
function run({
  cwd,
  command,
  args,
  env,
}: {
  cwd: string;
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}): number {
  say({ line: `$ ${command} ${args.join(" ")}` });
  const child = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    timeout: STEP_TIMEOUT_MS,
  });
  if (child.status === null) {
    say({ line: `${command} did not exit normally (${String(child.signal)})` });
    return 1;
  }
  return child.status;
}

/**
 * The paths this change touches against the event's base, or `undefined` when they cannot be known — no base on this
 * event, a base that cannot be fetched, or a diff that fails. `undefined` runs the lane: a lane that cannot tell what
 * changed must not pass as not applicable.
 *
 * @param cwd the repository root
 * @returns the changed paths, or undefined to run everything
 */
function changedPaths({ cwd }: { cwd: string }): readonly string[] | undefined {
  const eventPath = process.env["GITHUB_EVENT_PATH"];
  if (eventPath === undefined) {
    say({ line: "no GitHub event: running every spec" });
    return undefined;
  }
  const base = desktopE2eBase({
    event: safeJsonParse({ label: eventPath, text: readFileSync(eventPath, "utf8") }),
    eventName: process.env["GITHUB_EVENT_NAME"],
  });
  if (base.isErr()) {
    say({ line: `${base.error.join("; ")}: running every spec` });
    return undefined;
  }
  if (base.value === undefined) {
    say({ line: `a ${String(process.env["GITHUB_EVENT_NAME"])} event names no base: running every spec` });
    return undefined;
  }
  // The checkout fetched one commit; the base is fetched alone, as the coverage floor's step does (`ci.yml`).
  const fetched = spawnSync("git", ["fetch", "--no-tags", "--depth=1", "origin", base.value], {
    cwd,
    stdio: "inherit",
    timeout: GIT_TIMEOUT_MS,
  });
  if (fetched.status !== 0) {
    say({ line: `could not fetch the base ${base.value}: running every spec` });
    return undefined;
  }
  // Two dots, never three: a three-dot diff needs the merge base, which a depth-1 history does not hold. No renames:
  // with detection on, a `.ts` file under `site/lib/` renamed to a markdown file under `docs/` lists only the markdown
  // side, and a code change would pass as not applicable. Off, a rename is its deletion
  // and its addition.
  const diff = spawnSync("git", ["diff", "--name-only", "--no-renames", base.value, "HEAD"], {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });
  if (diff.status !== 0) {
    say({ line: `git diff against ${base.value} failed: running every spec\n${diff.stderr}` });
    return undefined;
  }
  return diff.stdout.split("\n").filter((line) => line !== "");
}

/**
 * Record the not-applicable pass where a reader of the run sees it: the log, and the job summary when there is one.
 */
function passNotApplicable(): void {
  process.stdout.write(`${NOT_APPLICABLE_LINE}\n`);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined) {
    appendLines({ path: summary, text: NOT_APPLICABLE_LINE });
  }
}

/**
 * Run the lane.
 *
 * @param cwd the repository root
 * @returns the exit code: 0 for a pass or a not-applicable pass, else the failing step's
 */
function runDesktopE2e({ cwd }: { cwd: string }): number {
  const paths = changedPaths({ cwd });
  if (paths !== undefined && !desktopE2eApplicable({ paths })) {
    passNotApplicable();
    return 0;
  }
  // Every step runs under a throwaway state home and cache root: `docs-site.sh` migrates legacy state inside
  // `$SLOPWEAVER_HOME` before it builds, so the operator's own home would be written to. The builds themselves write only into the checkout.
  const home = mkdtempSync(join(tmpdir(), "sw-e2e-lane-home-"));
  const cache = mkdtempSync(join(tmpdir(), "sw-e2e-lane-cache-"));
  const lane = { SLOPWEAVER_CACHE_HOME: cache, SLOPWEAVER_HOME: home };
  const playwright = join(cwd, "node_modules", ".bin", "playwright");
  const steps: readonly { command: string; args: readonly string[]; env: Readonly<Record<string, string>> }[] = [
    ...(process.env["CI"] === "true"
      ? [{ args: ["install", "--with-deps", "chromium"], command: playwright, env: lane }]
      : []),
    { args: ["dev", "build"], command: join(cwd, "bin", "slopweaver"), env: lane },
    { args: [join(cwd, "scripts", "docs-site.sh"), "--build"], command: "bash", env: lane },
    // `#lib/…` subpath imports resolve through tsx's loader, which Playwright's own transform does not install.
    {
      args: ["test", "--config", PLAYWRIGHT_CONFIG],
      command: playwright,
      env: { ...lane, NODE_OPTIONS: "--import tsx" },
    },
  ];
  try {
    for (const step of steps) {
      const status = run({ args: step.args, command: step.command, cwd, env: step.env });
      if (status !== 0) {
        return status;
      }
    }
    return 0;
  } finally {
    rmSync(home, { force: true, recursive: true });
    rmSync(cache, { force: true, recursive: true });
  }
}

process.exit(runDesktopE2e({ cwd: process.cwd() }));
