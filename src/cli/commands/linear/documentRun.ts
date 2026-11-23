/**
 * `slopweaver linear document create|update` — the effectful shell. Every decision lives in `./documentCore.ts`
 * and the irreversible half in `./documentWrite.ts`; this file orders the gates, resolves the home and token,
 * and routes the write through the admit door.
 *
 * The order is the comment verb's (`./commentRun.ts`), and for its reason: every check that can refuse
 * without touching Linear — the form, the fold, the bare references, the mentions — runs before the door, so
 * a page that cannot land costs no audit record and no reservation.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { linearDocumentAboveFoldCells, linearDocumentBelowFoldCells } from "../../../outbound/linear/aboveFold.js";
import { linkifyDocumentContent } from "../../../outbound/linear/bareRefLinks.js";
import type { LinearDocumentForm } from "../../../outbound/linear/documentTypes.js";
import { linearMentionRefusals, staleLinearMentionRefusals } from "../../../outbound/linear/mentionIndex.js";
import { mentionKeysOfDocument, rewriteDocumentMentions } from "../../../outbound/linear/mentionRewrite.js";
import { aboveFoldGateRefused } from "../../aboveFoldDoor.js";
import { bareRefGateRefused } from "../../bareRefDoor.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import {
  documentDoorRequestFor,
  documentDryRunLines,
  documentOutcomeLines,
  documentWriteId,
  type LinearDocumentArgs,
  type LinearDocumentOutcome,
  parseLinearDocumentArgs,
  parseLinearDocumentForm,
} from "./documentCore.js";
import { type LinearDocumentWriteDeps, productionLinearDocumentWriteDeps } from "./documentDeps.js";
import { type DocumentWriteContext, documentUpdatePrecheck, performDocumentWrite } from "./documentWrite.js";
import { linearVerbErrorLines } from "./errors.js";

/** Same offset `./run.ts` documents: node, script, `linear`, `document` — leaving `<create|update>` first. */
const VERB_ARG_OFFSET = 4;

/** Print each line to stderr and return the code. */
function refuse({
  deps,
  lines,
  code,
}: {
  deps: LinearDocumentWriteDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: LinearDocumentOutcome }): number {
  if (outcome.kind === "written" || outcome.kind === "landedAfterError") {
    return EXIT_OK;
  }
  return outcome.kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/**
 * The mention gate, before the door: a page naming someone the roster cannot address costs no audit record
 * and no reservation. The roster's own refusal (the store unreachable, its row unreadable) is a different
 * failure from a key that will not resolve, so it carries its own exit code: an error, never the
 * expected-empty a refused mention is.
 */
async function mentionedForm({
  args,
  deps,
  form,
  home,
}: {
  args: LinearDocumentArgs;
  deps: LinearDocumentWriteDeps;
  form: LinearDocumentForm;
  home: string;
}): Promise<Result<LinearDocumentForm, { readonly code: number; readonly lines: readonly string[] }>> {
  const keys = mentionKeysOfDocument({ content: form.content });
  const resolved = await deps.resolveMentions({ home, keys, verified: args.mentionIds });
  if (resolved.isErr()) {
    return err({ code: EXIT_ERROR, lines: [resolved.error.message] });
  }
  const resolution = resolved.value;
  const refusals = [
    ...linearMentionRefusals({ keys, resolution }),
    ...staleLinearMentionRefusals({ keys, resolution }),
  ];
  if (refusals.length > 0) {
    return err({ code: EXIT_EXPECTED_EMPTY, lines: refusals });
  }
  return ok({ ...form, content: rewriteDocumentMentions({ content: form.content, resolution }) });
}

/** The effect phase: token, mentions, the update's precheck, door, write. */
async function runLive({
  args,
  deps,
  form,
  home,
  id,
}: {
  args: LinearDocumentArgs;
  deps: LinearDocumentWriteDeps;
  form: LinearDocumentForm;
  home: string;
  id: string;
}): Promise<number> {
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: [`no Linear token for this home. Set LINEAR_API_KEY, or write ${home}/secrets/linear-token`],
    });
  }
  const mentioned = await mentionedForm({ args, deps, form, home });
  if (mentioned.isErr()) {
    return refuse({ code: mentioned.error.code, deps, lines: mentioned.error.lines });
  }
  const ctx: DocumentWriteContext = {
    api: deps.makeApi({ home, token }),
    deps,
    form: mentioned.value,
    home,
    id,
    verb: args.verb,
  };
  const precheck = await documentUpdatePrecheck({ ctx });
  if (precheck.kind === "refused") {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [precheck.reason] });
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    // Passed EXPLICITLY, for the reason `./run.ts` records: omitting it writes the audit record to the
    // default home while the document ledger goes to `--home`.
    home,
    ledger: deps.doorLedger,
    perform: () =>
      performDocumentWrite({ ctx, priorUpdatedAt: precheck.priorUpdatedAt, reservedIso: precheck.reservedIso }),
    request: documentDoorRequestFor({ destination: form.fields.destination, home, id, verb: args.verb }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear document", through: routed })],
    });
  }
  for (const line of documentOutcomeLines({ outcome: routed.result, verb: args.verb })) {
    deps.out(line);
  }
  return codeFor({ outcome: routed.result });
}

