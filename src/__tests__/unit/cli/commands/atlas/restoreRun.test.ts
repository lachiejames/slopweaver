/**
 * The `atlas <platform> restore` shell: which platforms it answers for, how a refused tail is reported, and
 * what its list mode prints off a real archive root under a temp home.
 *
 * Every edge is an injected plain function; the run's instant is passed in, so no clock is read. Restore
 * mode is not driven here — it asks the platform's own reader about the live generation first.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { atlasPlatforms } from "../../../../../atlas/registry.js";
import { AtlasCommandErrors } from "../../../../../cli/commands/atlas/errors.js";
import { atlasRestoreUsage } from "../../../../../cli/commands/atlas/restoreCore.js";
import { type AtlasRestoreDeps, runAtlasRestore } from "../../../../../cli/commands/atlas/restoreRun.js";

const AT = "2026-10-13T00:00:00.000Z";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh, empty state home that `afterEach` removes. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "restore-run-"));
  homes.push(home);
  return home;
}

/** Deps that capture both streams. */
function capturingDeps(): { deps: AtlasRestoreDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

/** The argv a `slopweaver atlas <platform> restore ...` invocation carries. */
function argvFor({ platform, tail }: { platform: string; tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", platform, "restore", ...tail];
}

describe("runAtlasRestore", () => {
  it("refuses an unregistered platform with exit 2 and names every platform this build has", async () => {
    const { deps, out, diagnostics } = capturingDeps();
    const code = await runAtlasRestore({ argv: argvFor({ platform: "no-such-platform", tail: [] }), at: AT, deps });
    expect(code).toBe(2);
    expect(atlasPlatforms()).toContain("inngest");
    expect(diagnostics).toEqual([
      'slopweaver atlas restore: unknown platform "no-such-platform"',
      `every platform this build has: ${atlasPlatforms().join(", ")}`,
    ]);
    expect(out).toEqual([]);
  });

  it("refuses an argv that stops before the platform position with exit 2", async () => {
    const { deps, diagnostics } = capturingDeps();
    const code = await runAtlasRestore({ argv: ["node", "slopweaver", "atlas"], at: AT, deps });
    expect(code).toBe(2);
    expect(diagnostics).toEqual([
      'slopweaver atlas restore: unknown platform "undefined"',
      `every platform this build has: ${atlasPlatforms().join(", ")}`,
    ]);
  });

  it("refuses --confirm without --archive with exit 2, the error line and the usage block", async () => {
    const { deps, out, diagnostics } = capturingDeps();
    const home = tempHome();
    const code = await runAtlasRestore({
      argv: argvFor({ platform: "inngest", tail: ["--home", home, "--confirm", "archive-current"] }),
      at: AT,
      deps,
    });
    expect(code).toBe(2);
    expect(diagnostics).toEqual([
      AtlasCommandErrors.restoreConfirmWithoutArchive().message,
      atlasRestoreUsage({ platform: "inngest" }),
    ]);
    expect(diagnostics[0]).toBe("--confirm names an archive to install, so it needs --archive <archive-id> beside it");
    expect(out).toEqual([]);
  });

  it("lists an empty archive root with exit 0 and creates no file under the home", async () => {
    const { deps, out, diagnostics } = capturingDeps();
    const home = tempHome();
    const code = await runAtlasRestore({
      argv: argvFor({ platform: "inngest", tail: ["--home", home] }),
      at: AT,
      deps,
    });
    expect(code).toBe(0);
    expect(out).toEqual([
      "no archived inngest generation — `atlas inngest reset --confirm archive` is what creates one",
    ]);
    expect(diagnostics).toEqual([]);
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("lists seeded archives newest first, an unreadable one included, with the command that installs one", async () => {
    const { deps, out, diagnostics } = capturingDeps();
    const home = tempHome();
    const root = join(home, "atlas", "_superseded", "inngest");
    const readable = join(root, "2026-09-10T12-22-29.229Z");
    mkdirSync(readable, { recursive: true });
    writeFileSync(
      join(readable, "manifest.json"),
      JSON.stringify({
        kinds: { app: { digest: null, entityCount: 3 }, function: { digest: null, entityCount: 4 } },
        schemaVersion: 2,
        updatedAt: "2026-09-10T12:00:00.000Z",
      }),
    );
    mkdirSync(join(root, "2026-09-11T08-00-00.000Z"), { recursive: true });

    const code = await runAtlasRestore({
      argv: argvFor({ platform: "inngest", tail: ["--home", home] }),
      at: AT,
      deps,
    });
    expect(code).toBe(0);
    expect(out).toEqual([
      "2 archived inngest generation(s), newest first:",
      "  2026-09-11T08-00-00.000Z  unreadable",
      "  2026-09-10T12-22-29.229Z  schema 2 · 7 entities · 2026-09-10T12:00:00.000Z",
      "",
      "restore one: slopweaver atlas inngest restore --archive <archive-id> --confirm archive-current",
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("prints the listing as one JSON document under --json", async () => {
    const { deps, out, diagnostics } = capturingDeps();
    const home = tempHome();
    const archive = join(home, "atlas", "_superseded", "inngest", "2026-09-11T08-00-00.000Z");
    mkdirSync(archive, { recursive: true });

    const code = await runAtlasRestore({
      argv: argvFor({ platform: "inngest", tail: ["--home", home, "--json"] }),
      at: AT,
      deps,
    });
    expect(code).toBe(0);
    expect(out.length).toBe(1);
    expect(JSON.parse(out[0]!)).toEqual([
      { archiveId: "2026-09-11T08-00-00.000Z", entityCount: null, path: archive, schemaVersion: null, updatedAt: null },
    ]);
    expect(diagnostics).toEqual([]);
  });
});
