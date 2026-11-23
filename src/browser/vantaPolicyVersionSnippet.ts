/**
 * The snippet that describes ONE Vanta policy's version workflow, so the upload arm is written against what
 * the page actually offers rather than against a guess.
 *
 * ## Why the text editor is not the route for a policy loaded as a file
 *
 * MEASURED, read-only, on a policy whose approved version reads **"Via file upload (.docx)"**:
 * navigating to `…/policies/<id>/edit` bounces straight back to the policy page with
 * a red toast reading **"Policy draft is not editable"**. Reproduce with
 * `slopweaver browser shot --url https://app.vanta.com/c/<tenant>/policies/<id>/edit`.
 *
 * So `write vanta edit-policy-draft` — which types into the in-app rich-text editor — cannot touch a policy
 * whose body arrived as a file; its route is uploading a new VERSION. Which a policy is, is per policy:
 * one written in Vanta's own editor reads **"Created in Vanta"** and takes the editor. This
 * reconnaissance is how a session tells, from the source line under the approved version.
 *
 * ## It opens a menu and does nothing else
 *
 * A disclosure control is the one click a read is allowed to make, and the snippet takes it only when the
 * control's own accessible name is one of {@link POLICY_MENU_NAMES}. It then reads the menu's item labels
 * and closes the menu with Escape. It clicks no item, submits no form, and touches no file input — an
 * upload is a WRITE and lives behind the door, in a different arm, with an approval digest in front of it.
 *
 * **The name is required, and that is a correction rather than a nicety.** The first version clicked the
 * first control on the page declaring `aria-haspopup`, and MEASURED that control is the help
 * menu in Vanta's top chrome: the read came back with `Help center | Live training | Chat with us | Invite
 * team member | Share product feedback | Vanta Community` and reported the policy page as offering no
 * upload. The page's own control is named **"Policy actions"**, which was in the same report's button list
 * all along. An arm that clicks "whatever popped up" cannot say what it opened.
 *
 * ## It also EXPANDS the page's collapsed sections, for the same reason
 *
 * MEASURED: the `Policy actions` menu holds exactly `Download acceptance history`,
 * `Copy policy permalink` and `Delete policy` — no upload at all. The policy page's version workflow is in
 * its collapsed cards instead (`Renew before <date>`, `Approved version: <date>`, `Version history`), and a
 * collapsed card's controls are not in the DOM either. So the read expands every control that declares
 * collapsed renewal card and reports what appears. Expanding a disclosure is the same class of act as
 * opening a menu: it reveals, it does not submit.
 *
 * **Only the cards named in {@link DISCLOSURE_PREFIXES} are expanded**, never a sweep. A control that
 * declares `aria-expanded` is not necessarily a disclosure, and two Codex review passes established
 * statically that neither a blanket click nor a name blocklist can keep a publishing control out of it.
 *
 * There is no caller channel into any of this: the URL, the settle and the screenshot path are the only
 * values that vary, and each is baked in as a JSON literal.
 */

import { gotoFragment, photographFragment } from "./snippetParts.js";

/**
 * The accessible names the policy page's own action menu goes by.
 *
 * A closed list, never a pattern. MEASURED on this tenant: the control is labelled
 * `Policy actions`. The alternatives are kept because Vanta renames buttons and a read that silently
 * clicked a differently-named control would be the defect this list exists to prevent — a name not in this
 * list is reported as "not found", which is a fact a person can act on.
 *
 * @internal
 */
export const POLICY_MENU_NAMES: readonly string[] = ["Policy actions", "Policy options", "More actions"];

