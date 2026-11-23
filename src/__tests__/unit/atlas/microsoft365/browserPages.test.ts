import { describe, expect, it } from "vitest";

import {
  MICROSOFT365_BROWSER_PAGES,
  MICROSOFT365_CONSOLE_ORIGINS,
  microsoft365ConsoleIsFragmentRouted,
  microsoft365PageUrl,
} from "../../../../atlas/microsoft365/browserPages.js";

describe("MICROSOFT365_BROWSER_PAGES", () => {
  it("has at least one entry in MICROSOFT365_BROWSER_PAGES, so the guards below are not vacuously green", () => {
    expect(MICROSOFT365_BROWSER_PAGES.length).toBeGreaterThan(0);
  });

  it("names every page uniquely, because the surface name is its provider key", () => {
    const surfaces = MICROSOFT365_BROWSER_PAGES.map((page) => page.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("declares pages across every console it lists, so no console is a declaration with nothing under it", () => {
    const consoles = new Set(MICROSOFT365_BROWSER_PAGES.map((page) => page.console));
    for (const name of Object.keys(MICROSOFT365_CONSOLE_ORIGINS)) {
      expect([...consoles]).toContain(name);
    }
    expect([...consoles]).toContain("tenant-root");
  });

  it("gives every page a description a reader learns something from", () => {
    for (const page of MICROSOFT365_BROWSER_PAGES) {
      expect(page.description.length).toBeGreaterThan(10);
    }
  });
});

describe("microsoft365PageUrl", () => {
  it("joins a fragment route onto its console origin", () => {
    const page = MICROSOFT365_BROWSER_PAGES.find((candidate) => candidate.surface === "entra-users")!;
    expect(microsoft365PageUrl({ page })).toBe(
      "https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/AllUsers",
    );
  });

  it("does not double the separator on a console that routes on the path", () => {
    const page = MICROSOFT365_BROWSER_PAGES.find((candidate) => candidate.surface === "purview-sensitivity-labels")!;
    expect(microsoft365PageUrl({ page })).toBe("https://purview.microsoft.com/informationprotection/labels");
  });

  it("answers null for the console whose origin embeds the organisation's own name", () => {
    const page = MICROSOFT365_BROWSER_PAGES.find((candidate) => candidate.surface === "sharepoint-sites")!;
    expect(page.console).toBe("tenant-root");
    expect(microsoft365PageUrl({ page })).toBeNull();
  });

  it("builds a URL for every page on a console whose origin is known", () => {
    const addressable = MICROSOFT365_BROWSER_PAGES.filter((page) => page.console !== "tenant-root");
    for (const page of addressable) {
      expect(microsoft365PageUrl({ page })).toContain("https://");
    }
  });
});

describe("microsoft365ConsoleIsFragmentRouted", () => {
  it("names the consoles whose HTTP status cannot grade reachability", () => {
    expect(microsoft365ConsoleIsFragmentRouted({ console: "entra" })).toBe(true);
    expect(microsoft365ConsoleIsFragmentRouted({ console: "intune" })).toBe(true);
    expect(microsoft365ConsoleIsFragmentRouted({ console: "microsoft365-admin" })).toBe(true);
  });

  it("does not claim it of a console that routes on the path", () => {
    expect(microsoft365ConsoleIsFragmentRouted({ console: "purview" })).toBe(false);
    expect(microsoft365ConsoleIsFragmentRouted({ console: "security" })).toBe(false);
  });
});
