/**
 * The snippets that reach Notion's settings surface, which has no address at all.
 *
 * ## Why a click, when every other atlas walk navigates
 *
 * MEASURED and stored in the atlas's own generation: the `browser-walk` surface's
 * `declared-pages` cell reads **0 of 32 declared routes reached**. `/space/my-account`,
 * `/settings` and `/p/<workspace>/settings` alike either keep their address and render the client's
 * not-found shell or fall through to a document, and 33 open gaps carry the per-route evidence. Notion's
 * settings surface is a MODAL opened from the sidebar, so it has no URL for a navigating transport to ask
 * for, and the owner asked for those screenshots by name.
 *
 * ## How the modal is opened, which took three tries and is worth the space
 *
 * MEASURED against the owner's own workspace, each step reproducible with
 * `slopweaver atlas notion settings --json`:
 *
 * 1. **Matching a sidebar control named `Settings` and clicking it did nothing.** Exactly one control
 *    matched, it was pressed, and no tab appeared. The whole census of settings-named controls on that page
 *    was `button — Teamspace settings and members…` and `button — Settings`, and the second belongs to the
 *    database VIEW settings sidebar the page happened to have open (`notion-view-settings-sidebar` was in
 *    the overlay list). Which controls the sidebar offers depends on what the owner was last looking at, so a name
 *    match against it measures the owner's window rather than the platform.
 * 2. **`Escape` then `Meta+Comma`, Notion's own settings shortcut, also opened nothing** on the web client.
 *    Recorded here rather than dropped: the next session should not spend a relay round-trip re-trying it.
 * 3. **The workspace switcher does open it.** It is the first `aria-haspopup="dialog"` control in the
 *    document — the top-left button in the sidebar header — and its accessible name is the WORKSPACE'S own
 *    name, which is per-install state and so is deliberately not what identifies it here. Clicking it opens
 *    a menu; the menu's `Settings` item opens the modal.
 *
 * **Identifying it positionally needed a guard, and a review pass is what found that.** The live census of
 * `aria-haspopup="dialog"` controls on the owner's client also holds `New page` and `Trash`, so a DOM reordering
 * that put `New page` first would have had this arm CREATE A PAGE in the owner's workspace — a mutation, from an arm
 * whose whole claim is that it cannot make one. {@link ./notionSettingsDomHelpers.NOTION_ACTING_CONTROL_PREFIXES}
 * is the guard, and its own header says plainly what it is and is not.
 *
 * ## What this is allowed to do, and the two rules that bound it
 *
 * A disclosure click is the one click a read may take — `vantaPolicyVersionSnippet.ts` established that
 * shape and the reason: a menu's contents do not exist in the DOM until it is opened, so there is no other
 * way to learn what is behind it. Notion's settings modal is the same class of thing, one level further:
 * its own tab panels do not exist until the modal is open and the tab is selected.
 *
 * - **The `Settings` item is matched inside what the switcher OPENED, never on the page at large.** That is
 *   the second correction the live runs forced: matched document-wide, two controls answer to `Settings` —
 *   the menu's item and the stale view-settings button behind it — and an arm that picked either would have
 *   been picking by DOM order. Its accessible name must still be on the closed list in this file;
 *   `vantaPolicyVersionSnippet.ts` carries the measurement that made that a rule, where an arm clicking
 *   "whatever declared `aria-haspopup`" opened Vanta's help menu and reported the page as offering nothing.
 * - **Nothing is ever clicked inside the modal except a TAB**, and "a tab" is structural rather than a
 *   promise. The tab arm's candidate set is `openedTabs()` — nodes carrying `role="tab"` that the settings
 *   click itself brought into existence — so `Delete workspace`, `Remove member` and the billing upgrade
 *   are not merely disallowed, they are not in the set a name could ever select from. Which tab is named by
 *   a closed enum member `atlas/notion/settingsTabs.ts` resolves, never by a selector or a caller's string.
 *
 * ## The falsifiable witness, and the failure it exists to prevent
 *
 * The first Notion walk photographed **21 byte-identical copies** of the "This page couldn't be found"
 * shell and reported them as a filled settings surface (`atlas/notion/browserPages.ts` carries it). A
 * picture is not evidence that the right thing was photographed. So every arm here reports what it
 * OBSERVED — which tabs the click created, what the tablist is called, and which entry the client marks
 * selected — and the caller grades on that rather than on a PNG existing. See
 * {@link NOTION_PRE_EXISTING_MARKER} for the measurement that made "what appeared" the predicate
 * instead of a role name.
 */

