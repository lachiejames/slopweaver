/**
 * How the menu bar icon names itself: the owner's app keeps today's names, and a test instance's own icon is Slopweaver Test
 * wherever it shows.
 */
import { describe, expect, it } from "vitest";

import { trayPresentation } from "../../src/trayPresentation";

describe("trayPresentation", () => {
  it("keeps the installed app's names, the triage countdown beside the icon", () => {
    expect(
      trayPresentation({
        buildIdentityLine: undefined,
        buildLabel: "Slopweaver",
        statusTooltip: "Console serving",
        testInstance: false,
        triageTitle: "2:14",
      }),
    ).toEqual({ identityLine: undefined, quitLabel: "Quit Slopweaver", title: "2:14", tooltip: "Console serving" });
  });

  it("leads a dev build's menu and tooltip with its checkout, nothing beside the icon while triage is off", () => {
    expect(
      trayPresentation({
        buildIdentityLine: "Dev build of /Users/x/acme-checkout",
        buildLabel: "Slopweaver Dev",
        statusTooltip: "Console serving",
        testInstance: false,
        triageTitle: "",
      }),
    ).toEqual({
      identityLine: "Dev build of /Users/x/acme-checkout",
      quitLabel: "Quit Slopweaver Dev",
      title: "",
      tooltip: "Slopweaver Dev · Console serving",
    });
  });

  it("names a test instance's icon Slopweaver Test beside it, in its tooltip, its first line and its Quit", () => {
    expect(
      trayPresentation({
        buildIdentityLine: "Dev build of /Users/x/acme-checkout",
        buildLabel: "Slopweaver Dev",
        statusTooltip: "Console serving",
        testInstance: true,
        triageTitle: "",
      }),
    ).toEqual({
      identityLine: "Test instance · Slopweaver Dev",
      quitLabel: "Quit Slopweaver Test",
      title: "Slopweaver Test",
      tooltip: "Slopweaver Test · Console serving",
    });
  });
});
