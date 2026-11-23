/**
 * `slopweaver notion page` — the effectful shell. Every decision lives in `./pageCore.ts`; this file
 * resolves the home and token, routes the effect through the admit door, and hands the mutation to
 * `./pagePerform.ts` (or `./moveRun.ts` for a move).
 *
 * ## The order is the contract
 *
 *   parse → preflight body → [dry-run stops here] → token → resolve address → ownership → door → reserve →
 *   mutate → read back → confirm → report
 *
 * Four points are load-bearing rather than incidental:
 *
 *  - **The dry run stops before ANY effect.** No token, no door record, no ledger, no network. A preview
 *    that left a reservation behind would make the next real run look like a duplicate.
 *  - **The reservation is taken INSIDE `perform`**, so a door refusal cannot leave a claimed intent behind.
 *  - **A create whose response is lost is `indeterminate`, never a retry.** Notion assigns the page id, so
 *    unlike the Linear lane there is no address to ask about afterwards. `--adopt` is the recovery path.
 *  - **An update REPLACES the page's whole content.** Notion's `replace_content` keeps the page id and URL,
 *    which is what makes a re-publish keep its links, and is also why `update` refuses on anything short of
 *    proof that the page is slopweaver's and nobody else has edited it since.
 *  - **A MOVE sends no content at all**, so it takes the ownership half of that gate and not the
 *    external-edit half, and it proves itself by reading the page's parent back rather than by trusting the
 *    response. `archive` and `move` are also the two sub-commands whose dry run has to be handled
 *    separately: they skip the body path, and that skip once reached the live lane, so `--dry-run` archived.
 */
import { type NestedLinkIssue, nestedLinkIssues } from "../../../outbound/notion/nestedLinks.js";
import { adoptPage, intentDigest } from "../../../outbound/notion/pageLedger.js";
import { pageOwnershipOf } from "../../../outbound/notion/pageOwnership.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { botIsLastEditor, externalEditDescription, resolveExternalEdit } from "./authorship.js";
import { notionCommandErrorLines } from "./errors.js";
import { mediaBaseOf } from "./mediaBase.js";
import { runMove } from "./moveRun.js";
import { type NotionPageArgs, parseNotionPageArgs, parseNotionPageBody } from "./pageCore.js";
import { performArchive, performCreate, performUpdate } from "./pagePerform.js";
import { notionMoveDryRunLines, notionPageDryRunLines } from "./pagePreview.js";
import { previewAddress } from "./previewAddress.js";
import {
  aboveFoldRefused,
  canonicalOf,
  linkifiedNotionBody,
  type NotionPageDeps,
  productionNotionPageDeps,
  refuse,
  report,
  resolvePageId,
  routeThroughDoor,
  type UpdateGate,
  type WriteContext,
} from "./writeContext.js";

/** Where this verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/**
 * Decide whether an update may proceed.
 *
 * Two independent checks, because each answers a question the other cannot. The LEDGER says slopweaver
 * created the page; the provider's `last_edited_by` says nobody else has touched it since. A page absent
 * from the ledger is refused unless `--adopt` is given, and even then only on the provider's evidence — an
 * external edit there is a hard refusal regardless of `--overwrite-external-edit`, since the flag exists to
 * overwrite a page slopweaver already owns, not to establish ownership of one it does not.
 *
 * A page slopweaver DOES own gets the smarter check: `resolveExternalEdit` treats a byte-identical touch as
 * no edit at all, and journals a genuine one only when the caller gave the flag.
 */
