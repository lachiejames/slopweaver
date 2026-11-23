/**
 * The JumpCloud credential resolver, over a throwaway home and an injected environment.
 *
 * Both refusals fire before any call, so each asserts the exact line the CLI prints — and the order case
 * proves the optional organisation id is read, and a loose one refused, before the key is looked for.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveJumpcloudCredentials } from "../../../../atlas/jumpcloud/credentials.js";
import { unwrapErr } from "../../../../lib/result.js";

const homes: string[] = [];

/** A throwaway state home with a `secrets/` directory, removed in afterEach. */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-jc-cred-"));
  mkdirSync(join(home, "secrets"), { mode: 0o700, recursive: true });
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("resolveJumpcloudCredentials", () => {
  it("names the one secret to set when no API key is configured", () => {
    expect(unwrapErr(resolveJumpcloudCredentials({ env: {}, home: makeHome() }))).toEqual([
      "the JumpCloud atlas is not configured: jumpcloud-api-key is required. Set it with: slopweaver secrets set jumpcloud-api-key",
    ]);
  });

  it("refuses a loose organisation-id file before it ever looks for the key", () => {
    const home = makeHome();
    const path = join(home, "secrets", "jumpcloud-org-id");
    writeFileSync(path, "org-example", { mode: 0o644 });
    chmodSync(path, 0o644);
    expect(unwrapErr(resolveJumpcloudCredentials({ env: {}, home }))).toEqual([
      `secrets/jumpcloud-org-id must be owner-only (mode 0600 or stricter): ${path}`,
    ]);
  });
});
