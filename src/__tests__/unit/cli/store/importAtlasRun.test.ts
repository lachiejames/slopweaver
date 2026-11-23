/**
 * `store import-atlas`'s shell, driven end to end against a temp home.
 *
 * Every case runs under `--dry-run`, which is the whole reason the shell is reachable from a unit test at
 * all: it opens no connection, so what is exercised here is the real argument parsing, the real platform
 * selection and the real envelope projection, with only the write suppressed.
 *
 * The home is minted with `mkdtempSync` and passed explicitly with `--home`, per
 * `.claude/rules/testing.md` — the ambient `$SLOPWEAVER_HOME` is never written to.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runImportAtlas } from "../../../../cli/commands/store/importAtlasRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";

/** Every home this file has minted, so `afterEach` can remove them. */
const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home whose atlas tree holds one registered platform's generation. */
function freshHome({ withGeneration = true }: { withGeneration?: boolean } = {}): string {
  const home = mkdtempSync(join(tmpdir(), "import-atlas-"));
  homes.push(home);
  mkdirSync(join(home, "atlas"), { recursive: true });
  if (!withGeneration) {
    return home;
  }
  const vanta = join(home, "atlas", "vanta");
  mkdirSync(vanta, { recursive: true });
  const envelope = JSON.stringify({
    coverage: [
      {
        lastSuccessAt: "2026-09-19T17:40:04.640Z",
        latestAttemptFailed: false,
        reason: "read 1 control",
        scope: "tenant/control",
        state: "synced",
        unblockedBy: null,
        visibilityScope: "one Vanta tenant",
      },
    ],
    entities: [],
    gaps: [],
    kind: "control",
    platform: "vanta",
    schemaVersion: 4,
    updatedAt: "2026-09-19T17:40:04.640Z",
  });
  const entity = JSON.stringify({
    channels: {
      "manage-api": {
        channel: "manage-api",
        detail: { name: "MFA" },
        firstSeenAt: "2026-09-19T17:40:04.640Z",
        lastSeenAt: "2026-09-19T17:40:04.640Z",
        source: {
          artifacts: [],
          channel: "manage-api",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: "/v1/controls",
          observedAt: "2026-09-19T17:40:04.640Z",
        },
        state: "observed",
      },
    },
    id: "c1",
    kind: "control",
    providerId: "control-mfa",
  });
  writeFileSync(join(vanta, "controls.jsonl"), `${envelope}\n${entity}\n`);
  // Excluded by the import: sync progress, not atlas content. A real one can run to hundreds of megabytes.
  writeFileSync(join(vanta, "_resume.jsonl"), '{"at":"now"}\n');
  return home;
}

/** The argv shape the router hands the verb. */
function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "store", "import-atlas", ...tail];
}

describe("runImportAtlas", () => {
  it("exits OK on --help", async () => {
    await expect(runImportAtlas(argv({ tail: ["--help"] }))).resolves.toBe(EXIT_OK);
  });

  it("refuses an argument it does not have, before touching anything", async () => {
    await expect(runImportAtlas(argv({ tail: ["--everything"] }))).resolves.toBe(EXIT_USAGE);
  });

  it("dry-runs a real generation to OK, opening no connection", async () => {
    const home = freshHome();

    await expect(runImportAtlas(argv({ tail: ["--dry-run", "--home", home] }))).resolves.toBe(EXIT_OK);
  });

  it("dry-runs one named platform to OK", async () => {
    const home = freshHome();

    await expect(runImportAtlas(argv({ tail: ["--dry-run", "--platform", "vanta", "--home", home] }))).resolves.toBe(
      EXIT_OK,
    );
  });

  it("reports an empty plan as an error rather than as a clean run of nothing", async () => {
    const home = freshHome({ withGeneration: false });

    await expect(runImportAtlas(argv({ tail: ["--dry-run", "--home", home] }))).resolves.toBe(EXIT_ERROR);
  });

  it("reports a named platform with no generation as an error", async () => {
    const home = freshHome();

    await expect(runImportAtlas(argv({ tail: ["--dry-run", "--platform", "linear", "--home", home] }))).resolves.toBe(
      EXIT_ERROR,
    );
  });

  it("exits non-zero when a kind file's envelope cannot be read", async () => {
    const home = freshHome();
    writeFileSync(join(home, "atlas", "vanta", "broken.jsonl"), "not json at all\n");

    await expect(runImportAtlas(argv({ tail: ["--dry-run", "--home", home] }))).resolves.toBe(EXIT_ERROR);
  });

  it("exits non-zero when an envelope names a platform other than its own directory", async () => {
    const home = freshHome();
    writeFileSync(
      join(home, "atlas", "vanta", "stray.jsonl"),
      `${JSON.stringify({
        coverage: [],
        entities: [],
        gaps: [],
        kind: "stray",
        platform: "cloudflare",
        updatedAt: "2026-09-19T17:40:04.640Z",
      })}\n`,
    );

    await expect(runImportAtlas(argv({ tail: ["--dry-run", "--home", home] }))).resolves.toBe(EXIT_ERROR);
  });
});