async function updateGate({ ctx }: { ctx: WriteContext }): Promise<UpdateGate> {
  const authorship = await botIsLastEditor({ api: ctx.api, pageId: ctx.destination });
  const ownership = pageOwnershipOf({ home: ctx.home, pageId: ctx.destination });
  const canonical = await canonicalOf({ ctx });
  if ("reason" in canonical) {
    return { reason: canonical.reason };
  }
  if ("reason" in authorship) {
    return { reason: authorship.reason };
  }
  if (!ownership.owned) {
    if ("externalEdit" in authorship) {
      return { reason: externalEditDescription({ edit: authorship }) };
    }
    return ctx.args.adopt
      ? { adopt: true, canonical: canonical.hash, url: authorship.url }
      : {
          reason: `${ownership.reason}\nThe integration IS this page's last editor, so if slopweaver did write it, re-run with --adopt to record that and then update.`,
        };
  }
  const resolved = resolveExternalEdit({
    authorship,
    canonical: canonical.hash,
    carriesTable: canonical.carriesTable,
    home: ctx.home,
    nowIso: ctx.deps.nowIso(),
    overwriteReason: ctx.args.overwriteExternalEdit,
    pageId: ctx.destination,
    priorCanonical: ownership.record.lastCanonicalHash,
  });
  if ("reason" in resolved) {
    return { reason: resolved.reason };
  }
  const last = ownership.record.lastCanonicalHash;
  if (!resolved.overridden && last !== undefined && last !== canonical.hash) {
    return {
      reason:
        "this page's content has changed since slopweaver last wrote it, even though the integration is " +
        "still its last editor. Replacing it would discard whatever changed. Re-read the page and rebuild " +
        "your draft from it, then re-publish.",
    };
  }
  // The prior digest travels forward so the write can report an identical re-publish as a visible no-op.
  // It cannot be decided BEFORE the write: what a body canonicalises to is Notion's answer, not ours, and
  // guessing it locally is exactly the drift the deleted block converter would have carried.
  return { go: true, note: resolved.blindSpot, priorCanonical: canonical.hash };
}

/** Run the update lane: gate, then either adopt, report no-op, or route the replace through the door. */
async function runUpdate({ ctx }: { ctx: WriteContext }): Promise<number> {
  const gate = await updateGate({ ctx });
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
  if (gate.note !== undefined) {
    ctx.deps.out(gate.note);
  }
  return routeThroughDoor({ ctx, perform: () => performUpdate({ ctx, priorCanonical: gate.priorCanonical }) });
}

/** The effect phase: token, address, then the create or update lane. */
async function runLive({
  args,
  deps,
  body,
}: {
  args: NotionPageArgs;
  deps: NotionPageDeps;
  body: string;
}): Promise<number> {
  const home = resolveHome({ named: args.home });
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: [`no Notion token for this home. Set NOTION_TOKEN, or run \`slopweaver connect notion\``],
    });
  }
  const address = resolvePageId({ address: subjectAddress({ args }) });
  if (!address.isOk()) {
    return refuse({ code: EXIT_USAGE, deps, lines: [address.error.message] });
  }
  const moveTo = args.verb === "move" ? resolvePageId({ address: args.to! }) : undefined;
  if (moveTo !== undefined && !moveTo.isOk()) {
    return refuse({ code: EXIT_USAGE, deps, lines: [moveTo.error.message] });
  }
  // ONE client for both seams, its every write judged under the policy of the home resolved above.
  const { api, mediaApi } = deps.makeApis({ home, token });
  const ctx: WriteContext = {
    api,
    args,
    body,
    deps,
    destination: address.value,
    home,
    mediaApi,
    mediaBase: mediaBaseOf({ args }),
    moveTo: moveTo?.isOk() === true ? moveTo.value : undefined,
    // Only a create has an intent: nothing else is reserved and nothing else can be a duplicate. Every other
    // sub-command names ITSELF and its subject, so the door record says what was admitted rather than a
    // digest claiming a create — and `update:` for a move would have made the ledger describe the wrong act.
    intent:
      args.verb === "create"
        ? intentDigest({ body, parentPageId: address.value, title: args.title! })
        : `${args.verb}:${address.value}`,
  };
  if (args.verb === "update") {
    return runUpdate({ ctx });
  }
  if (args.verb === "move") {
    return runMove({ ctx });
  }
  const perform = args.verb === "create" ? () => performCreate({ ctx }) : () => performArchive({ ctx });
  return routeThroughDoor({ ctx, perform });
}

/**
 * The `--page`/`--parent` address this invocation is about.
 *
 * `create` names its DESTINATION with `--parent` and has no subject page yet; every other sub-command names
 * an existing page with `--page`. The `!` is honest: `parseNotionPageArgs` refuses each sub-command that
 * reaches here without its own required address.
 *
 * @param args the parsed invocation
 * @returns the raw address to resolve
 */
function subjectAddress({ args }: { args: NotionPageArgs }): string {
  return (args.verb === "create" ? args.parent : args.page)!;
}

/**
 * The dry run for the two sub-commands that send no body.
 *
 * It exists because the body-shaped path is skipped for them, and the skip used to reach `runLive`
 * unconditionally — so `notion page archive --dry-run` really archived the page. A preview that performs the
 * effect it is previewing is worse than having no preview at all, which is why this returns before the
 * token is even resolved.
 *
 * @param args the parsed invocation
 * @param deps the output sink
 * @returns EXIT_OK, always — nothing here can fail, because nothing here does anything
 */
