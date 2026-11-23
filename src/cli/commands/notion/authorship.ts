/**
 * The provider's OWN authorship evidence for one Notion page, shared by every verb that rewrites one.
 *
 * Notion attributes an internal integration's writes to its own bot user, unlike Linear, whose personal API
 * key attributes every write to the human who owns it. So this is real remote evidence rather than a local
 * assertion, and it is what makes the overwrite check, `--adopt` and the image attach pass honest rather
 * than merely careful.
 *
 * It lives in its own module because two verbs need it. Duplicating fifteen lines would have been smaller
 * today and would have drifted the first time either verb's refusal wording was improved.
 *
 * ## A human touch is not necessarily a human EDIT
 *
 * Notion rewrites `last_edited_by` on some actions the API exposes no content for at all — a mermaid
 * diagram's display-mode toggle is the measured case. Since the only way to become
 * last editor again is an update, and an update was exactly what this check refused, a single such click
 * locked slopweaver out of a page it authored FOREVER. `resolveExternalEdit` is the fix: it treats a
 * byte-identical canonical read as no edit at all, and reserves `--overwrite-external-edit` for a content
 * difference that is real.
 *
 * ## What byte-identical cannot see, stated rather than left to be discovered
 *
 * The same leniency has a known cost: a Notion table's COLUMN WIDTHS are layout and never appear in
 * `retrieveMarkdown`, in either of its spellings. So dragging a column wider makes a colleague the page's
 * last editor while leaving the canonical markdown byte-identical, this check waves the write through, and
 * the update — which replaces every block — resets the widths. That is the right trade (the alternative
 * locks slopweaver out of every page anyone has ever touched) but it is not a free one, so the resolution
 * carries a {@link ExternalEditResolution.blindSpot} line whenever it takes that path over a page that
 * actually has a table, and the write reports it.
 */
import type { NotionWriteApi, WrittenPage } from "../../../corpus/notion/writeApi.js";
import { type ExternalEditOverride, recordExternalEditOverride } from "../../../outbound/notion/pageLedger.js";

/** The flag that overwrites a genuine external edit, and the reason it always demands. */
const EXTERNAL_EDIT_OVERRIDE_FLAG = "--overwrite-external-edit";

/**
 * Either the provider says the bot is this page's last editor, the page was last touched by someone else
 * (which is not yet a refusal — see {@link resolveExternalEdit}), or a hard failure that no override can fix.
 */
export type LastEditorCheck =
  | { readonly yes: true; readonly url: string }
  | {
      readonly externalEdit: true;
      readonly url: string;
      readonly lastEditedBy: string;
      readonly lastEditedTime: string;
    }
  | { readonly reason: string };

/**
 * Whether the integration itself is the page's last editor.
 *
 * @param api the Notion write seam
 * @param pageId the page being checked
 * @returns `yes` when the bot is the last editor, `externalEdit` naming who touched it and when, or a hard
 *   failure that means authorship could not be checked at all
 */
export async function botIsLastEditor({
  api,
  pageId,
}: {
  api: NotionWriteApi;
  pageId: string;
}): Promise<LastEditorCheck> {
  const bot = await api.botUserId();
  if (bot.isErr()) {
    return {
      reason: `could not read the integration's own user id, so authorship cannot be checked: ${bot.error.message}`,
    };
  }
  const page = await api.retrievePage({ pageId });
  if (page.isErr()) {
    return { reason: `could not read the page back before rewriting it: ${page.error.message}` };
  }
  if (page.value === undefined) {
    return { reason: `page ${pageId} does not exist, so there is nothing to update` };
  }
  if (page.value.lastEditedBy !== bot.value) {
    return {
      externalEdit: true,
      lastEditedBy: lastEditWords({ key: "lastEditedBy", page: page.value }),
      lastEditedTime: lastEditWords({ key: "lastEditedTime", page: page.value }),
      url: page.value.url,
    };
  }
  return { url: page.value.url, yes: true };
}

/** What the operator is told when Notion's read-back omits who last edited a page, or when. */
const UNKNOWN_LAST_EDIT = { lastEditedBy: "an unknown user", lastEditedTime: "an unknown time" } as const;

/** Who last edited a page, or when, as the external-edit report words it: Notion's value, or that it is unknown. */
function lastEditWords({ page, key }: { page: WrittenPage; key: keyof typeof UNKNOWN_LAST_EDIT }): string {
  const value = page[key];
  if (value === undefined) {
    return UNKNOWN_LAST_EDIT[key];
  }
  return value;
}

/**
 * What happened to the page, in the operator's words, with no mention of how to proceed — a page absent
 * from the ledger cannot be overwritten by this flag no matter who touched it, so that hint does not belong
 * here.
 *
 * @param edit the external-edit evidence
 * @returns the plain description of who touched the page and what an update would destroy
 */