/**
 * The ONLY collapsed controls either arm will expand, matched as a prefix of the accessible name.
 *
 * An allowlist, and that is the second correction to this rule, both found by Codex review passes rather
 * than by running it. The first version clicked every `aria-expanded="false"` control. The second filtered
 * that sweep against {@link PUBLISHING_CONTROL_NAMES}, and the next pass showed the filter leaks: a control
 * labelled through `aria-labelledby`, or one whose visible text is an icon, has a name the filter never
 * sees, so a publishing control could still be clicked as a "disclosure". A blocklist of dangerous names
 * cannot be complete; a list of the one card this flow needs can.
 *
 * **Every name source must match, not just one.** A third pass found that a control whose visible text reads
 * `Renew before …` while its `aria-labelledby` points at `Publish` would satisfy a single-source check, and
 * that the `aria-labelledby` resolver had been silently broken besides: a `\\s+` inside this file's template
 * literals reaches the page as `/s+/`, so it split IDs on the letter s. The resolver now splits on a plain
 * space with no regular expression at all, and a control is expanded only when its labelledby text, its
 * `aria-label` and its visible text — every one that is present — begins with an allowlisted prefix.
 *
 * MEASURED: the renewal controls live in the card titled `Renew before <date>`. Nothing else on
 * the page has to be opened for either arm to work.
 *
 * @internal
 */
export const DISCLOSURE_PREFIXES: readonly string[] = ["Renew before"];

/**
 * The control that starts a new version of a policy.
 *
 * MEASURED on a live policy, by expanding the page's own `Renew before <date>`
 * card: it offers `Renew and make updates` and `Renew without updates`. The second one renews the policy at
 * its current wording and is NEVER what this program clicks — pushing an edited document is the whole point
 * — so only the first is named here, and a page offering neither is reported rather than guessed at.
 *
 * @internal
 */
export const RENEW_WITH_UPDATES_NAME = "Renew and make updates";

/**
 * The option in the `Create a new version` modal that takes a FILE.
 *
 * MEASURED: `Renew and make updates` opens a modal offering `Continue from previously approved
 * version` (selected), `Create a new policy` and `Import an existing policy`. Only the third reveals a file
 * input; the other two open Vanta's own editor, which cannot hold a policy loaded as a file. Choosing
 * the option is a radio click inside a modal, so nothing is written until the modal is confirmed.
 *
 * @internal
 */
export const IMPORT_EXISTING_NAME = "Import an existing policy";

/**
 * The card inside the import modal that asks the browser for a file.
 *
 * MEASURED: choosing `Import an existing policy` reveals two cards, `Upload a file from
 * computer` (*"Supported formats: .pdf, .docx. Only .docx files can be edited in Vanta."*) and `Sync a
 * file`. The card is a SELECTOR, not the file picker: clicking it ticks it and enables `Import policy`, and
 * measured, no file chooser opens. The chooser opens on `Import policy`, which is why that click and the
 * chooser are raced together rather than sequenced.
 *
 * The second card is never clicked: syncing from Confluence, Drive or SharePoint would make a third system
 * the source of a policy whose markdown the fleet edits and uploads, which is a shape nobody asked for.
 *
 * @internal
 */
export const UPLOAD_CARD_NAMES: readonly string[] = ["Upload a file from computer"];

/**
 * The control on an EXISTING draft version's row that attaches a file to it.
 *
 * MEASURED: a draft created but left without a file shows as `Draft version / Via file upload`
 * with an `English / Not started` row carrying an `Upload` button. So a policy that already has an empty
 * draft does not need the modal at all, and re-running the modal would create a SECOND draft. The upload
 * arm looks for this first and takes it when it is there.
 *
 * @internal
 */
export const DRAFT_UPLOAD_NAMES: readonly string[] = ["Upload"];

/**
 * The option in the file-upload modal that must stay selected, and the one that must never be.
 *
 * MEASURED: attaching a file to a draft opens an `Upload a file` modal asking
 * *"Complete approval in Vanta?"*, defaulting to **`Yes, needs approval`** (*"Start approval process in
 * Vanta"*) with **`No, already approved`** (*"Record the latest approval details"*) beside it.
 *
 * The default is the correct one and is left alone: it says the version WILL need approval, which is true,
 * and it does not submit anything — submitting is the separate `Assign approver and submit` button this
 * file never touches. The alternative RECORDS AN APPROVAL that nobody gave, which is the single worst thing
 * available on this screen.
 *
 * **The guard is positive and fails closed.** It first refused only when `No, already approved` was seen
 * selected, reading the radio's wrapping label; a Codex pass showed a `<label for=…>` elsewhere in the
 * modal hides that selection from such a read. So the upload now proceeds only when the page confirms the
 * ONE checked option's labels — through the DOM's own `input.labels`, `aria-labelledby` and `aria-label` —
 * begin with {@link APPROVAL_NEEDED_LABEL}. A modal whose selection cannot be read that way is refused.
 *
 * @internal
 */
