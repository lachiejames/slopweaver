/*
 * `codex signin`'s auth read over an empty Codex home — unreadable rather than a throw, and a sign-in hint that
 * never names a Slopweaver verb.
 */
import { describe, expect, it } from "vitest";
import { readCodexAuth, renderCodexAuth } from "../../../../codex/auth.js";
import { emptyCodexHome, useGaugeRunHomes } from "./harness.js";

useGaugeRunHomes();

describe("readCodexAuth", () => {
  it("reports an absent auth file as unreadable rather than throwing", () => {
    const report = readCodexAuth({ codexHome: emptyCodexHome() });

    expect(report.readable).toBe(false);
    expect(report.hasTokens).toBe(false);
    expect(report.authMode).toBeUndefined();
  });

  it("points an unsigned-in reader at Settings → Models or their own terminal, never at a Slopweaver verb", () => {
    const lines = renderCodexAuth({ report: readCodexAuth({ codexHome: emptyCodexHome() }) });

    expect(lines.join(" ")).toContain("Settings → Models in the console, or with `codex login` in your own terminal");
  });
});
