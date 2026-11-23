/**
 * The bytes a `pr update` preview shows, computed before the door — pure, with the clock reading passed in, plus
 * `gatedPreview`, the thin shell that reads the installation's identifiers for it and prints what it decided.
 *
 * Split out of `./updateFlow.ts`, which sequences the verb's effects; this module only decides what the PATCH
 * would send and whether the PR gate accepts it. `./performWrite.ts`'s `outgoingUpdate` is the same computation
 * re-run inside the door against the body the freshness re-read returned.
 */
import type { WrittenPr } from "../../../corpus/github/write.js";
import type { InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import type { Result } from "../../../lib/result.js";
import { withholdingCredentialLines } from "../../../outbound/github/descriptionWords.js";
import { reportedInstallationIdentifiers } from "../../../outbound/github/installationIdentifiersRead.js";
import type { TitleShapePolicy } from "../../../outbound/github/titleShape.js";
import type { PrForm, PrFormDraft } from "../../../outbound/github/types.js";
import type { GithubPrDeps } from "./prDeps.js";
import { type PublicationScan, type RenderedBody, stampedUpdate, writeGates } from "./prRenderGate.js";
import type { TitleShapePolicyError } from "./titleShapePolicy.js";
import type { ChosenUpdate } from "./updateChoice.js";

/**
 * The exact bytes the PATCH will send: the rendered description, then whatever a third party appended after
 * it — and the line that says so out loud.
 *
 * Everything downstream compares against a live body that carries the block, so dropping it here is not a
 * cosmetic loss: `writeWouldChangeNothing` would see a change on every edit that changes nothing, and
 * `confirmPr` would store a form that no longer renders the body it was recorded beside. Silence about the
 * carried bytes would be the worse failure for the same reason `./updateChoice.ts`'s no-digest notice
 * exists — the block is NOT checked by the pull-request format gate, and a caller who never hears about it
 * cannot tell a preserved footer from one this verb quietly dropped.
 */
function bodyToSend({ rendered, trailing }: { rendered: string; trailing: string }): {
  body: string;
  notices: readonly string[];
} {
  if (trailing.length === 0) {
    return { body: rendered, notices: [] };
  }
  const notice =
    `note: ${String(trailing.length)} bytes follow this description that slopweaver did not write (a bot or a ` +
    "human appended them) — they are preserved byte for byte and are not checked by the pull-request format gate";
  return { body: rendered + trailing, notices: [notice] };
}

/**
 * The preview's bytes, checked against today: the accepted form, the gate's verdict, the exact body the PATCH would
 * send and the notices about it.
 *
 * @param chosen the update the input resolved to, carrying the third-party trailing region
 * @param denylist the private hygiene denylist the PR gate's secret scan reads
 * @param publicationScan the scan of what may not be published, run on the exact title and body
 * @param titlePolicy which repositories' titles are judged, or why that could not be read
 * @param installationIdentifiers the installation's own identifiers the scan forgives on this target
 * @param draft the linkified draft the write will send
 * @param live the pull request as read before the door
 * @param today the clock reading the stamp takes
 * @returns the refusal, or the stamped form, the gate's verdict, the body to send and its notices
 */
export function previewedUpdate({
  chosen,
  denylist,
  publicationScan,
  titlePolicy,
  installationIdentifiers,
  draft,
  live,
  today,
}: {
  chosen: ChosenUpdate;
  denylist: readonly string[];
  publicationScan: PublicationScan;
  titlePolicy: Result<TitleShapePolicy, TitleShapePolicyError>;
  installationIdentifiers: InstallationIdentifiers | undefined;
  draft: PrFormDraft;
  live: WrittenPr;
  today: Date;
}):
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "ready";
      readonly form: PrForm;
      readonly rendered: RenderedBody;
      readonly body: string;
      readonly notices: readonly string[];
    } {
  const checked = stampedUpdate({
    denylist,
    draft,
    installationIdentifiers,
    liveTitle: live.title,
    publicationScan,
    titlePolicy,
    today,
  });
  if (checked.kind === "refused") {
    return checked;
  }
  const { form, rendered } = checked;
  const sending = bodyToSend({ rendered: rendered.body, trailing: chosen.trailing });
  return { body: sending.body, form, kind: "ready", notices: sending.notices, rendered };
}

/** The preview the PR gate accepted: the stamped form, its rendering, the body to send and its notices. */
type ReadyPreview = Extract<ReturnType<typeof previewedUpdate>, { kind: "ready" }>;

/**
 * The thin shell over {@link previewedUpdate}: read the installation's identifiers, preview the update gated with
 * them, and print the preview's notices. The identifiers are read once, here, so the preview and the door's
 * re-render inside `performUpdate` gate on the same value.
 *
 * @param chosen the update the input resolved to
 * @param deps the identifiers reader, the clock and the output sink
 * @param draft the linkified draft the write will send
 * @param home the state home the gates and the identifiers are read under
 * @param live the pull request as read before the door
 * @returns the accepted preview and the identifiers it was gated with, or undefined once a refusal is printed
 */
export async function gatedPreview({
  chosen,
  deps,
  draft,
  home,
  live,
}: {
  chosen: ChosenUpdate;
  deps: GithubPrDeps;
  draft: PrFormDraft;
  home: string;
  live: WrittenPr;
}): Promise<
  { readonly installationIdentifiers: InstallationIdentifiers | undefined; readonly preview: ReadyPreview } | undefined
> {
  const targetRepository = live.baseRepoFullName;
  const installationIdentifiers = await reportedInstallationIdentifiers({ deps, home, targetRepository });
  const gates = { ...writeGates({ home }), installationIdentifiers };
  const preview = previewedUpdate({ chosen, ...gates, draft, live, today: deps.now() });
  if (preview.kind === "refused") {
    deps.out({ line: withholdingCredentialLines({ lines: [`refused: ${preview.reason}`] }).join("") });
    return undefined;
  }
  for (const notice of preview.notices) {
    deps.out({ line: notice });
  }
  return { installationIdentifiers, preview };
}
