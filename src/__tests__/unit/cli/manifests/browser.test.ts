/**
 * The `browser` noun's manifest rows in `cli/manifests/browser.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { BROWSER_USAGE } from "../../../../cli/commands/browser/usage.js";
import { browserManifest } from "../../../../cli/manifests/browser.js";
import { browserPictureManifest } from "../../../../cli/manifests/browserPictures.js";

describe("browserManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(browserManifest["act"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["aim"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["annotate"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["break-glass"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["close"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["console-shot"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["cookies"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["image-record"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["open"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["pin"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["read"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["profile"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["scroll"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["sessions"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["shot"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["terminal-shot"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["redact"]!.meta.usage).toBe(BROWSER_USAGE);
    expect(browserManifest["verdicts"]!.meta.usage).toBe(BROWSER_USAGE);
  });

  it("carries every picture verb from `browserPictures.ts` under its own name, the same row", () => {
    expect(Object.keys(browserPictureManifest).toSorted()).toEqual([
      "annotate",
      "console-shot",
      "image-record",
      "redact",
      "shot",
      "terminal-shot",
    ]);
    expect(browserManifest["console-shot"]).toBe(browserPictureManifest["console-shot"]);
    expect(browserManifest["shot"]).toBe(browserPictureManifest["shot"]);
  });
});
