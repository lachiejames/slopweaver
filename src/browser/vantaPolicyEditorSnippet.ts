/**
 * The two snippets that read and edit ONE Vanta policy draft in the owner's own Chrome.
 *
 * ## Why a browser snippet is the only shape this can have
 *
 * Vanta's Manage API declares 240 operations and exactly two touch policies, both GET — measured,
 * reproduce with `yarn tsx tools/generateVantaEndpoints.ts --verify --fetch`. There is no upload-a-policy-
 * version operation to call, so a policy version cannot be published from this program at all except
 * through the web client. Owner ruling: when the web client is the only way to upload a new policy version,
 * the fleet writes into the Vanta browser.
 *
 * ## Every statement here is fixed, and exactly four values vary
 *
 * The URL, the settle, the screenshot path and — for the edit — the two strings and the expected result.
 * All six are baked in as JSON literals, so nothing a page said becomes control flow. That is the same
 * property `playwrightCli.ts`'s page-visit snippet has, and it is what makes the write arm reviewable:
 * there is no selector channel, no keystroke channel and no script channel from a caller.
 *
 * ## The editor autosaves, so TYPING is the mutation
 *
 * MEASURED from a `slopweaver browser shot` of the live editor: its toolbar reads
 * **Auto-save enabled**, beside `Save and close` and `Assign approver and submit`. So the external write
 * boundary is the substitution itself, not the Save click, and a verb that claimed Save was the boundary
 * would be describing a mutation that had already happened. {@link vantaDraftEditSnippet} still clicks
 * `Save and close` — it is the deterministic end of the edit and what a person does — but the door row is
 * owed from the keystroke.
 *
 * ## What neither snippet can do
 *
 * Neither touches `Assign approver and submit`, and the edit refuses outright unless the draft's own
 * controls are the ones a not-yet-submitted draft shows. Publishing a policy version is the owner's act, and there
 * is no arm here that performs it.
 */

import { gotoFragment, photographFragment } from "./snippetParts.js";

/** How the text substitution is applied, and why it is not a `textContent` write. */
const APPLY_SUBSTITUTION = `
  function editorText(node) {
    return node.innerText.replace(/\\r\\n/g, "\\n");
  }
  function findTextNode(root, needle) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    let node = walker.nextNode();
    while (node !== null) {
      let from = node.data.indexOf(needle);
      while (from !== -1) {
        hits.push({ node: node, offset: from });
        from = node.data.indexOf(needle, from + 1);
      }
      node = walker.nextNode();
    }
    return hits;
  }
`;

/** Locate the editable region the draft lives in — the same ordered candidate list in both snippets. */
const LOCATE_EDITOR = `
  function editableRegions() {
    const nodes = Array.from(document.querySelectorAll('[contenteditable="true"], [contenteditable=""]'));
    return nodes.map(function (node) {
      return {
        node: node,
        className: typeof node.className === "string" ? node.className : "",
        tagName: node.tagName,
        textLength: node.innerText.length,
      };
    });
  }
  function draftEditor() {
    const regions = editableRegions();
    if (regions.length === 0) {
      return null;
    }
    return regions.reduce(function (best, next) {
      return next.textLength > best.textLength ? next : best;
    });
  }
  function controlLabels() {
    return Array.from(document.querySelectorAll("button")).map(function (button) {
      return button.innerText.trim();
    }).filter(function (label) {
      return label.length > 0;
    });
  }
`;

/** Select the one matched run in the page, refusing — having typed nothing — if it is not unique. */
const SELECT_MATCH = `  const selected = await page.evaluate((args) => {
${LOCATE_EDITOR}
${APPLY_SUBSTITUTION}
    const editor = draftEditor();
    if (editor === null) {
      return { refused: "no editable region on this page", stage: "locate" };
    }
    const before = editorText(editor.node);
    const hits = findTextNode(editor.node, args.find);
    if (hits.length !== 1) {
      return { before: before, hits: hits.length, refused: "the text to replace must occur exactly once", stage: "match" };
    }
    const hit = hits[0];
    const range = document.createRange();
    range.setStart(hit.node, hit.offset);
    range.setEnd(hit.node, hit.offset + args.find.length);
    editor.node.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { before: before, selected: String(selection).length === args.find.length, stage: "selected" };
  }, { find });
  if (selected.refused !== undefined) {
    return JSON.stringify({ finalUrl: page.url(), refused: selected.refused, stage: selected.stage });
  }
  if (selected.selected !== true) {
    return JSON.stringify({ finalUrl: page.url(), refused: "the matched run could not be selected", stage: "select" });
  }
`;

/**
 * Type the replacement, save, and REOPEN — the three phases after the selection.
 *
 * The reopen is the only one of the three that is evidence Vanta stored anything; see this module's header
 * for the measurement that made that distinction load-bearing.
 */
const TYPE_SAVE_VERIFY = `  let typed = false;
  let typeError = null;
  try {
    await page.keyboard.insertText(replace);
    await page.waitForTimeout(settleMs);
    typed = true;
  } catch (error) {
    typeError = String(error);
  }
  const inEditor = await draftText();
  const matched = inEditor === expectedText;
  let saved = false;
  let saveError = null;
  if (matched === true) {
    try {
      await page.getByRole("button", { name: "Save and close", exact: true }).click({ timeout: 15000 });
      await page.waitForTimeout(settleMs);
      saved = true;
    } catch (error) {
      saveError = String(error);
    }
  }
  let persisted = false;
  let persistError = null;
  try {
    await openEditor();
    persisted = (await draftText()) === expectedText;
  } catch (error) {
    persistError = String(error);
  }
`;

