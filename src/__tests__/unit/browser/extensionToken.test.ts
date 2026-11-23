/**
 * The consent token read, over a real temp home rather than the owner's own.
 *
 * Two properties carry the whole file and both are about what must NOT happen: a token whose file anyone
 * else can read is refused rather than used, and no refusal ever carries the token's own value — only the
 * FILE. Everything else here is the shape of the refusal a reader has to act on.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { browserErrorLines } from "../../../browser/browserErrors.js";
import { readExtensionToken } from "../../../browser/extensionToken.js";
import { secretFilePath } from "../../../stateHome.js";

const TOKEN = "a-fake-consent-token-value";

describe("readExtensionToken", () => {
  let home: string;
  let path: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "extension-token-"));
    path = secretFilePath({ home, name: "playwright-extension-token" });
    mkdirSync(dirname(path), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Write the token file at a chosen mode, which is the whole subject of half these tests. */
  function writeToken({ value, mode }: { value: string; mode: number }): void {
    writeFileSync(path, value, "utf8");
    chmodSync(path, mode);
  }

  it("reads the token the owner wrote", () => {
    writeToken({ mode: 0o600, value: TOKEN });
    expect(unwrap(readExtensionToken({ home }))).toBe(TOKEN);
  });

  it("trims the newline a text editor leaves behind", () => {
    writeToken({ mode: 0o600, value: `${TOKEN}\n` });
    expect(unwrap(readExtensionToken({ home }))).toBe(TOKEN);
  });

  it("accepts a mode stricter than 0600", () => {
    writeToken({ mode: 0o400, value: TOKEN });
    expect(unwrap(readExtensionToken({ home }))).toBe(TOKEN);
  });

  // The token is what lets a walk run without a dialog asking whether to expose every signed-in session,
  // so a file another account can read is a refusal rather than a warning.
  it("REFUSES a token file the group can read", () => {
    writeToken({ mode: 0o640, value: TOKEN });
    expect(browserErrorLines({ error: unwrapErr(readExtensionToken({ home })) })[0]).toContain("owner-only");
  });

  it("REFUSES a token file the world can read", () => {
    writeToken({ mode: 0o604, value: TOKEN });
    expect(browserErrorLines({ error: unwrapErr(readExtensionToken({ home })) })[0]).toContain("owner-only");
  });

  it("names the FILE in that refusal, so the operator knows what to chmod", () => {
    writeToken({ mode: 0o644, value: TOKEN });
    expect(browserErrorLines({ error: unwrapErr(readExtensionToken({ home })) })[0]).toContain(path);
  });

  it("never carries the token's own value into a mode refusal", () => {
    writeToken({ mode: 0o644, value: TOKEN });
    expect(browserErrorLines({ error: unwrapErr(readExtensionToken({ home })) })[0]).not.toContain(TOKEN);
  });

  it("refuses an empty token rather than handing one back", () => {
    writeToken({ mode: 0o600, value: "" });
    expect(browserErrorLines({ error: unwrapErr(readExtensionToken({ home })) })[0]).toContain("empty");
  });

  it("refuses a token that is only whitespace", () => {
    writeToken({ mode: 0o600, value: "   \n" });
    expect(browserErrorLines({ error: unwrapErr(readExtensionToken({ home })) })[0]).toContain("empty");
  });

  it("says the walk needs it, and who writes it, when there is no token at all", () => {
    const missing = readExtensionToken({ home });
    expect(browserErrorLines({ error: unwrapErr(missing) })[0]).toContain("could not read");
    expect(browserErrorLines({ error: unwrapErr(missing) })[1]).toContain("written once, by the owner");
  });

  // O_NOFOLLOW is the reason: a symlink is how a token read gets pointed at a file whose mode was checked
  // somewhere else entirely.
  it("refuses to follow a symlink standing where the token should be", () => {
    const elsewhere = join(home, "elsewhere");
    writeFileSync(elsewhere, TOKEN, { mode: 0o600 });
    symlinkSync(elsewhere, path);
    expect(browserErrorLines({ error: unwrapErr(readExtensionToken({ home })) })).toEqual([
      `could not read the Playwright extension token at ${path}: ` +
        `ELOOP: too many symbolic links encountered, open '${path}'`,
      "the browser walk needs it; it is written once, by the owner, from the extension's own connect dialog",
    ]);
  });
});
