/**
 * `handover currency --record-reading <by>` over the SHIPPED verb and throwaway homes — the exact argv the console's
 * Queue runs through `/api/sync/currency` (`site/lib/syncVerbs.ts`):
 *
 * - over an empty board it records the document it printed, by `sync-now`, observed at the document's own
 *   `checkedIso`, and `reading last --producer "handover currency"` returns it whole;
 * - without the flag it records nothing;
 * - when the ledger refuses the append it still prints the document, names the refusal on stderr and exits non-zero,
 *   because the sync route reads exit 0 as "the reading was taken".
 *
 * Why a subprocess test: the exit code IS the contract the sync route reads, and only the real launcher produces it.
 * Every state home is a `mkdtemp` passed with `--home`, so nothing reads or writes the operator's own.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const CHECKED = "2026-11-03T09:00:00.000Z";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after the case. */
function scratch({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * Run the shipped CLI. `HOME` stays the real one only because the node toolchain shim resolves through it; the
 * launcher's config file is skipped by a throwaway `XDG_CONFIG_HOME`, and every state read is under `--home`.
 */
function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      TMPDIR: process.env["TMPDIR"]!,
      XDG_CONFIG_HOME: scratch({ prefix: "currency-config-" }),
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { status: result.status!, stderr: result.stderr, stdout: result.stdout };
}

/** The currency verb over an empty board in `home`, with any extra flags. */
function currency({ home, extra }: { home: string; extra: readonly string[] }): ReturnType<typeof run> {
  const handoverDir = join(home, "handovers");
  mkdirSync(handoverDir, { recursive: true });
  return run({
    args: ["handover", "currency", "--json", "--now", CHECKED, "--home", home, "--dir", handoverDir, ...extra],
  });
}

/** `reading last` for the currency producer in `home`. */
function lastCurrency({ home }: { home: string }): ReturnType<typeof run> {
  return run({ args: ["reading", "last", "--producer", "handover currency", "--json", "--home", home] });
}

describe("handover currency --record-reading", () => {
  it("records the document it printed, by sync-now, observed at its own checkedIso", () => {
    const home = scratch({ prefix: "currency-home-" });

    const ran = currency({ extra: ["--record-reading", "sync-now"], home });
    const last = lastCurrency({ home });

    expect(ran.status).toBe(0);
    const printed: unknown = JSON.parse(ran.stdout);
    expect(printed).toMatchObject({ checkedIso: CHECKED, rows: [], schemaVersion: 3 });
    expect(last.status).toBe(0);
    const reading = JSON.parse(last.stdout) as {
      by: string;
      document: unknown;
      observedAtIso: string;
      producer: string;
    };
    expect(reading.by).toBe("sync-now");
    expect(reading.producer).toBe("handover currency");
    expect(reading.observedAtIso).toBe(CHECKED);
    expect(reading.document).toStrictEqual(printed);
    expect(ran.stderr).toContain("handover currency: reading recorded as sync-now");
  });

  it("records nothing without the flag", () => {
    const home = scratch({ prefix: "currency-home-" });

    const ran = currency({ extra: [], home });
    const last = lastCurrency({ home });

    expect(ran.status).toBe(0);
    expect(JSON.parse(ran.stdout)).toMatchObject({ checkedIso: CHECKED });
    // `reading last`'s EXIT_EXPECTED_EMPTY: the pipeline ran, and there is no reading to return.
    expect(last.status).toBe(3);
    expect(last.stdout).toBe("");
  });

  it("still prints the document, names the refusal and exits 1 when the ledger will not take it", () => {
    const home = scratch({ prefix: "currency-home-" });
    // The producer's document directory is a file: the ledger's index still reads (so the board reads whole and the
    // document is built), and the document cannot be written under it.
    mkdirSync(join(home, "readings"));
    writeFileSync(join(home, "readings", "handover-currency"), "not a directory");

    const ran = currency({ extra: ["--record-reading", "sync-now"], home });
    const last = lastCurrency({ home });

    expect(ran.status).toBe(1);
    expect(JSON.parse(ran.stdout)).toMatchObject({ checkedIso: CHECKED, rows: [] });
    expect(ran.stderr).toContain("handover currency: the reading was not recorded — ");
    expect(ran.stderr).not.toContain("reading recorded as sync-now");
    // No row was appended: `reading last` still has nothing to return.
    expect(last.status).toBe(3);
    expect(last.stdout).toBe("");
  });
});