/** Photograph whatever the page ended on: the verb's own evidence of what it did. */
function photographResult({ screenshotPath }: { screenshotPath: string }): string {
  return `${photographFragment({ screenshotPath })}
`;
}

/**
 * Open one Vanta policy editor and describe what is there, changing nothing.
 *
 * It reports every editable region rather than only the one it picked, because the page's shape is the
 * thing a write is judged against and a snippet that hid its alternatives would make an ambiguous editor
 * indistinguishable from an unambiguous one.
 *
 * @param url the policy editor address
 * @param settleMs how long to let the client finish painting before reading
 * @param screenshotPath where the snippet writes its PNG
 * @returns the snippet source
 */
export function vantaDraftObserveSnippet({
  url,
  settleMs,
  screenshotPath,
}: {
  url: string;
  settleMs: number;
  screenshotPath: string;
}): string {
  return `async (page) => {
  const url = ${JSON.stringify(url)};
  const settleMs = ${JSON.stringify(settleMs)};
  const screenshotPath = ${JSON.stringify(screenshotPath)};
${gotoFragment({ settleMs, url })}
  const observed = await page.evaluate(() => {
${LOCATE_EDITOR}
    const regions = editableRegions().map(function (region) {
      return { className: region.className, tagName: region.tagName, textLength: region.textLength };
    });
    const editor = draftEditor();
    return {
      controls: controlLabels(),
      editor: editor === null ? null : { className: editor.className, tagName: editor.tagName, textLength: editor.textLength },
      regionCount: regions.length,
      regions: regions,
      text: editor === null ? null : editor.node.innerText,
    };
  });
${photographFragment({ screenshotPath })}
  return JSON.stringify({
    controls: observed.controls,
    editor: observed.editor,
    finalUrl: page.url(),
    regionCount: observed.regionCount,
    regions: observed.regions,
    screenshotError,
    screenshotWritten,
    text: observed.text,
    title: await page.title().catch(() => ""),
  });
}`;
}

/**
 * Apply ONE exact substitution to a Vanta policy draft, save it, and then PROVE it persisted.
 *
 * ## Why the substitution is typed rather than written
 *
 * MEASURED, and it is the reason this snippet has the shape it has. The first version selected
 * the matched run and called `document.execCommand("insertText", …)`. The page reported everything green —
 * the editor's own `innerText` came back with the substitution in it, `Save and close` clicked, the client
 * navigated to the policy versions tab — and a fresh read of the editor thirty seconds later held the
 * ORIGINAL text. The editor keeps its own document model; `execCommand` moved the DOM under it, the model
 * never saw the change, and autosave dutifully saved the model. **A DOM read after a DOM write is not
 * evidence that anything was written.**
 *
 * So the text goes in through `page.keyboard.insertText`, which Playwright dispatches over CDP as a real
 * `Input.insertText` — a trusted event the editor's own `beforeinput` handler observes — and the result is
 * judged by REOPENING the page, never by reading back the DOM this snippet just touched.
 *
 * ## The five phases, and what each one is evidence of
 *
 * 1. Locate the editor and verify `find` occurs exactly once. Refuses here, having typed nothing.
 * 2. Select the matched run, in the page.
 * 3. Type the replacement through the keyboard, in Playwright.
 * 4. Read back and compare to `expectedText` — evidence the EDITOR took it, not that Vanta stored it.
 * 5. Click `Save and close`, reopen the editor from scratch, and read again — the only evidence that the
 *    substitution survived, and the only thing the verb reports success on.
 *
 * @param url the policy editor address
 * @param settleMs how long to let the client finish painting before reading or typing
 * @param screenshotPath where the snippet writes its PNG, taken after the reopened read
 * @param find the exact run to replace, which must occur exactly once in the editor's text
 * @param replace what to put there
 * @param expectedText the editor text the substitution must produce, computed outside the browser
 * @returns the snippet source
 */
export function vantaDraftEditSnippet({
  url,
  settleMs,
  screenshotPath,
  find,
  replace,
  expectedText,
}: {
  url: string;
  settleMs: number;
  screenshotPath: string;
  find: string;
  replace: string;
  expectedText: string;
}): string {
  return `async (page) => {
  const url = ${JSON.stringify(url)};
  const settleMs = ${JSON.stringify(settleMs)};
  const screenshotPath = ${JSON.stringify(screenshotPath)};
  const find = ${JSON.stringify(find)};
  const replace = ${JSON.stringify(replace)};
  const expectedText = ${JSON.stringify(expectedText)};
  async function openEditor() {
    await page.goto(url, { timeout: 45000, waitUntil: "load" });
    await page.waitForTimeout(settleMs);
  }
  async function draftText() {
    return await page.evaluate(() => {
${LOCATE_EDITOR}
${APPLY_SUBSTITUTION}
      const editor = draftEditor();
      return editor === null ? null : editorText(editor.node);
    });
  }
  try {
    await openEditor();
  } catch (error) {
    return JSON.stringify({ failure: String(error) });
  }
${SELECT_MATCH}${TYPE_SAVE_VERIFY}${photographResult({ screenshotPath })}  return JSON.stringify({
    after: inEditor,
    before: selected.before,
    finalUrl: page.url(),
    matched,
    persistError,
    persisted,
    saveError,
    saved,
    screenshotError,
    screenshotPath,
    screenshotWritten,
    typeError,
    typed,
  });
}`;
}
