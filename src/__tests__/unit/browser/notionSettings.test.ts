/**
 * The Notion settings seam's halves that need no browser: what the snippet builders produce, and what the
 * snippet's own JSON becomes.
 *
 * Both arms CLICK in the owner's browser, so the property worth proving here is the one that bounds them —
 * a caller supplies data and never source, the control and the tab are matched against closed name lists,
 * and "the right tab rendered" is a field the caller grades rather than a claim the snippet makes about
 * itself. The last of those is the direct descendant of this atlas's own worst failure: 21 byte-identical
 * pictures of a not-found shell reported as a filled settings surface.
 */
import { describe, expect, it } from "vitest";

import { ok, type Result, unwrap, unwrapErr } from "#lib/result.js";
import { observationFrom } from "../../../browser/notionSettings.js";
import { NOTION_PRE_EXISTING_MARKER } from "../../../browser/notionSettingsDomHelpers.js";
import {
  NOTION_CLICK_MARKER,
  NOTION_SETTINGS_CONTROL_NAMES,
  notionSettingsObserveSnippet,
  notionSettingsTabSnippet,
} from "../../../browser/notionSettingsSnippet.js";
import type { BrowserTransportError } from "../../../browser/pageTransport.js";
import { relayOperationSnippet } from "../../../browser/relayDispatch.js";

const SHOT = "/x/notion.png";
const URL = "https://app.notion.com";

/** What the terminal client prints for one operation: an envelope whose `result` is the snippet's JSON. */
function printed(snippet: Record<string, unknown>): Result<string, BrowserTransportError> {
  return ok(JSON.stringify({ result: JSON.stringify(snippet) }));
}

/** One observation off a snippet report, for the fields a test is about. */
function observed(snippet: Record<string, unknown>): ReturnType<typeof observationFrom> {
  return observationFrom({ result: printed(snippet), screenshotPath: SHOT });
}

describe("the snippet builders bake every varying value in as data", () => {
  it("writes the settings control names the page compares against as a JSON literal", () => {
    expect(notionSettingsObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL })).toContain(
      JSON.stringify(NOTION_SETTINGS_CONTROL_NAMES),
    );
  });

  it("writes the tab names the page compares against as a JSON literal", () => {
    expect(
      notionSettingsTabSnippet({ screenshotPath: SHOT, settleMs: 10, tabNames: ["People", "Members"], url: URL }),
    ).toContain(JSON.stringify(["People", "Members"]));
  });

  // A tab name that happens to be JavaScript is data on both arms. The value reaches the page inside a
  // JSON literal, so the page compares against the STRING and never runs it.
  it("escapes a tab name carrying a quote and a statement rather than emitting it as source", () => {
    const source = notionSettingsTabSnippet({
      screenshotPath: SHOT,
      settleMs: 10,
      tabNames: ['");process.exit(1);//'],
      url: URL,
    });
    const baked = JSON.stringify(['");process.exit(1);//']);
    expect(source).toContain(baked);
    // With the one JSON literal removed, the payload appears nowhere else — so it is only ever compared
    // against, never emitted where the page would run it. A naive interpolation fails this line.
    expect(source.split(baked).join("")).not.toContain("process.exit");
  });

  it("clicks through its own marker attribute rather than any selector a caller could name", () => {
    const source = notionSettingsTabSnippet({ screenshotPath: SHOT, settleMs: 10, tabNames: ["People"], url: URL });
    expect(source).toContain(JSON.stringify(NOTION_CLICK_MARKER));
  });

  // The readiness predicate is what the click CREATED, never a role name. MEASURED: the modal
  // carries no `role="dialog"` at all, so an arm waiting for one reported an open modal as closed.
  it("marks the tabs already on the page, then waits for one that is not marked", () => {
    const source = notionSettingsObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL });
    expect(source).toContain(JSON.stringify(NOTION_PRE_EXISTING_MARKER));
    expect(source).toContain("'[role=\"tab\"]:not([' + ");
  });

  it("never waits for a role Notion does not put on its settings modal", () => {
    expect(notionSettingsObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL })).not.toContain(
      "waitForSelector('[role=\"dialog\"]'",
    );
  });

  // The tab arm's candidate set is the tabs the settings click created, so a destructive control — a
  // BUTTON, never a tab — is not something a name could select even if one were somehow supplied.
  it("selects a tab only from the set the settings click brought into existence", () => {
    expect(notionSettingsTabSnippet({ screenshotPath: SHOT, settleMs: 10, tabNames: ["People"], url: URL })).toContain(
      "const candidates = appeared.filter(",
    );
  });

  // The observe arm is the inventory measurement, so it must not be able to select anything: a tab the
  // client happened to leave selected is a fact about the client, and picking one would make the two arms
  // indistinguishable in the record.
  it("reports an empty selection from the observe arm, whatever the modal was showing", () => {
    expect(notionSettingsObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL })).toContain(
      "selectedTabs: []",
    );
  });

  it("splits aria-labelledby on a plain space, never a regular expression a template literal would mangle", () => {
    const source = notionSettingsObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL });
    expect(source).toContain('.split(" ")');
    expect(source).not.toContain("\\s+");
  });
});

describe("relayOperationSnippet dispatches both new arms to their own builder", () => {
  it("builds the observe snippet for a notion-settings-observe operation", () => {
    expect(
      relayOperationSnippet({
        operation: { kind: "notion-settings-observe", screenshotPath: SHOT, settleMs: 10, url: URL },
      }),
    ).toBe(notionSettingsObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL }));
  });

  it("builds the tab snippet for a notion-settings-tab operation", () => {
    expect(
      relayOperationSnippet({
        operation: { kind: "notion-settings-tab", screenshotPath: SHOT, settleMs: 10, tabNames: ["People"], url: URL },
      }),
    ).toBe(notionSettingsTabSnippet({ screenshotPath: SHOT, settleMs: 10, tabNames: ["People"], url: URL }));
  });
});