export const APPROVAL_NEEDED_LABEL = "Yes, needs approval";

/**
 * The option that would record an approval nobody gave. Never selected, and a refusal if it is.
 *
 * @internal
 */
export const ALREADY_APPROVED_LABEL = "No, already approved";

/**
 * The confirm this modal offers once a file is attached.
 *
 * @internal
 */
export const CONFIRM_VERSION_NAMES: readonly string[] = [
  "Create in policy editor",
  "Import policy",
  "Upload",
  "Continue",
  "Create version",
];

/**
 * The controls that would PUBLISH or submit a version, which no arm in this file ever clicks.
 *
 * The owner's ruling: a policy is not published in Vanta, because publishing a change makes everyone count
 * as not having approved the policy and a bunch of controls fail. A version published with a re-acceptance
 * request puts every acceptance of that policy back to
 * outstanding, so the policy's acceptance test fails until all are given again, and that request is chosen
 * at approval, the owner's act. So the
 * upload arm leaves the version a DRAFT, and it refuses
 * outright if the only control the page offers it is one of these.
 *
 * @internal
 */
export const PUBLISHING_CONTROL_NAMES: readonly string[] = [
  "Assign approver and submit",
  "Submit for approval",
  "Publish",
  "Approve",
];

/** How a menu is found and read — shared by the observe arm and, later, by the upload arm. */
const READ_MENU = `
  function labelledByText(node) {
    const labelledBy = node.getAttribute("aria-labelledby");
    if (typeof labelledBy !== "string") {
      return "";
    }
    return labelledBy.split(" ").filter(function (id) { return id.length > 0; }).map(function (id) {
      const target = document.getElementById(id);
      return target === null ? "" : (target.innerText || "").trim();
    }).join(" ").trim();
  }
  function nameSources(node) {
    const label = node.getAttribute("aria-label");
    return [labelledByText(node), typeof label === "string" ? label.trim() : "", (node.innerText || "").trim()]
      .filter(function (source) { return source.length > 0; });
  }
  function accessibleName(node) {
    const labelled = labelledByText(node);
    if (labelled.length > 0) {
      return labelled;
    }
    const label = node.getAttribute("aria-label");
    if (typeof label === "string" && label.trim().length > 0) {
      return label.trim();
    }
    return (node.innerText || "").trim();
  }
  function menuItemLabels() {
    const selector = '[role="menuitem"], [role="option"], [role="menu"] button, [role="dialog"] button';
    return Array.from(document.querySelectorAll(selector))
      .map(accessibleName)
      .filter(function (label) { return label.length > 0 && label.length < 120; });
  }
  function fileInputs() {
    return Array.from(document.querySelectorAll('input[type="file"]')).map(function (node) {
      return { accept: node.getAttribute("accept") || "", name: node.getAttribute("name") || "", hidden: node.offsetParent === null };
    });
  }
  function allowedDisclosures(prefixes) {
    return Array.from(document.querySelectorAll('[aria-expanded="false"]')).filter(function (node) {
      const sources = nameSources(node);
      return sources.length > 0 && sources.every(function (source) {
        return prefixes.some(function (prefix) { return source.indexOf(prefix) === 0; });
      });
    }).map(function (node, index) {
      node.setAttribute("data-slopweaver-disclosure", String(index));
      return index;
    });
  }
  function actionsButton(names) {
    const buttons = Array.from(document.querySelectorAll("button")).filter(function (node) {
      return names.indexOf(accessibleName(node)) !== -1;
    });
    return buttons.length === 1 ? buttons[0] : null;
  }
`;

