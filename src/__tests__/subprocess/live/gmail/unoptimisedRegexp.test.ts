/**
 * The Gmail sanitiser's inline-image check, run in a child whose V8 compiles every regular expression unoptimised —
 * the mode a long-lived process falls into by ordinary work (`src/lib/base64Run.ts` carries the mechanism). A received
 * mail's inline image runs to millions of base64 characters, and the check it replaced, a regex quantified over the
 * whole body, threw `RangeError: Maximum call stack size exceeded` there.
 *
 * This cannot live on the unit lane: the mode is a process-wide V8 flag, `--no-regexp-optimization`, and a unit test
 * cannot start a process or set a flag for the fork it shares.
 *
 * The falsifiable half is the CONTROL. A green read of the check alone would also be green on a V8 that ignored the
 * flag, so the same child first runs the replaced regex over the same source and the case asserts it throws there —
 * proving the child really is in the mode the check is being judged in.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const ALLOWLIST = join(repoRoot, "src", "live", "gmail", "mailHtmlAllowlist.ts");

/** The TypeScript loader, handed to `node` directly — `../../lib/stdoutDataChannel.test.ts` § TSX_LOADER. */
const TSX_LOADER = import.meta.resolve("tsx");

/** An inline image's base64 body: four million characters, past the run the unoptimised backtrack stack holds. */
const BODY_CHARS = 4 * 1024 * 1024;

/** A deadline rather than a request: a hung child fails loudly. */
const CHILD_DEADLINE_MS = 60_000;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A child script printing the control's outcome and the check's answer on a whole body and on one corrupted mid-body. */
function writeProbe(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-gmail-regexp-"));
  fixtureDirs.push(dir);
  // `.mts`: the temp dir has no `"type": "module"` package above it, and the top-level `await` needs ESM.
  const script = join(dir, "probe.mts");
  writeFileSync(
    script,
    [
      `const { isKeptDataImage } = await import(${JSON.stringify(ALLOWLIST)});`,
      `const body = "A".repeat(${String(BODY_CHARS)});`,
      `const source = "data:image/png;base64," + body;`,
      `const middle = ${String(BODY_CHARS / 2)};`,
      `const corrupted = "data:image/png;base64," + body.slice(0, middle) + "!" + body.slice(middle + 1);`,
      `let control = "no throw";`,
      `try { /^data:image\\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/=\\s]+$/i.test(source); } catch (e) { control = String(e); }`,
      `process.stdout.write(JSON.stringify({`,
      `  accepted: isKeptDataImage({ source }),`,
      `  control,`,
      `  rejected: isKeptDataImage({ source: corrupted }),`,
      `}));`,
    ].join("\n"),
  );
  return script;
}

/** Every child's environment, with `NODE_OPTIONS` removed — `../../lib/stdoutDataChannel.test.ts` § emitterEnv. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  return env;
}

describe("the Gmail inline-image check under unoptimised regexp compilation", () => {
  it("keeps a four-million-character body and refuses one bad character in it, where the replaced regex throws", () => {
    const child = spawnSync(process.execPath, ["--no-regexp-optimization", "--import", TSX_LOADER, writeProbe()], {
      cwd: repoRoot,
      encoding: "utf8",
      env: childEnv(),
      killSignal: "SIGKILL",
      timeout: CHILD_DEADLINE_MS,
    });

    expect(child.error).toBe(undefined);
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      accepted: true,
      control: "RangeError: Maximum call stack size exceeded",
      rejected: false,
    });
  });
});