import { NOTION_DOM_HELPERS, NOTION_PRE_EXISTING_MARKER } from "./notionSettingsDomHelpers.js";
import { gotoFragment, photographFragment } from "./snippetParts.js";

/**
 * The accessible names Notion's own sidebar control for the settings modal goes by.
 *
 * A closed list, never a pattern, for the reason `vantaPolicyVersionSnippet.ts` measured: a control matched
 * loosely is a control nobody can name afterwards. The alternatives are here because Notion has shipped all
 * three spellings over the life of this client, and a name absent from this list is reported as "not found"
 * — a fact the next session can act on — rather than guessed at.
 *
 * @internal
 */
export const NOTION_SETTINGS_CONTROL_NAMES: readonly string[] = [
  "Settings",
  "Settings & members",
  "Settings and members",
];

/**
 * The attribute the page script stamps on the ONE node an arm is about to click.
 *
 * The click itself is Playwright's, against this marker, so the browser dispatches a trusted event the
 * client's own handlers observe — `vantaPolicyEditorSnippet.ts` carries the measurement that a DOM-level
 * act is not evidence the application saw anything. The selector is written in this file from this
 * constant, so nothing a caller supplies ever becomes one.
 *
 * @internal
 */
export const NOTION_CLICK_MARKER = "data-slopweaver-notion-click";

/** The page-script body that marks the settings control, shared by both arms. @internal */
const MARK_SETTINGS_CONTROL = `  const opened = await page.evaluate((allowed) => {
${NOTION_DOM_HELPERS}
    for (const node of document.querySelectorAll("[" + ${JSON.stringify(NOTION_CLICK_MARKER)} + "]")) {
      node.removeAttribute(${JSON.stringify(NOTION_CLICK_MARKER)});
    }
    const offered = [];
    for (const node of clickableNodes()) {
      const name = accessibleName(node);
      if (name.length === 0 || name.length > 60) { continue; }
      const popup = node.getAttribute("aria-haspopup");
      const settingsish = name.toLowerCase().indexOf("etting") !== -1;
      if (!settingsish && popup === null) { continue; }
      const role = node.getAttribute("role");
      const entry =
        (role === null ? node.tagName.toLowerCase() : role) +
        (popup === null ? "" : "[haspopup=" + popup + "]") +
        " \\u2014 " + name;
      if (offered.indexOf(entry) === -1) { offered.push(entry); }
    }
    for (const node of document.querySelectorAll('[role="tab"], [role="dialog"], [role="menu"]')) {
      node.setAttribute(${JSON.stringify(NOTION_PRE_EXISTING_MARKER)}, "before");
    }
    const switcher = document.querySelector(
      'button[aria-haspopup="dialog"], [role="button"][aria-haspopup="dialog"]',
    );
    if (switcher === null) {
      return { found: 0, offered: offered.slice(0, 40) };
    }
    if (actsRatherThanDiscloses(accessibleName(switcher))) {
      return { found: -1, offered: offered.slice(0, 40) };
    }
    switcher.setAttribute(${JSON.stringify(NOTION_CLICK_MARKER)}, "switcher");
    return { clicked: "workspace switcher \\u2014 " + accessibleName(switcher), found: 1, offered: offered.slice(0, 40) };
  }, ${JSON.stringify(NOTION_SETTINGS_CONTROL_NAMES)});
  if (opened.found !== 1) {
    return JSON.stringify({
      controlMatches: opened.found,
      finalUrl: page.url(),
      offered: opened.offered,
      refused:
        opened.found === -1
          ? "the first dialog-opening control is named for an action rather than a disclosure, so it is not the workspace switcher and nothing was clicked"
          : "the sidebar has no workspace switcher to open the settings menu from",
      title: await page.title().catch(() => ""),
    });
  }
  let dialogError = null;
  try {
    await page.keyboard.press("Escape");
    await page.click("[" + ${JSON.stringify(NOTION_CLICK_MARKER)} + "='switcher']", { timeout: 15000 });
    await page.waitForTimeout(1500);
    const picked = await page.evaluate((allowed) => {
${NOTION_DOM_HELPERS}
      const surfaced = Array.prototype.slice.call(
        document.querySelectorAll(
          '[role="dialog"]:not([' + ${JSON.stringify(NOTION_PRE_EXISTING_MARKER)} + ']), ' +
            '[role="menu"]:not([' + ${JSON.stringify(NOTION_PRE_EXISTING_MARKER)} + '])',
        ),
      );
      const inMenu = surfaced.flatMap(function (container) {
        return Array.prototype.slice.call(
          container.querySelectorAll('[role="button"], button, [role="menuitem"], [role="option"]'),
        );
      });
      const candidates = inMenu.filter(function (node) { return everyNameMatches(node, allowed); });
      if (candidates.length !== 1) { return candidates.length; }
      candidates[0].setAttribute(${JSON.stringify(NOTION_CLICK_MARKER)}, "settings");
      return 1;
    }, ${JSON.stringify(NOTION_SETTINGS_CONTROL_NAMES)});
    if (picked !== 1) {
      throw new Error("the workspace menu offered " + String(picked) + " control(s) named for settings, not one");
    }
    await page.click("[" + ${JSON.stringify(NOTION_CLICK_MARKER)} + "='settings']", { timeout: 15000 });
    await page.waitForSelector('[role="tab"]:not([' + ${JSON.stringify(NOTION_PRE_EXISTING_MARKER)} + '])', {
      timeout: 15000,
    });
    await page.waitForTimeout(settleMs);
  } catch (error) {
    dialogError = String(error);
  }`;