export function externalEditDescription({
  edit,
}: {
  edit: { readonly lastEditedBy: string; readonly lastEditedTime: string };
}): string {
  return (
    `this page was last edited by ${edit.lastEditedBy} at ${edit.lastEditedTime}, not by slopweaver. An update ` +
    "REPLACES the page's whole content, so that edit would be destroyed. Copy the change into your draft " +
    "first, then re-publish."
  );
}

/**
 * The operator-facing refusal for a genuine external edit on a page slopweaver owns, naming the break-glass
 * flag.
 *
 * @param edit the external-edit evidence
 * @returns the refusal, ending with how to overwrite it deliberately
 */
export function externalEditRefusal({
  edit,
}: {
  edit: { readonly lastEditedBy: string; readonly lastEditedTime: string };
}): string {
  return (
    `${externalEditDescription({ edit })}\n` +
    `To overwrite it anyway, re-run with ${EXTERNAL_EDIT_OVERRIDE_FLAG} "<why>". The reason, and who last ` +
    "edited the page and when, are journaled."
  );
}

/** What an external-edit check settled: nothing needed bypassing, a genuine edit was journaled and bypassed, or a refusal. */
export type ExternalEditResolution =
  | {
      readonly overridden: boolean;
      /**
       * What this check could not see on the page it just cleared, or undefined when there is nothing to
       * say. Only ever set on the byte-identical path over a page carrying a table — see this module's
       * header. It is a REPORT rather than a refusal: the write proceeds either way.
       */
      readonly blindSpot: string | undefined;
    }
  | { readonly reason: string };

/** The one thing the byte-identical path is known to miss, in the words the operator is shown. */
const TABLE_WIDTH_BLIND_SPOT =
  "note: this page was touched by someone else, and its content read back byte-identical, so the touch was " +
  "treated as no edit. The page carries a table, and a table's COLUMN WIDTHS never appear in Notion's " +
  "markdown — so if what they changed was a column width, this write has just reset it. Nothing here can " +
  "see that; check the page if the layout mattered.";

/**
 * Decide whether a write may proceed despite the provider's authorship evidence.
 *
 * Bot-authored (`yes`) needs no decision at all. A human touch (`externalEdit`) is resolved by comparing the
 * page's CURRENT canonical content against what slopweaver last confirmed for it: byte-identical means the
 * touch changed nothing a diff could see, so it is treated as no edit; anything else is a genuine edit, and
 * proceeds only when the caller gave `--overwrite-external-edit "<why>"`, which is journaled here before the
 * write is allowed to continue.
 *
 * @param authorship the provider's authorship check for this page
 * @param priorCanonical the digest slopweaver last confirmed for this page, or undefined when it holds none
 * @param canonical the page's canonical digest right now
 * @param home the state home the override is journaled under
 * @param pageId the page being written to
 * @param overwriteReason the caller's `--overwrite-external-edit` reason, or undefined when the flag was not given
 * @param nowIso when the override (if any) is journaled
 * @param carriesTable whether the page has a table, which is the one thing the byte-identical path is blind to
 * @returns `overridden: false` when the write may proceed with nothing to journal, `overridden: true` when it
 *   may proceed and a genuine edit was journaled, or the refusal naming the flag
 */
export function resolveExternalEdit({
  authorship,
  priorCanonical,
  canonical,
  home,
  pageId,
  overwriteReason,
  nowIso,
  carriesTable = false,
}: {
  authorship: LastEditorCheck;
  priorCanonical: string | undefined;
  canonical: string;
  home: string;
  pageId: string;
  overwriteReason: string | undefined;
  nowIso: string;
  carriesTable?: boolean;
}): ExternalEditResolution {
  if (!("externalEdit" in authorship)) {
    return { blindSpot: undefined, overridden: false };
  }
  if (priorCanonical === canonical) {
    // The touch changed nothing a diff can see — but a table's column widths are not something a diff CAN
    // see, so the one case where that inference is unsafe says so instead of passing silently.
    return { blindSpot: carriesTable ? TABLE_WIDTH_BLIND_SPOT : undefined, overridden: false };
  }
  if (overwriteReason === undefined) {
    return { reason: externalEditRefusal({ edit: authorship }) };
  }
  const override: ExternalEditOverride = {
    canonicalHash: canonical,
    lastEditedBy: authorship.lastEditedBy,
    lastEditedTime: authorship.lastEditedTime,
    nowIso,
    pageId,
    reason: overwriteReason,
  };
  recordExternalEditOverride({ home, override });
  return { blindSpot: undefined, overridden: true };
}
