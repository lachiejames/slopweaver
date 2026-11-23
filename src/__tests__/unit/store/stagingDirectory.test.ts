/**
 * Every staging directory is made below the staging root through no link: a planted `recover`, `retrieved` or
 * per-run `<instant>` link, existing or dangling, is refused before anything is written through it.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { BackupErrors } from "../../../store/backup/errors.js";
import { stagingRoot } from "../../../store/backup/staging.js";
import { makeStagingDirectory } from "../../../store/backup/stagingDirectory.js";

const dirs: string[] = [];

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A fresh home and, beside it, a directory standing in for the backup destination.
 *
 * @returns both paths
 */
function sandbox(): { home: string; destination: string } {
  const parent = mkdtempSync(join(tmpdir(), "staging-directory-"));
  dirs.push(parent);
  const destination = join(parent, "destination");
  mkdirSync(destination);
  return { destination, home: join(parent, "home") };
}

describe("makeStagingDirectory", () => {
  it("makes every segment below the staging root as a real directory", () => {
    const { home } = sandbox();
    const directory = join(stagingRoot({ home }), "recover", "slopweaver_2026-11-04T00-00-00-000Z");

    expect(makeStagingDirectory({ directory, home }).isOk()).toBe(true);
    expect(lstatSync(directory).isDirectory()).toBe(true);
    expect(lstatSync(join(stagingRoot({ home }), "recover")).isSymbolicLink()).toBe(false);
  });

  it("accepts a real directory already there when fresh is not asked for", () => {
    const { home } = sandbox();
    const directory = join(stagingRoot({ home }), "retrieved", "slopweaver_x");
    mkdirSync(directory, { recursive: true });

    expect(makeStagingDirectory({ directory, home }).isOk()).toBe(true);
  });

  it("refuses a link at an intermediate segment and writes nothing into its target", () => {
    const { home, destination } = sandbox();
    mkdirSync(stagingRoot({ home }), { recursive: true });
    const link = join(stagingRoot({ home }), "recover");
    symlinkSync(destination, link);

    const result = makeStagingDirectory({ directory: join(link, "slopweaver_x"), home });

    expect(unwrapErr(result)).toEqual(
      BackupErrors.stepFailed({
        reasons: [`${link} is a link or not a directory; staging never writes through one — remove it and re-run`],
      }),
    );
    expect(readdirSync(destination)).toEqual([]);
  });

  it("refuses a dangling link at the last segment", () => {
    const { home, destination } = sandbox();
    mkdirSync(stagingRoot({ home }), { recursive: true });
    const link = join(stagingRoot({ home }), "2026-11-04T03-00-00-000Z");
    symlinkSync(join(destination, "not-yet"), link);

    const result = makeStagingDirectory({ directory: link, fresh: true, home });

    expect(unwrapErr(result)).toEqual(
      BackupErrors.stepFailed({
        reasons: [`${link} is a link or not a directory; staging never writes through one — remove it and re-run`],
      }),
    );
    expect(existsSync(join(destination, "not-yet"))).toBe(false);
  });

  it("refuses a fresh directory something else already made", () => {
    const { home } = sandbox();
    const directory = join(stagingRoot({ home }), "2026-11-04T03-00-00-000Z");
    mkdirSync(directory, { recursive: true });

    const result = makeStagingDirectory({ directory, fresh: true, home });

    expect(unwrapErr(result)).toEqual(
      BackupErrors.stepFailed({
        reasons: [`${directory} already exists; this run's staging must be made by this run — remove it and re-run`],
      }),
    );
  });

  it("refuses a path that steps through a link with `..`, which normalising would have hidden", () => {
    const { home, destination } = sandbox();
    mkdirSync(join(destination, "child"));
    mkdirSync(join(destination, "escape"));
    mkdirSync(stagingRoot({ home }), { recursive: true });
    symlinkSync(join(destination, "child"), join(stagingRoot({ home }), "link"));
    const directory = `${stagingRoot({ home })}/link/../escape`;

    const result = makeStagingDirectory({ directory, fresh: true, home });

    expect(unwrapErr(result)).toEqual(
      BackupErrors.stepFailed({ reasons: [`${directory} carries a . or .. segment; staging names a path plainly`] }),
    );
    expect(existsSync(join(stagingRoot({ home }), "escape"))).toBe(false);
  });

  it("refuses a directory that is not below the staging root", () => {
    const { home, destination } = sandbox();

    const result = makeStagingDirectory({ directory: destination, home });

    expect(unwrapErr(result)).toEqual(
      BackupErrors.stepFailed({ reasons: [`${destination} is not below the staging root ${stagingRoot({ home })}`] }),
    );
  });
});
