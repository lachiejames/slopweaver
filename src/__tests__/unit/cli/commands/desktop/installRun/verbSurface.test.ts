/**
 * The edges of `desktop install` that need no fake Mac: the real machine's seams, the verb's argument
 * refusal, its manifest row, and the message a second concurrent install reads.
 */
import { describe, expect, it } from "vitest";

import { DESKTOP_INSTALL_USAGE } from "../../../../../../cli/commands/desktop/desktopUsage.js";
import { runDesktopInstall } from "../../../../../../cli/commands/desktop/installRun.js";
import { machineSeams } from "../../../../../../cli/commands/desktop/installSeams.js";
import { desktopManifest } from "../../../../../../cli/manifests/desktop.js";
import { DesktopInstallErrors } from "../../../../../../desktop/errors.js";

describe("machineSeams", () => {
  it("names this run's hidden folders after its own process", () => {
    expect(machineSeams().nonce).toBe(String(process.pid));
  });
});

describe("runDesktopInstall", () => {
  it("refuses an argument that is not the verb's before touching anything", async () => {
    expect(await runDesktopInstall(["node", "slopweaver", "desktop", "install", "--bogus"])).toBe(2);
  });
});

describe("desktopManifest", () => {
  it("declares install as a local-state verb whose usage is the verb's own", () => {
    expect(desktopManifest["install"]!.meta.effect).toBe("local-state");
    expect(desktopManifest["install"]!.meta.usage).toBe(DESKTOP_INSTALL_USAGE);
  });
});

describe("DesktopInstallErrors", () => {
  it("tells a second install to let the first finish", () => {
    expect(DesktopInstallErrors.installInProgress({ detail: "pid 12" }).message).toBe(
      "could not take the desktop install lock, so this run touched nothing: pid 12 — usually another install is still running, so let it finish",
    );
  });
});
