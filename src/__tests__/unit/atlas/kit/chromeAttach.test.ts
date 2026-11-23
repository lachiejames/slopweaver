import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveChromeAttachment } from "../../../../atlas/kit/chromeAttach.js";
import { BrowserErrors, browserErrorLines } from "../../../../browser/browserErrors.js";
import { RealChromeErrors } from "../../../../browser/errors.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { secretFilePath, stateHomePaths } from "../../../../stateHome.js";
import { memoryRecordedProfilePort } from "../../../recordedProfileFixture.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "chrome-attach-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write the extension token the owner provisions, at the mode the reader demands unless told otherwise. */
function provisionToken({ value, mode }: { value: string; mode: number }): string {
  const path = secretFilePath({ home, name: "playwright-extension-token" });
  mkdirSync(join(home, "secrets"), { recursive: true });
  writeFileSync(path, value);
  chmodSync(path, mode);
  return path;
}

describe("resolveChromeAttachment", () => {
  it("refuses with the token reader's own lines when the token is readable by others", async () => {
    const path = provisionToken({ mode: 0o644, value: "consent-token" });

    expect(unwrapErr(await resolveChromeAttachment({ home, profiles: memoryRecordedProfilePort() }))).toEqual(
      browserErrorLines({ error: BrowserErrors.extensionTokenNotOwnerOnly({ path }) }),
    );
  });

  it("refuses an empty token before it ever looks for the Chrome pin", async () => {
    const path = provisionToken({ mode: 0o600, value: "  \n" });

    expect(unwrapErr(await resolveChromeAttachment({ home, profiles: memoryRecordedProfilePort() }))).toEqual(
      browserErrorLines({ error: BrowserErrors.extensionTokenEmpty({ path }) }),
    );
  });

  it("hands back the token and the pin resolved through the profiles port it was given", async () => {
    provisionToken({ mode: 0o600, value: "  consent-token\n" });
    const profiles = memoryRecordedProfilePort();
    const asked: { home: string; path: string; profiles: unknown }[] = [];

    const attached = await resolveChromeAttachment({
      home,
      profiles,
      resolvePin: async (input) => {
        asked.push(input);
        return ok(input.path);
      },
    });

    expect(unwrap(attached)).toEqual({
      chromePinPath: stateHomePaths({ home }).chromePin,
      extensionToken: "consent-token",
    });
    expect(asked).toEqual([{ home, path: stateHomePaths({ home }).chromePin, profiles }]);
  });

  it("never asks for the pin when the token is refused", async () => {
    provisionToken({ mode: 0o644, value: "consent-token" });
    const asked: unknown[] = [];

    unwrapErr(
      await resolveChromeAttachment({
        home,
        profiles: memoryRecordedProfilePort(),
        resolvePin: async (input) => {
          asked.push(input);
          return ok(input.path);
        },
      }),
    );

    expect(asked).toEqual([]);
  });

  it("refuses with the pin's one message when the token is held but no work profile is recorded", async () => {
    provisionToken({ mode: 0o600, value: "consent-token" });

    expect(unwrapErr(await resolveChromeAttachment({ home, profiles: memoryRecordedProfilePort() }))).toEqual([
      RealChromeErrors.profileUnset().message,
    ]);
  });
});
