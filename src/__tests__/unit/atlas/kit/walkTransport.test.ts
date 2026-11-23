/**
 * What every atlas walk resolves BEFORE a browser is involved — and what it refuses to resolve without.
 *
 * Nothing here launches or reaches a browser, and that is the subject rather than a limitation: both
 * refusals below fire before `createPlaywrightCliTransport` is ever called, so a walk missing its consent
 * token or its recorded profile stops rather than opening the connect page in whichever profile Chrome was
 * last used in. That is the whole reason the pin is resolved here.
 *
 * The SUCCESS path is deliberately not asserted, and the reason is the testing rule rather than an
 * omission: it ends in `chromeExecutablePath`, which asks Playwright's registry where Chrome is on THIS
 * machine. A test that tolerated either answer would be a test that cannot fail. `profilePin.test.ts`
 * covers the pin script itself, which is the part that is a fact about the code.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";
import { relayDepsFor } from "../../../../atlas/kit/walkTransport.js";
import { secretFilePath } from "../../../../stateHome.js";
import { memoryRecordedProfilePort } from "../../../recordedProfileFixture.js";

describe("relayDepsFor refuses before it reaches a browser", () => {
  let home: string;
  let directory: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "walk-transport-"));
    directory = join(home, "generation");
    mkdirSync(directory, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Write the consent token the owner provisions by hand, at the mode the reader demands. */
  function provisionToken(): void {
    const path = secretFilePath({ home, name: "playwright-extension-token" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "a-fake-consent-token-value", "utf8");
    chmodSync(path, 0o600);
  }

  const deps = () =>
    relayDepsFor({
      directory,
      home,
      origins: ["https://app.vanta.com"],
      platform: "vanta",
      profiles: memoryRecordedProfilePort(),
    });

  it("refuses with no consent token, before anything is launched", async () => {
    expect(unwrapErr(await deps())[0]).toContain("could not read the Playwright extension token");
  });

  // The order is the point: a missing token is reported even though the profile is ALSO missing, because
  // the token is what is read first and a reader should be given one fix at a time.
  it("does not make the scratch directory when it refuses on the token", async () => {
    await deps();
    expect(existsSync(join(directory, "_walk"))).toBe(false);
  });

  it("refuses with a token but no recorded profile, rather than guessing one", async () => {
    provisionToken();
    expect(unwrapErr(await deps())[0]).toContain("no Chrome profile has been recorded");
  });

  it("sends the operator to the verb that records a profile", async () => {
    provisionToken();
    expect(unwrapErr(await deps())[0]).toContain("slopweaver browser profile --list");
  });

  // MEASURED by this test's own arrangement: the scratch is made before the pin is resolved, so a walk
  // that refuses on the profile still leaves the directory it will use when the operator fixes it.
  it("makes its scratch directory under the caller's own, never under home", async () => {
    provisionToken();
    await deps();
    expect(existsSync(join(directory, "_walk"))).toBe(true);
  });
});