function reportBodylessDryRun({ args, deps }: { args: NotionPageArgs; deps: NotionPageDeps }): number {
  const page = resolvePageId({ address: args.page! });
  const pageId = page.isOk() ? page.value : undefined;
  if (args.verb === "archive") {
    deps.out("action:    archive");
    deps.out(`page:      ${previewAddress({ resolved: pageId, typed: args.page })}`);
    deps.out("note:      archive moves the page to Notion's trash, where it is recoverable for thirty days");
    return EXIT_OK;
  }
  const to = resolvePageId({ address: args.to! });
  for (const line of notionMoveDryRunLines({
    args,
    pageId,
    parentPageId: to.isOk() ? to.value : undefined,
  })) {
    deps.out(line);
  }
  return EXIT_OK;
}

/**
 * The dry run's whole report, and its verdict.
 *
 * Stops before every effect: nothing resolved, nothing recorded, nothing reserved, nothing sent. Extracted
 * from {@link runNotionPage} to keep that function under this repository's cognitive-complexity ceiling.
 *
 * @param args the parsed invocation
 * @param body the markdown that would be published, already linkified
 * @param deps the output sink
 * @param nested the lines carrying a link nested inside another link
 * @param refusedBareRefs whether the bare-reference gate already refused this body, dry-run reported
 * @returns the exit code, which is an error when either gate refused
 */
async function reportNotionDryRun({
  args,
  body,
  deps,
  nested,
  refusedBareRefs,
}: {
  args: NotionPageArgs;
  body: string;
  deps: NotionPageDeps;
  nested: readonly NestedLinkIssue[];
  refusedBareRefs: boolean;
}): Promise<number> {
  const preview = resolvePageId({ address: (args.verb === "create" ? args.parent : args.page)! });
  const parentPageId = preview.isOk() ? preview.value : undefined;
  for (const line of notionPageDryRunLines({ args, body, parentPageId })) {
    deps.out(line);
  }
  for (const issue of nested) {
    deps.out(`nested link: ${issue.message}`);
  }
  const aboveFold = await aboveFoldRefused({ args, body, deps });
  return aboveFold || refusedBareRefs || nested.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * Run `notion page <create|update>`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runNotionPage({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: NotionPageDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "notion", rest: argv.slice(VERB_ARG_OFFSET), verb: "page" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseNotionPageArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (!parsed.isOk()) {
    return refuse({ code: EXIT_USAGE, deps, lines: notionCommandErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  // Archive and move send no body, so every body-shaped check is skipped rather than run over an empty
  // string — reading `--body`'s default (stdin) here would hang the verb waiting for input nobody types.
  if (args.verb === "archive" || args.verb === "move") {
    return args.dryRun ? reportBodylessDryRun({ args, deps }) : runLive({ args, body: "", deps });
  }
  const raw = deps.readBody({ source: args.bodySource });
  const checked = parseNotionPageBody({ markdown: raw });
  if (!checked.isOk()) {
    return refuse({ code: EXIT_USAGE, deps, lines: checked.error });
  }
  const linkified = linkifiedNotionBody({ body: raw, deps, home: resolveHome({ named: args.home }) });
  const body = linkified.body;
  const nested = nestedLinkIssues({ markdown: body });
  if (args.dryRun) {
    return reportNotionDryRun({
      args,
      body,
      deps,
      nested,
      refusedBareRefs: linkified.refused({ dryRun: true }),
    });
  }
  if (linkified.refused({ dryRun: false })) {
    return EXIT_ERROR;
  }
  if (nested.length > 0) {
    return refuse({
      code: EXIT_ERROR,
      deps,
      lines: [
        `${String(nested.length)} line(s) carry a link nested inside another link, which Notion renders raw:`,
        ...nested.map((issue) => `  ${issue.message}`),
      ],
    });
  }
  if (await aboveFoldRefused({ args, body, deps })) {
    return EXIT_ERROR;
  }
  return runLive({ args, body, deps });
}

export { productionNotionPageDeps, readMediaFile } from "./writeContext.js";

/** `slopweaver notion page` — create, replace, move or archive one Notion page, through the door. */
export const notionPageCommand = defineCommand({
  run: (argv: readonly string[]) => runNotionPage({ argv, deps: productionNotionPageDeps() }),
});
