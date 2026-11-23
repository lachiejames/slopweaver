/**
 * The lock verb's reads of its checkout: which stack a checkout's config names, and which checkout a run measures.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { readStack, workdirOf } from "../../../../../cli/commands/store/lockRun.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A checkout holding only the config the lock reads, or nothing when `config` is absent. */
function checkout({ config }: { config: string | undefined }): string {
  const dir = mkdtempSync(join(tmpdir(), "lockrun-"));
  dirs.push(dir);
  if (config !== undefined) {
    mkdirSync(join(dir, "supabase"));
    writeFileSync(join(dir, "supabase", "config.toml"), config);
  }
  return dir;
}

describe("readStack", () => {
  it("reads the stack a checkout's supabase/config.toml names", () => {
    const workdir = checkout({ config: 'project_id = "acme"\n\n[db]\nport = 56522\n' });
    expect(unwrap(readStack({ workdir }))).toEqual({ dbPort: 56522, projectId: "acme" });
  });

  it("refuses a checkout with no Supabase config as not a local stack", () => {
    const error = unwrapErr(readStack({ workdir: checkout({ config: undefined }) }));
    expect(error.code).toBe("NOT_LOCAL_STACK");
    expect(error.message).toContain("supabase/config.toml could not be read");
  });
});

describe("workdirOf", () => {
  it("measures the checkout the caller named", () => {
    expect(workdirOf({ workdir: "/checkouts/acme" })).toBe("/checkouts/acme");
  });
});
