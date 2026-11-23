import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkE2eBundle } from "../../../../../cli/commands/desktop/e2eBundle.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const BASE = "<key>SlopweaverDesktopE2EProtocol</key><string>2</string>";
const MENU_BAR = "<key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string>";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { force: true, recursive: true });
});

/** A bundle under a throwaway directory whose Info.plist carries `entries`, or has no Info.plist when absent. */
function bundle({ entries }: { entries: string | undefined }): string {
  const root = mkdtempSync(join(tmpdir(), "e2e-bundle-"));
  made.push(root);
  const app = join(root, "Candidate.app");
  mkdirSync(join(app, "Contents"), { recursive: true });
  if (entries !== undefined) {
    writeFileSync(join(app, "Contents", "Info.plist"), `<plist><dict>${entries}</dict></plist>`);
  }
  return app;
}

describe("checkE2eBundle", () => {
  it("launches a current bundle, with or without the menu bar icon", () => {
    const app = bundle({ entries: `${BASE}${MENU_BAR}` });
    expect(unwrap(checkE2eBundle({ app, menuBar: true }))).toBeUndefined();
    expect(unwrap(checkE2eBundle({ app, menuBar: false }))).toBeUndefined();
  });

  it("refuses a path with no Info.plist as missing, naming the bundle", () => {
    const app = bundle({ entries: undefined });
    const error = unwrapErr(checkE2eBundle({ app, menuBar: false }));
    expect(error.code).toBe("BUNDLE_MISSING");
    expect(error.message).toContain(app);
  });

  it("refuses a bundle from before the test switch, whatever the menu bar asked", () => {
    const app = bundle({ entries: "<key>CFBundleName</key><string>Slopweaver</string>" });
    expect(unwrapErr(checkE2eBundle({ app, menuBar: false })).code).toBe("UNSUPPORTED_BUILD");
    expect(unwrapErr(checkE2eBundle({ app, menuBar: true })).code).toBe("UNSUPPORTED_BUILD");
  });

  it("launches a base-protocol bundle without the icon, and refuses it the icon", () => {
    const app = bundle({ entries: BASE });
    expect(unwrap(checkE2eBundle({ app, menuBar: false }))).toBeUndefined();
    expect(unwrapErr(checkE2eBundle({ app, menuBar: true })).code).toBe("UNSUPPORTED_MENU_BAR_BUILD");
  });
});