/**
 * Open one policy's overflow menu and report what it offers, clicking nothing in it.
 *
 * @param url the policy page to open, tenant segment included
 * @param settleMs how long to let the single-page app settle after load
 * @param screenshotPath where the picture of the opened menu is written
 * @returns the snippet source
 */
// max-lines-exempt: one snippet is one template literal, for the reason the upload arm below states.
export function vantaPolicyVersionObserveSnippet({
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
  const names = ${JSON.stringify(POLICY_MENU_NAMES)};
  const before = await page.evaluate((args) => {
${READ_MENU}
    const button = actionsButton(args.names);
    if (button !== null) {
      button.setAttribute("data-slopweaver-policy-actions", "1");
    }
    return {
      buttons: Array.from(document.querySelectorAll("button")).map(accessibleName).filter(function (l) { return l.length > 0; }),
      fileInputs: fileInputs(),
      found: button === null ? null : accessibleName(button),
      menuItems: menuItemLabels(),
    };
  }, { names: names });
  let opened = null;
  if (before.found === null) {
    opened = "no control on this page is named " + names.join(" / ") + " — nothing was clicked";
  } else {
    try {
      await page.locator("[data-slopweaver-policy-actions]").first().click({ timeout: 8000 });
      await page.waitForTimeout(1500);
      opened = before.found;
    } catch (error) {
      opened = "refused: " + String(error);
    }
  }
  const after = await page.evaluate(() => {
${READ_MENU}
    return { fileInputs: fileInputs(), menuItems: menuItemLabels() };
  });
  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  } catch (error) {
    // A page that will not take Escape has still only had a menu opened.
  }
  // Expand ONLY the allowlisted cards, so the version workflow's own controls exist in the DOM to be read.
  let expandedCount = 0;
  try {
    const marked = await page.evaluate((args) => {
${READ_MENU}
      return allowedDisclosures(args.prefixes).length;
    }, { prefixes: ${JSON.stringify(DISCLOSURE_PREFIXES)} });
    for (let index = 0; index < marked && index < 12; index += 1) {
      try {
        await page.locator('[data-slopweaver-disclosure="' + index + '"]').first().click({ timeout: 5000 });
        expandedCount += 1;
        await page.waitForTimeout(500);
      } catch (error) {
        // One card that will not open does not stop the rest.
      }
    }
  } catch (error) {
    expandedCount = -1;
  }
  await page.waitForTimeout(1200);
  const expanded = await page.evaluate(() => {
${READ_MENU}
    return {
      buttons: Array.from(document.querySelectorAll('button, a[role="button"]')).map(accessibleName).filter(function (l) { return l.length > 0; }),
      fileInputs: fileInputs(),
      links: Array.from(document.querySelectorAll("a")).map(function (node) { return { text: accessibleName(node), href: node.getAttribute("href") || "" }; }).filter(function (l) { return l.text.length > 0; }),
    };
  });
${photographFragment({ screenshotPath })}
  return JSON.stringify({
    afterFileInputs: after.fileInputs,
    afterMenuItems: after.menuItems,
    beforeButtons: before.buttons,
    beforeFileInputs: before.fileInputs,
    beforeMenuItems: before.menuItems,
    expandedButtons: expanded.buttons,
    expandedCount,
    expandedFileInputs: expanded.fileInputs,
    expandedLinks: expanded.links,
    finalUrl: page.url(),
    menuName: before.found,
    opened,
    screenshotError,
    screenshotWritten,
    title: await page.title().catch(() => ""),
  });
}`;
}

/**
 * Start a new version of one policy and, when a file is named, upload it — leaving the version a DRAFT.
 *
 * ## Where the write boundary actually is
 *
 * MEASURED, twice, and BOTH measurements were corrections of a wrong claim this file had made.
 *
 * First it said clicking `Renew and make updates` creates a draft. It does not: that click opens a
 * `Create a new version` MODAL, and the screenshot the refusal wrote shows it open over an unchanged policy
 * page with the approved version unmoved behind it.
 *
 * Then it said the run that stopped at the file chooser had written nothing. It had: confirming that modal
 * with `Import policy` creates a **Draft version** row on the policy — *"Via file upload / English / Not
 * started"*, with `Approval not started` beneath it — while the approved version stays exactly where it
 * was. Reproduce by photographing the policy page after a run that stopped there.
 *
 * So the write boundary is the modal's CONFIRM, and `wrote` is true from it. Both wrong versions of this
 * paragraph failed the same way: they described the boundary from the code rather than from a photograph of
 * the page, and the page is the only thing that knows.
 *
 * With `pdfPath` null this stops at the modal and reports what it offers, having written nothing.
 *
 * ## What it refuses rather than guesses
 *
 * No control named {@link RENEW_WITH_UPDATES_NAME}; more than one file input, or none once the flow is
 * open; a page whose only forward control is one of {@link PUBLISHING_CONTROL_NAMES}. Each refusal names
 * what it saw, because the next person to run this needs to know which of Vanta's screens moved.
 *
 * It never clicks a publishing control, and it never clicks `Renew without updates`.
 *
 * @param url the policy page to open, tenant segment included
 * @param settleMs how long to let each step settle
 * @param screenshotPath where the picture after the upload is written
 * @param beforeScreenshotPath where the picture of the policy page BEFORE anything was clicked is written
 * @param pdfPath the PDF to attach, or null to stop with the new-version modal open, before any draft exists,
 * and report what the modal offers
 * @returns the snippet source
 */
// max-lines-exempt: one snippet is one template literal; every statement in it is fixed source that runs in the owner's Chrome, and splitting it across builders is exactly what `relaySession.ts` refuses (a caller must choose an operation, never assemble code).
export function vantaPolicyVersionUploadSnippet({
  url,
  settleMs,
  screenshotPath,
  beforeScreenshotPath,
  pdfPath,
}: {
  url: string;
  settleMs: number;
  screenshotPath: string;
  beforeScreenshotPath: string;
  pdfPath: string | null;
}): string {
  return `async (page) => {
  const url = ${JSON.stringify(url)};
  const settleMs = ${JSON.stringify(settleMs)};
  const screenshotPath = ${JSON.stringify(screenshotPath)};
  const beforeScreenshotPath = ${JSON.stringify(beforeScreenshotPath)};
  const pdfPath = ${JSON.stringify(pdfPath)};
  const renewName = ${JSON.stringify(RENEW_WITH_UPDATES_NAME)};
  const publishing = ${JSON.stringify(PUBLISHING_CONTROL_NAMES)};
  function out(extra) {
    return JSON.stringify(Object.assign({ finalUrl: page.url() }, extra));
  }
  try {
    await page.goto(url, { timeout: 45000, waitUntil: "load" });
  } catch (error) {
    return out({ failure: String(error) });
  }
  await page.waitForTimeout(settleMs);
  async function photograph() {
    try {
      await page.bringToFront();
      await page.screenshot({ fullPage: true, path: screenshotPath, timeout: 8000 });
      return true;
    } catch (error) {
      return false;
    }
  }
  try {
    await page.bringToFront();
    await page.screenshot({ fullPage: true, path: beforeScreenshotPath, timeout: 8000 });
  } catch (error) {
    // A picture that did not land does not stop the run; the report says which ones exist.
  }
  // Expand ONLY the allowlisted renewal card, so its controls exist in the DOM. Nothing else is clicked.
  try {
    const marked = await page.evaluate((args) => {
${READ_MENU}
      return allowedDisclosures(args.prefixes).length;
    }, { prefixes: ${JSON.stringify(DISCLOSURE_PREFIXES)} });
    for (let index = 0; index < marked && index < 12; index += 1) {
      try {
        await page.locator('[data-slopweaver-disclosure="' + index + '"]').first().click({ timeout: 5000 });
        await page.waitForTimeout(400);
      } catch (error) {
        // One card that will not open does not stop the rest.
      }
    }
  } catch (error) {
    // No disclosures is not a failure; the renewal control may already be visible.
  }
  await page.waitForTimeout(1000);
  // A draft left without a file is completed rather than duplicated: re-running the modal makes a SECOND
  // draft, which is the one irreversible mess this arm can make by being careless.
  const draftNames = ${JSON.stringify(DRAFT_UPLOAD_NAMES)};
  const existingDraft = await page.evaluate((args) => {
${READ_MENU}
    const buttons = Array.from(document.querySelectorAll("button")).filter(function (node) {
      return args.names.indexOf(accessibleName(node)) !== -1;
    });
    const draftShown = (document.body.innerText || "").indexOf("Draft version") !== -1;
    if (!draftShown || buttons.length !== 1) {
      return { found: false };
    }
    buttons[0].setAttribute("data-slopweaver-draft-upload", "1");
    return { found: true };
  }, { names: draftNames });
  if (existingDraft.found && pdfPath !== null) {
    let attachedToDraft = false;
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 20000 }),
        page.locator("[data-slopweaver-draft-upload]").first().click({ timeout: 10000 }),
      ]);
      await chooser.setFiles(pdfPath);
      attachedToDraft = true;
    } catch (error) {
      attachedToDraft = false;
    }
    if (!attachedToDraft) {
      const draftInputs = page.locator('input[type="file"]');
      if ((await draftInputs.count()) === 0) {
        return out({ refused: "this policy already has a draft version, but its Upload control neither opened a file chooser nor revealed a file input", screenshotWritten: await photograph(), stage: "draft-upload", wrote: false });
      }
      try {
        await draftInputs.first().setInputFiles(pdfPath, { timeout: 20000 });
      } catch (error) {
        return out({ refused: "could not attach the PDF to the existing draft: " + String(error), screenshotWritten: await photograph(), stage: "draft-upload", wrote: false });
      }
    }
    await page.waitForTimeout(settleMs);
    // The modal asks whether the version needs approval. The default is correct; the other option would
    // record an approval nobody gave, so a page offering only that one is refused rather than clicked.
    const approvalGuard = await page.evaluate((args) => {
${READ_MENU}
      function radioLabelText(radio) {
        const parts = [];
        if (radio.labels) {
          Array.from(radio.labels).forEach(function (label) { parts.push((label.innerText || "").trim()); });
        }
        const labelled = labelledByText(radio);
        if (labelled.length > 0) {
          parts.push(labelled);
        }
        const aria = radio.getAttribute("aria-label");
        if (typeof aria === "string" && aria.trim().length > 0) {
          parts.push(aria.trim());
        }
        return parts.filter(function (part) { return part.length > 0; }).join(" ");
      }
      const radios = Array.from(document.querySelectorAll('[role="dialog"] input[type="radio"], [role="dialog"] [role="radio"]'));
      const checked = radios.filter(function (radio) {
        return radio.checked === true || radio.getAttribute("aria-checked") === "true";
      });
      const checkedTexts = checked.map(radioLabelText);
      return {
        checkedCount: checked.length,
        checkedTexts: checkedTexts,
        confirmedNeedsApproval: checked.length === 1 && checkedTexts[0].indexOf(args.needed) === 0,
        radioCount: radios.length,
      };
    }, { needed: ${JSON.stringify(APPROVAL_NEEDED_LABEL)} });
    // FAIL CLOSED: when the modal asks the approval question at all, proceed only on a positive read that
    // the single checked option is the one saying the version still needs approval.
    if (approvalGuard.radioCount > 0 && !approvalGuard.confirmedNeedsApproval) {
      return out({ refused: "the upload modal's approval option could not be confirmed as " + ${JSON.stringify(APPROVAL_NEEDED_LABEL)} + " (checked: " + (approvalGuard.checkedTexts.join(" | ") || "none") + "), so Upload was not clicked", screenshotWritten: await photograph(), stage: "approval-guard", wrote: true });
    }
    const finalUpload = await page.evaluate((args) => {
${READ_MENU}
      const buttons = Array.from(document.querySelectorAll("button")).filter(function (node) {
        return args.names.indexOf(accessibleName(node)) !== -1 && node.closest('[role="dialog"]') !== null;
      });
      if (buttons.length === 0) {
        return { found: false };
      }
      buttons[buttons.length - 1].setAttribute("data-slopweaver-final-upload", "1");
      return { found: true };
    }, { names: draftNames });
    if (!finalUpload.found) {
      return out({ refused: "the file is selected but the upload modal offers no Upload control inside it", screenshotWritten: await photograph(), stage: "final-upload", wrote: true });
    }
    try {
      await page.locator("[data-slopweaver-final-upload]").first().click({ timeout: 15000 });
    } catch (error) {
      return out({ refused: "could not confirm the upload: " + String(error), screenshotWritten: await photograph(), stage: "final-upload", wrote: true });
    }
    await page.waitForTimeout(settleMs);
    const settled = await page.evaluate(() => {
${READ_MENU}
      return {
        controls: Array.from(document.querySelectorAll("button")).map(accessibleName).filter(function (l) { return l.length > 0; }),
        text: (document.body.innerText || "").slice(0, 4000),
      };
    });
    return out({ attached: true, confirmed: "existing draft", controls: settled.controls, screenshotWritten: await photograph(), stage: "attached", text: settled.text, wrote: true });
  }
  const located = await page.evaluate((args) => {
${READ_MENU}
    const matches = Array.from(document.querySelectorAll("button")).filter(function (node) {
      return accessibleName(node) === args.renewName;
    });
    if (matches.length !== 1) {
      return { count: matches.length };
    }
    matches[0].setAttribute("data-slopweaver-renew", "1");
    return { count: 1 };
  }, { renewName: renewName });
  if (located.count !== 1) {
    return out({ refused: "the policy page shows " + located.count + " control(s) named " + renewName + ", so nothing was clicked", stage: "locate", wrote: false });
  }
  try {
    await page.locator("[data-slopweaver-renew]").first().click({ timeout: 10000 });
  } catch (error) {
    return out({ refused: "could not click " + renewName + ": " + String(error), stage: "renew", wrote: false });
  }
  await page.waitForTimeout(settleMs);
  // The modal is open and NOTHING is written yet. Choose the one option that takes a file.
  const importName = ${JSON.stringify(IMPORT_EXISTING_NAME)};
  const chosen = await page.evaluate((args) => {
${READ_MENU}
    const options = Array.from(document.querySelectorAll('[role="radio"], input[type="radio"], label'));
    const match = options.filter(function (node) { return accessibleName(node) === args.importName; });
    if (match.length === 0) {
      return { found: false };
    }
    match[0].setAttribute("data-slopweaver-import", "1");
    return { found: true };
  }, { importName: importName });
  if (chosen.found) {
    try {
      await page.locator("[data-slopweaver-import]").first().click({ timeout: 8000 });
      await page.waitForTimeout(2000);
    } catch (error) {
      return out({ refused: "could not choose " + importName + ": " + String(error), stage: "choose-import", wrote: false });
    }
  }
  const opened = await page.evaluate((args) => {
${READ_MENU}
    const controls = Array.from(document.querySelectorAll('button, [role="tab"], label'))
      .map(accessibleName)
      .filter(function (l) { return l.length > 0 && l.length < 120; });
    return {
      chose: args.chose,
      controls: controls,
      fileInputs: fileInputs(),
      publishingOnly: controls.length > 0 && controls.every(function (l) { return args.publishing.indexOf(l) !== -1; }),
      text: (document.body.innerText || "").slice(0, 4000),
    };
  }, { chose: chosen.found, publishing: publishing });
  if (pdfPath === null) {
    return out({ controls: opened.controls, fileInputs: opened.fileInputs, screenshotWritten: await photograph(), stage: "opened", text: opened.text, wrote: false });
  }
  if (opened.publishingOnly) {
    return out({ controls: opened.controls, refused: "the only controls this screen offers would submit or publish the version, and this arm never clicks one", screenshotWritten: await photograph(), stage: "publish-only", wrote: false });
  }
  if (!opened.chose) {
    return out({ controls: opened.controls, refused: "the new-version modal offers no option named " + importName + ", and the other options open Vanta's own editor rather than taking a file", screenshotWritten: await photograph(), stage: "choose-import", wrote: false });
  }
  // The file input does not exist until the upload card is clicked: the file arrives through Chrome's own
  // file chooser. Marking the card first keeps the click bound to a control this snippet named.
  const cardNames = ${JSON.stringify(UPLOAD_CARD_NAMES)};
  const card = await page.evaluate((args) => {
${READ_MENU}
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], div'));
    const match = nodes.filter(function (node) {
      const name = accessibleName(node);
      return args.names.some(function (want) { return name.indexOf(want) === 0 && name.length < 200; });
    });
    if (match.length === 0) {
      return { found: false };
    }
    match[match.length - 1].setAttribute("data-slopweaver-upload-card", "1");
    return { found: true };
  }, { names: cardNames });
  if (!card.found) {
    return out({ controls: opened.controls, refused: "the import modal offers no card named " + cardNames.join(" / ") + ", so no file could be chosen", screenshotWritten: await photograph(), stage: "upload-card", wrote: false });
  }
  try {
    await page.locator("[data-slopweaver-upload-card]").first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
  } catch (error) {
    return out({ refused: "could not select the upload card: " + String(error), screenshotWritten: await photograph(), stage: "upload-card", wrote: false });
  }
  // The confirm button is what asks Chrome for the file, so the click and the chooser are raced together.
  const confirmNames = ${JSON.stringify(CONFIRM_VERSION_NAMES)};
  const confirm = await page.evaluate((args) => {
${READ_MENU}
    const buttons = Array.from(document.querySelectorAll("button")).filter(function (node) {
      return args.names.indexOf(accessibleName(node)) !== -1 && args.publishing.indexOf(accessibleName(node)) === -1;
    });
    if (buttons.length === 0) {
      return { found: null };
    }
    buttons[0].setAttribute("data-slopweaver-confirm", "1");
    return { found: accessibleName(buttons[0]) };
  }, { names: confirmNames, publishing: publishing });
  if (confirm.found === null) {
    return out({ controls: opened.controls, refused: "the import modal offers no control named " + confirmNames.join(" / ") + ", so no file was chosen and no version was created", screenshotWritten: await photograph(), stage: "confirm", wrote: false });
  }
  // Everything from here has WRITTEN: confirming the modal creates the draft version row.
  let chooserSeen = false;
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 25000 }),
      page.locator("[data-slopweaver-confirm]").first().click({ timeout: 15000 }),
    ]);
    await chooser.setFiles(pdfPath);
    chooserSeen = true;
  } catch (error) {
    // The click may have landed without a chooser: some builds insert the input instead. Try that next.
    chooserSeen = false;
  }
  if (!chooserSeen) {
    const inputs = page.locator('input[type="file"]');
    const inputCount = await inputs.count();
    if (inputCount === 0) {
      return out({ controls: opened.controls, refused: "clicking " + confirm.found + " neither opened a file chooser nor revealed a file input, so the draft version was created EMPTY", screenshotWritten: await photograph(), stage: "attach", wrote: true });
    }
    try {
      await inputs.first().setInputFiles(pdfPath, { timeout: 20000 });
    } catch (error) {
      return out({ refused: "could not attach the PDF: " + String(error), screenshotWritten: await photograph(), stage: "attach", wrote: true });
    }
  }
  await page.waitForTimeout(settleMs);
  const after = await page.evaluate(() => {
${READ_MENU}
    return {
      controls: Array.from(document.querySelectorAll("button")).map(accessibleName).filter(function (l) { return l.length > 0; }),
      text: (document.body.innerText || "").slice(0, 4000),
    };
  });
  return out({ attached: true, confirmed: confirm.found, controls: after.controls, screenshotWritten: await photograph(), stage: "attached", text: after.text, wrote: true });
}`;
}