/**
 * The fold gate. A page has no collapsible, so its lead — every block before the first heading — is what a
 * reader meets first and is held to the refusing rules; the sections after it are read for warnings.
 *
 * @param args the parsed invocation, for the dry-run flag
 * @param form the linked form
 * @param deps the injected environment reader and output sink
 * @param home the resolved state home
 * @returns true when the write must refuse
 */
async function aboveFoldRefused({
  args,
  form,
  deps,
  home,
}: {
  args: LinearDocumentArgs;
  form: LinearDocumentForm;
  deps: LinearDocumentWriteDeps;
  home: string;
}): Promise<boolean> {
  return aboveFoldGateRefused({
    belowFoldCells: linearDocumentBelowFoldCells({ content: form.content }),
    cells: linearDocumentAboveFoldCells({ content: form.content }),
    dryRun: args.dryRun,
    env: deps.env,
    home,
    ledger: deps.doorLedger,
    out: ({ line }) => {
      deps.out(line);
    },
    surface: "linear",
  });
}

/**
 * Refuse whatever bare `#N`/`SUP-123` reference stayed unresolved — see `../../bareRefDoor.ts`.
 *
 * @param args the parsed invocation, for the dry-run flag
 * @param issues the residue `linkifyDocumentContent` already computed
 * @param deps the injected environment reader and output sink
 * @param home the state home whose grant journal decides the hatch
 * @returns true when the write must refuse
 */
function bareRefRefused({
  args,
  issues,
  deps,
  home,
}: {
  args: LinearDocumentArgs;
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
  deps: LinearDocumentWriteDeps;
  home: string;
}): boolean {
  return bareRefGateRefused({
    dryRun: args.dryRun,
    env: deps.env,
    home,
    issues: issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    out: ({ line }) => {
      deps.out(line);
    },
  });
}

/**
 * The dry run: stops before every effect, and previews mentions against the rosters as they STAND — the live
 * path's just-in-time refresh writes silver artifacts, and a preview leaves no trace. The gates report LAST,
 * under the preview they are judging; a roster store that cannot be read refuses before any preview prints.
 */
async function runDocumentDryRun({
  args,
  deps,
  home,
  id,
  issues,
  linkedForm,
}: {
  args: LinearDocumentArgs;
  deps: LinearDocumentWriteDeps;
  home: string;
  id: string;
  issues: Parameters<typeof bareRefRefused>[0]["issues"];
  linkedForm: LinearDocumentForm;
}): Promise<number> {
  const keys = mentionKeysOfDocument({ content: linkedForm.content });
  const previewed = await deps.previewMentions({ home, keys, verified: args.mentionIds });
  if (previewed.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [previewed.error.message] });
  }
  const preview = previewed.value;
  const previewForm: LinearDocumentForm = {
    ...linkedForm,
    content: rewriteDocumentMentions({ content: linkedForm.content, resolution: preview }),
  };
  for (const line of documentDryRunLines({ args, form: previewForm, id, mentions: keys })) {
    deps.out(line);
  }
  const mentionRefusals = linearMentionRefusals({ keys, resolution: preview });
  for (const line of mentionRefusals) {
    deps.out(line);
  }
  const aboveFold = await aboveFoldRefused({ args, deps, form: linkedForm, home });
  const bareRefs = bareRefRefused({ args, deps, home, issues });
  return aboveFold || bareRefs || mentionRefusals.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * Run `linear document create|update`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearDocument({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearDocumentWriteDeps;
}): Promise<number> {
  // `proposal publish` calls this body in-process, past `../../main.ts`'s dispatch, so it asks the gate itself.
  const gated = refuseRunnerOnStandingRuling({ noun: "linear", rest: argv.slice(VERB_ARG_OFFSET), verb: "document" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseLinearDocumentArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const form = parseLinearDocumentForm({ raw: deps.readForm({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  // The id comes from the ORIGINAL form, so a reference or roster change between two attempts cannot change
  // which page a retry means.
  const id = documentWriteId({ args, form: form.value });
  const home = resolveHome({ named: args.home });
  const linkified = linkifyDocumentContent({ content: form.value.content, context: deps.bareRefContext({ home }) });
  const linkedForm: LinearDocumentForm = { ...form.value, content: linkified.content };
  if (args.dryRun) {
    return runDocumentDryRun({ args, deps, home, id, issues: linkified.issues, linkedForm });
  }
  if (await aboveFoldRefused({ args, deps, form: linkedForm, home })) {
    return EXIT_ERROR;
  }
  if (bareRefRefused({ args, deps, home, issues: linkified.issues })) {
    return EXIT_ERROR;
  }
  return runLive({ args, deps, form: linkedForm, home, id });
}

/** `slopweaver linear document` — create or re-render one Linear document from a typed form, through the door. */
export const linearDocumentCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearDocument({ argv, deps: productionLinearDocumentWriteDeps() }),
});