/** The page-script body that reads the open dialog back. @internal */
const READ_DIALOG = `  const observed = await page.evaluate(() => {
${NOTION_DOM_HELPERS}
    const roles = [];
    const counted = {};
    for (const node of document.querySelectorAll("[role]")) {
      const role = node.getAttribute("role");
      counted[role] = (counted[role] === undefined ? 0 : counted[role]) + 1;
    }
    for (const role of Object.keys(counted)) { roles.push(role + "=" + String(counted[role])); }
    const appeared = openedTabs();
    if (appeared.length === 0) {
      const overlays = [];
      for (const node of document.querySelectorAll("div")) {
        const style = window.getComputedStyle(node);
        if (style.position !== "fixed" && style.position !== "absolute") { continue; }
        const box = node.getBoundingClientRect();
        if (box.width < 400 || box.height < 300) { continue; }
        const marker = (node.className || "").toString().slice(0, 60);
        if (marker.length > 0 && overlays.indexOf(marker) === -1) { overlays.push(marker); }
      }
      return { dialog: false, entries: [], label: null, overlays: overlays.slice(0, 20), roles: roles };
    }
    const list = appeared[0].closest('[role="tablist"]');
    return {
      dialog: true,
      entries: navEntries(appeared),
      label: list === null ? null : accessibleName(list).slice(0, 60),
      overlays: [],
      roles: roles,
    };
  });`;

/**
 * Open Notion's settings modal and describe it, selecting nothing.
 *
 * This arm exists because the tab inventory is a MEASUREMENT nobody held: the closed enum the selecting arm
 * takes has to be built on what this reports rather than on what Notion's help pages say, which document no
 * URL scheme and no tab list at all. It clicks exactly one control, reads the dialog, photographs it, and
 * closes the modal with Escape.
 *
 * @param url the client address to open — the origin root, never a settings path, because there is none
 * @param settleMs how long the client is given to paint the modal before it is read
 * @param screenshotPath where the PNG is written
 * @returns the snippet source
 */