describe("observationFrom grades on what the client marked, never on a picture existing", () => {
  it("carries the settled title and the dialog's own name through", () => {
    const seen = unwrap(observed({ dialogLabel: "Settings", dialogOpen: true, title: "Home | Notion" }));
    expect({ label: seen.dialogLabel, open: seen.dialogOpen, title: seen.title }).toEqual({
      label: "Settings",
      open: true,
      title: "Home | Notion",
    });
  });

  it("reports the modal closed when the snippet said no dialog was there", () => {
    expect(unwrap(observed({ dialogOpen: false, entries: [] })).dialogOpen).toBe(false);
  });

  // The failure this whole module exists to prevent: a PNG landed, so the run looks successful, while the
  // client selected nothing at all. `screenshotPath` is set and the selection is empty, and the caller has
  // to look at the second one.
  it("reports a written screenshot beside an empty selection rather than implying success", () => {
    const seen = unwrap(observed({ dialogOpen: true, screenshotWritten: true, selectedTabs: [], tabMatches: 0 }));
    expect({ shot: seen.screenshotPath, tabs: seen.selectedTabs, matches: seen.tabMatches }).toEqual({
      matches: 0,
      shot: SHOT,
      tabs: [],
    });
  });

  // Selecting one rail tab leaves the client marking its panel's own sub-tab selected too, so a single
  // value could not hold the answer — measured on `Members`, which marks `Members` and `Members 186`.
  it("keeps every entry the client marked selected, not just the first", () => {
    expect(unwrap(observed({ selectedTabs: ["Members", "Members 186"] })).selectedTabs).toEqual([
      "Members",
      "Members 186",
    ]);
  });

  it("reports no screenshot path at all when the snippet could not write one", () => {
    const seen = unwrap(observed({ screenshotError: "timeout", screenshotWritten: false }));
    expect({ error: seen.screenshotError, shot: seen.screenshotPath }).toEqual({ error: "timeout", shot: null });
  });

  it("keeps every navigation entry the modal offered, with its role and selected state", () => {
    const seen = unwrap(
      observed({
        entries: [
          { name: "People", role: "tab", selected: true },
          { name: "Billing", role: "button", selected: false },
        ],
      }),
    );
    expect(seen.entries).toEqual([
      { name: "People", role: "tab", selected: true },
      { name: "Billing", role: "button", selected: false },
    ]);
  });

  it("drops an entry the snippet sent with no name rather than inventing one", () => {
    expect(unwrap(observed({ entries: [{ role: "tab" }, { name: "People", role: "tab" }] })).entries).toEqual([
      { name: "People", role: "tab", selected: false },
    ]);
  });

  it("reports an empty role for an entry whose role the snippet did not send", () => {
    expect(unwrap(observed({ entries: [{ name: "People" }] })).entries).toEqual([
      { name: "People", role: "", selected: false },
    ]);
  });

  // A refusal is proof nothing was clicked, so it comes back as an observation rather than as a transport
  // failure — and it carries what the sidebar DID offer, which is the one thing that makes it actionable.
  it("returns the refusal and the sidebar's own control names as an observation", () => {
    const seen = unwrap(
      observed({
        controlMatches: 0,
        offered: ["Search", "Home", "Inbox"],
        refused: "the sidebar offers no single control named for settings",
      }),
    );
    expect({ matches: seen.controlMatches, offered: seen.offered, refused: seen.refused }).toEqual({
      matches: 0,
      offered: ["Search", "Home", "Inbox"],
      refused: "the sidebar offers no single control named for settings",
    });
  });

  it("turns a navigation failure into a transport error rather than an empty observation", () => {
    const failed = observationFrom({
      result: printed({ failure: "Timeout 45000ms exceeded", finalUrl: URL }),
      screenshotPath: SHOT,
    });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed).code).toBe("NAVIGATION_FAILED");
  });

  it("refuses output it cannot parse rather than reporting an empty modal", () => {
    const lost = observationFrom({ result: ok("not json at all"), screenshotPath: SHOT });
    expect(lost.isErr()).toBe(true);
    expect(unwrapErr(lost).code).toBe("SESSION_LOST");
  });
});

describe("the switcher click is guarded by a second position, not just the first match", () => {
  // The counterexample a review pass found: `New page` and `Trash` also declare `aria-haspopup="dialog"`
  // on the owner's client, so "first control that opens a dialog" could have pressed one and CREATED a page.
  it("refuses to press a first-match control whose name says it acts rather than discloses", () => {
    expect(notionSettingsObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL })).toContain(
      "actsRatherThanDiscloses(accessibleName(switcher))",
    );
  });

  it("refuses with its own reason when the two disagree, having clicked nothing", () => {
    expect(notionSettingsObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL })).toContain(
      "is named for an action rather than a disclosure, so it is not the workspace switcher and nothing was clicked",
    );
  });

  it("reports that refusal as an observation the caller can read, not as a transport failure", () => {
    const seen = unwrap(
      observed({
        controlMatches: -1,
        offered: ["button[haspopup=dialog] — New page"],
        refused: "the first dialog-opening control is named for an action rather than a disclosure",
      }),
    );
    expect({ matches: seen.controlMatches, offered: seen.offered }).toEqual({
      matches: -1,
      offered: ["button[haspopup=dialog] — New page"],
    });
  });
});
