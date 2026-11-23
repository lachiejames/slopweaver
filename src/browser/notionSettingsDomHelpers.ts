/**
 * What every `page.evaluate` block in the Notion settings snippets has in scope: the page-side helper functions,
 * and the two constants those helpers read.
 *
 * Split out of {@link ./notionSettingsSnippet} (the file-size ratchet), which interpolates
 * {@link NOTION_DOM_HELPERS} into each block. Nothing here runs until the emitted source reaches the page.
 */

/**
 * The attribute stamped on every `role="tab"` that was ALREADY on the page before the settings click.
 *
 * This is the readiness predicate, and it replaced a wrong one. MEASURED against the owner's own
 * workspace: the modal opens and **Notion gives it no `role="dialog"` at all** — the whole role census after
 * the click reads `button=340 tablist=2 tab=11 tabpanel=1 tree=7 treeitem=53 …` and the word `dialog` never
 * appears in it. An arm waiting for a dialog therefore timed out for fifteen seconds and then reported a
 * modal that was open the whole time as "NOT OPEN". Reproduce with `slopweaver atlas notion settings --json`.
 *
 * Waiting for a tablist instead would be a second guess of the same kind: the page already HAD two tablists
 * before the click, and this client renames its roles between releases. So what the arm waits for is what
 * the click BROUGHT INTO EXISTENCE — every tab present beforehand is marked, and the settings surface is
 * exactly the set that is not. That is falsifiable on its own terms: a click that changed nothing yields an
 * empty set and is reported as a modal that did not open, which is the honest answer rather than a picture
 * of whatever happened to be on screen.
 *
 * @internal
 */
export const NOTION_PRE_EXISTING_MARKER = "data-slopweaver-notion-pre";

/**
 * Name prefixes that mean a control ACTS rather than discloses, checked before the switcher is pressed.
 *
 * **This is a blocklist, and a blocklist cannot be complete** — `vantaPolicyVersionSnippet.ts` establishes
 * exactly that, and nothing here contradicts it. The difference is what it is doing: there, a blocklist was
 * proposed as the SELECTOR, filtering a blanket sweep, and it leaked because a control can be labelled
 * through `aria-labelledby` or an icon. Here the selection is already made positionally — the first
 * `aria-haspopup="dialog"` control — and this is a guard on that one pick.
 *
 * It exists because a review pass produced a concrete counterexample rather than a worry. MEASURED
 * on the owner's own client, the controls declaring `aria-haspopup="dialog"` include `New page` and `Trash`
 * alongside the workspace switcher. Nothing in the arm's design made the switcher FIRST — that is an
 * observation of one DOM, and a reordering that put `New page` first would have had an arm whose whole claim
 * is that it cannot mutate the workspace CREATE A PAGE in it.
 *
 * So the honest position, stated rather than discovered later: the switcher is identified by POSITION, the
 * name check narrows what a wrong position can cost, and the arm refuses having clicked nothing when it
 * fires. What would retire both is the switcher's own name — which is the workspace's, per-install state
 * that belongs outside this file (`AGENTS.md`, "tools in the codebase, state outside it").
 *
 * @internal
 */
export const NOTION_ACTING_CONTROL_PREFIXES: readonly string[] = [
  "new ",
  "add ",
  "add to",
  "create",
  "delete",
  "remove",
  "trash",
  "leave",
  "duplicate",
  "export",
  "import",
  "invite",
  "upgrade",
  "buy",
  "publish",
  "share",
  "move",
  "archive",
  "restore",
  "sign out",
  "log out",
];

/**
 * How the page script finds a clickable control by accessible name, and reads the dialog back.
 *
 * Every name source must agree, which is the correction `vantaPolicyVersionSnippet.ts` paid for twice: a
 * control whose visible text reads one thing while its `aria-label` reads another satisfies a single-source
 * check and is not the control the reader thinks was clicked. `aria-labelledby` is resolved by splitting on
 * a plain space — a `\s+` written inside a template literal reaches the page as `/s+/` and splits ids on
 * the letter s, which is a bug this repository has already shipped once.
 *
 * @internal
 */
export const NOTION_DOM_HELPERS = `    function labelledByText(node) {
      const ids = (node.getAttribute("aria-labelledby") || "").split(" ").filter(function (id) { return id.length > 0; });
      const parts = [];
      for (const id of ids) {
        const target = document.getElementById(id);
        if (target !== null) { parts.push((target.textContent || "").trim()); }
      }
      return parts.join(" ").trim();
    }
    function nameSources(node) {
      const sources = [];
      const label = (node.getAttribute("aria-label") || "").trim();
      if (label.length > 0) { sources.push(label); }
      const labelled = labelledByText(node);
      if (labelled.length > 0) { sources.push(labelled); }
      const visible = (node.textContent || "").trim();
      if (visible.length > 0) { sources.push(visible); }
      return sources;
    }
    function accessibleName(node) {
      const sources = nameSources(node);
      return sources.length === 0 ? "" : sources[0];
    }
    function everyNameMatches(node, allowed) {
      const sources = nameSources(node);
      if (sources.length === 0) { return false; }
      for (const source of sources) {
        if (allowed.indexOf(source) === -1) { return false; }
      }
      return true;
    }
    function clickableNodes() {
      return Array.prototype.slice.call(
        document.querySelectorAll('[role="button"], button, [role="tab"], [role="menuitem"], [role="option"], a[href]'),
      );
    }
    function actsRatherThanDiscloses(name) {
      const lowered = name.toLowerCase();
      for (const verb of ${JSON.stringify(NOTION_ACTING_CONTROL_PREFIXES)}) {
        if (lowered.indexOf(verb) === 0) { return true; }
      }
      return false;
    }
    function everyTab() {
      return Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    }
    function openedTabs() {
      return everyTab().filter(function (node) {
        return node.getAttribute(${JSON.stringify(NOTION_PRE_EXISTING_MARKER)}) === null;
      });
    }
    function navEntries(nodes) {
      const seen = [];
      const entries = [];
      for (const node of nodes) {
        const name = accessibleName(node);
        if (name.length === 0 || name.length > 60 || seen.indexOf(name) !== -1) { continue; }
        seen.push(name);
        entries.push({
          name: name,
          role: node.getAttribute("role") || node.tagName.toLowerCase(),
          selected: node.getAttribute("aria-selected") === "true" || node.getAttribute("aria-current") === "page",
        });
      }
      return entries;
    }`;