export function notionSettingsObserveSnippet({
  url,
  settleMs,
  screenshotPath,
}: {
  url: string;
  settleMs: number;
  screenshotPath: string;
}): string {
  return `async (page) => {
  const settleMs = ${JSON.stringify(settleMs)};
${gotoFragment({ settleMs, url })}
${MARK_SETTINGS_CONTROL}
${READ_DIALOG}
${photographFragment({ screenshotPath })}
  await page.keyboard.press("Escape").catch(() => {});
  return JSON.stringify({
    clicked: opened.clicked,
    offered: opened.offered,
    controlMatches: 1,
    dialogError,
    dialogLabel: observed.label,
    overlays: observed.overlays,
    roles: observed.roles,
    dialogOpen: observed.dialog,
    entries: observed.entries,
    finalUrl: page.url(),
    screenshotError,
    screenshotWritten,
    selectedTabs: [],
    tabMatches: null,
    title: await page.title().catch(() => ""),
  });
}`;
}

/**
 * Open Notion's settings modal, select ONE named tab, and prove the client marked it selected.
 *
 * `tabNames` is resolved from a closed enum by `atlas/notion/settingsTabs.ts` before it reaches here — a
 * caller names a tab id, never a string and never a selector. The names are baked in as a JSON literal, so
 * they are data the page compares against and never source it runs.
 *
 * The arm reports `selectedTab` from a re-read of the dialog AFTER the click, so "the right tab rendered"
 * is a fact the caller checks rather than one this snippet asserts about itself.
 *
 * @param url the client address to open
 * @param settleMs how long the client is given to paint, both for the modal and after the tab click
 * @param screenshotPath where the PNG is written, taken once the tab's own panel has painted
 * @param tabNames every accessible name this one tab is known to go by
 * @returns the snippet source
 */
export function notionSettingsTabSnippet({
  url,
  settleMs,
  screenshotPath,
  tabNames,
}: {
  url: string;
  settleMs: number;
  screenshotPath: string;
  tabNames: readonly string[];
}): string {
  return `async (page) => {
  const settleMs = ${JSON.stringify(settleMs)};
${gotoFragment({ settleMs, url })}
${MARK_SETTINGS_CONTROL}
  const picked = await page.evaluate((allowed) => {
${NOTION_DOM_HELPERS}
    const appeared = openedTabs();
    if (appeared.length === 0) { return { found: -1 }; }
    for (const node of document.querySelectorAll("[" + ${JSON.stringify(NOTION_CLICK_MARKER)} + "='tab']")) {
      node.removeAttribute(${JSON.stringify(NOTION_CLICK_MARKER)});
    }
    const candidates = appeared.filter(function (node) { return everyNameMatches(node, allowed); });
    if (candidates.length !== 1) { return { found: candidates.length }; }
    candidates[0].setAttribute(${JSON.stringify(NOTION_CLICK_MARKER)}, "tab");
    return { found: 1 };
  }, ${JSON.stringify(tabNames)});
  let tabError = null;
  if (picked.found === 1) {
    try {
      await page.click("[" + ${JSON.stringify(NOTION_CLICK_MARKER)} + "='tab']", { timeout: 15000 });
      await page.waitForTimeout(settleMs);
    } catch (error) {
      tabError = String(error);
    }
  }
${READ_DIALOG}
${photographFragment({ screenshotPath })}
  await page.keyboard.press("Escape").catch(() => {});
  const selected = observed.entries.filter(function (entry) { return entry.selected === true; });
  return JSON.stringify({
    clicked: opened.clicked,
    offered: opened.offered,
    controlMatches: 1,
    dialogError: dialogError === null ? tabError : dialogError,
    dialogLabel: observed.label,
    overlays: observed.overlays,
    roles: observed.roles,
    dialogOpen: observed.dialog,
    entries: observed.entries,
    finalUrl: page.url(),
    screenshotError,
    screenshotWritten,
    selectedTabs: selected.map(function (entry) { return entry.name; }),
    tabMatches: picked.found,
    title: await page.title().catch(() => ""),
  });
}`;
}
