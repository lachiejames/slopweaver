/**
 * `slopweaver notion page move` — the one page mutation that sends no content.
 *
 * Its own file because it is its own decision. Every other lane in this verb is about a page's BODY: create
 * writes one, update replaces one, archive takes one away. A move touches none of it — the id, the URL and
 * every block survive — so the gate it owes is different, and folding it in beside the update lane made the
 * two read as variations of one act when they are not.
 *
 * ## What a move is gated on, and what it deliberately is not
 *
 * **Gated on ownership.** Relocating a page slopweaver never created moves work that was never ours, and the
 * ledger is the only local evidence either way. `--adopt` recovers a create whose response was lost, exactly
 * as it does for `update`, and on the same provider-side authorship evidence.
 *
 * **NOT gated on an external edit.** That refusal exists because an update DESTROYS what a human wrote. A
 * move destroys nothing, so a page a colleague has been editing all week moves with no flag at all —
 * demanding `--overwrite-external-edit` here would have been ceremony borrowed from a different risk.
 *
 * ## The read-back is the claim
 *
 * Notion answers a move with a page object, which is what the provider says it did rather than what the page
 * now is. So this lane reads the parent back and reports `moved` only when the page itself agrees; an
 * accepted move that landed elsewhere is `unconfirmed`, and a page ALREADY under the requested parent is
 * `unmoved` with nothing sent at all.
 */
import type { WrittenPage } from "../../../corpus/notion/writeApi.js";
import { adoptPage, confirmPageMove } from "../../../outbound/notion/pageLedger.js";
import { pageOwnershipOf } from "../../../outbound/notion/pageOwnership.js";
import { EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";
import { botIsLastEditor, externalEditDescription } from "./authorship.js";
import { type NotionPageOutcome, sameNotionId } from "./pageCore.js";
import { mutationFailure } from "./pagePerform.js";
import { canonicalOf, refuse, report, routeThroughDoor, type WriteContext } from "./writeContext.js";

/**
 * What the pre-move checks concluded.
 *
 * Its own type rather than the update lane's, and the difference is the point: that gate's `go` arm carries
 * the page's prior canonical digest, because an update has to be able to report an identical re-publish as a
 * no-op. A move reads no content and changes none, so it has no digest to carry and borrowing the shape
 * would have meant inventing one.
 */
type MoveGate =
  | { readonly go: true }
  | { readonly adopt: true; readonly url: string; readonly canonical: string }
  | { readonly reason: string };

/**
 * Re-parent the page, then read its parent back before claiming it moved.
 *
 * The read-back is the whole proof. Notion's move endpoint answers with a page object, but a response body
 * is what the provider says it did rather than what the page now is, and this verb's only claim worth making
 * is where the page actually hangs. A response that comes back naming a different parent — or naming none —
 * is reported `unconfirmed` rather than as a move that worked.
 */
async function performMove({ ctx }: { ctx: WriteContext }): Promise<NotionPageOutcome> {
  // `moveTo!` is honest rather than defensive: `parseNotionPageArgs` REFUSES a move without `--to` and
  // `runLive` refuses an address that will not resolve, so a fallback here could only hide a regression.
  const target = ctx.moveTo!;
  const before = await ctx.api.retrievePage({ pageId: ctx.destination });
  if (before.isErr() || before.value === undefined) {
    return { kind: "failed", reason: `page ${ctx.destination} could not be read, so it was not moved` };
  }
  const from = before.value.parent?.id;
  if (sameNotionId({ left: from, right: target })) {
    return { kind: "unmoved", pageId: ctx.destination, parentPageId: target, url: before.value.url };
  }
  const moved = await ctx.api.movePage({ pageId: ctx.destination, parentPageId: target });
  if (moved.isErr()) {
    return mutationFailure({ error: moved.error });
  }
  const after = await ctx.api.retrievePage({ pageId: ctx.destination });
  if (after.isErr() || after.value === undefined) {
    return {
      kind: "unconfirmed",
      pageId: ctx.destination,
      reason: "the move was accepted but the page could not be read back, so where it now hangs is unverified",
      url: before.value.url,
    };
  }
  if (!sameNotionId({ left: after.value.parent?.id, right: target })) {
    return {
      kind: "unconfirmed",
      pageId: ctx.destination,
      reason:
        `the move was accepted but the page reads back under ${readBackParentWords({ page: after.value })}, ` +
        `not ${target}`,
      url: after.value.url,
    };
  }
  confirmPageMove({ home: ctx.home, nowIso: ctx.deps.nowIso(), pageId: ctx.destination, parentPageId: target });
  return {
    fromParentId: from,
    kind: "moved",
    pageId: ctx.destination,
    parentPageId: target,
    url: after.value.url,
  };
}

/**
 * Where a page read back as hanging, in the words an unconfirmed move reports: its parent's id, or — for a
 * workspace-parented page, or one Notion returned with no parent object — that it has no page parent.
 */
function readBackParentWords({ page }: { page: WrittenPage }): string {
  const { parent } = page;
  if (parent === undefined) {
    return "no page parent";
  }
  const { id } = parent;
  if (id === undefined) {
    return "no page parent";
  }
  return id;
}

/**
 * Decide whether a move may proceed.
 *
 * The ownership half is the update lane's, for the same reason: relocating a page slopweaver never created
 * moves work that was never ours, and the ledger is the only evidence either way. The external-edit half is
 * deliberately ABSENT — that refusal exists because an update destroys what a human wrote, and a move
 * destroys nothing — so a page a colleague has been editing all week still moves without a flag.
 *
 * @param ctx the resolved write context
 * @returns permission to proceed, the adopt-and-stop path, or the refusal
 */
async function moveGate({ ctx }: { ctx: WriteContext }): Promise<MoveGate> {
  const target = ctx.moveTo!;
  if (sameNotionId({ left: ctx.destination, right: target })) {
    return { reason: `a page cannot be its own parent: --page and --to are both ${ctx.destination}` };
  }
  const ownership = pageOwnershipOf({ home: ctx.home, pageId: ctx.destination, purpose: "move" });
  if (ownership.owned) {
    return { go: true };
  }
  const authorship = await botIsLastEditor({ api: ctx.api, pageId: ctx.destination });
  if ("reason" in authorship) {
    return { reason: authorship.reason };
  }
  if ("externalEdit" in authorship) {
    return { reason: externalEditDescription({ edit: authorship }) };
  }
  if (!ctx.args.adopt) {
    return {
      reason: `${ownership.reason}\nThe integration IS this page's last editor, so if slopweaver did write it, re-run with --adopt to record that and then move.`,
    };
  }
  const canonical = await canonicalOf({ ctx });
  return "reason" in canonical
    ? { reason: canonical.reason }
    : { adopt: true, canonical: canonical.hash, url: authorship.url };
}

/**
 * Run the move lane: gate, then either adopt, or route the re-parent through the door.
 *
 * @param ctx the resolved write context, carrying the subject page and the parent it is bound for
 * @returns the process exit code
 */
export async function runMove({ ctx }: { ctx: WriteContext }): Promise<number> {
  const gate = await moveGate({ ctx });
  if ("reason" in gate) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps: ctx.deps, lines: [gate.reason] });
  }
  if ("adopt" in gate) {
    adoptPage({
      canonical: gate.canonical,
      home: ctx.home,
      nowIso: ctx.deps.nowIso(),
      pageId: ctx.destination,
      url: gate.url,
    });
    return report({ deps: ctx.deps, outcome: { kind: "adopted", pageId: ctx.destination, url: gate.url } });
  }
  return routeThroughDoor({ ctx, perform: () => performMove({ ctx }) });
}
