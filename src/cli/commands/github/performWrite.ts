/**
 * The update mutation, already inside the door: what an update sends, decided against a fresh re-read.
 *
 * Split out of `run.ts` to keep that file under this repo's own line ceiling. `performUpdate` is exported because
 * `updateFlow.ts`'s `sendUpdate` calls it; the create is `./performCreate.ts`'s, and it imports `Outgoing` from
 * here. The render-and-gate step both run before sending is `./prRenderGate.ts`'s; how the decided bytes reach
 * GitHub — the no-op check, the review, the PATCH and the confirmation both writes share — is `./updateSend.ts`'s.
 *
 * ## The door checks the seen day against its own clock
 *
 * No byte of a C3 description depends on the day it is written, so nothing is stamped into it. Both writes still
 * read the UTC day of `deps.now()` here, inside the door, and refuse a problem "seen" on a later day
 * (`../../../outbound/github/stamp.ts`), so a `--pull` then `--file` round trip with no edits stays a no-op.
 */
import { type GithubWriteApi, type WrittenPr } from "../../../corpus/github/write.js";
import type { InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import type { Result } from "../../../lib/result.js";
import type { DescriptionReviewComment } from "../../../outbound/github/descriptionReviewTypes.js";
import type { C3PastedMediaBlock } from "../../../outbound/github/render.js";
import type { TitleShapePolicy } from "../../../outbound/github/titleShape.js";
import type { PrForm, PrFormDraft } from "../../../outbound/github/types.js";
import { ownerRepoOf } from "./addressRun.js";
import type { PrOutcome } from "./core.js";
import { applyKindLabels } from "./kindLabelApply.js";
import type { GithubPrDeps } from "./prDeps.js";
import { type PublicationScan, stampedUpdate, writeGates } from "./prRenderGate.js";
import type { TitleShapePolicyError } from "./titleShapePolicy.js";
import { updateFreshnessFor } from "./updateCore.js";
import { sendDecidedUpdate } from "./updateSend.js";

/** What a write sends, or why it sends nothing. */
export type Outgoing =
  | { readonly kind: "send"; readonly form: PrForm; readonly body: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The bytes an update sends: the draft checked against today, rendered with any pasted media put back, gated, and
 * followed by the third-party trailing region. Pure — the clock reading is passed in.
 */
function outgoingUpdate({
  denylist,
  publicationScan,
  titlePolicy,
  installationIdentifiers,
  draft,
  live,
  today,
  pasted,
  trailing,
}: {
  denylist: readonly string[];
  publicationScan: PublicationScan;
  titlePolicy: Result<TitleShapePolicy, TitleShapePolicyError>;
  installationIdentifiers: InstallationIdentifiers | undefined;
  draft: PrFormDraft;
  live: WrittenPr;
  today: Date;
  pasted: readonly C3PastedMediaBlock[];
  trailing: string;
}): Outgoing {
  const checked = stampedUpdate({
    denylist,
    draft,
    installationIdentifiers,
    liveTitle: live.title,
    pasted,
    publicationScan,
    titlePolicy,
    today,
  });
  if (checked.kind === "refused") {
    return checked;
  }
  const { form, rendered } = checked;
  // The trailing region is not this door's words, but this write SENDS it again, so it crosses the same scan. A
  // footer that fails it is dropped by writing the whole form (`--file`), which carries no trailing region.
  const ownRepository = `${form.target.owner}/${form.target.repo}`;
  const footer = trailing === "" ? [] : publicationScan({ body: trailing, ownRepository, title: "" });
  if (footer.length > 0) {
    return {
      kind: "refused",
      reason:
        `the text after the description, which this update would send again, fails the publication scan: ` +
        `${footer.join("; ")}. Write the whole form with --file to drop it`,
    };
  }
  return { body: `${rendered.body}${trailing}`, form, kind: "send" };
}

/**
 * The pull request read AGAIN, immediately before the write, and refused when it moved since the preview.
 *
 * Address resolution, the identity read, recovery and the diff all happened before the door, which would
 * otherwise stretch the known non-atomic GET-to-PATCH window a long way. This puts it back to one round trip.
 * GitHub offers no conditional update for a body, so the window cannot be closed — only kept short and re-checked.
 */
async function freshLive({
  api,
  owner,
  previewed,
  repo,
}: {
  api: GithubWriteApi;
  owner: string;
  previewed: WrittenPr;
  repo: string;
}): Promise<
  { readonly kind: "fresh"; readonly current: WrittenPr } | { readonly kind: "refused"; readonly reason: string }
> {
  const current = await api.getPr({ number: previewed.number, owner, repo });
  if (current.isErr()) {
    return {
      kind: "refused",
      reason: `could not re-read #${String(previewed.number)} before writing: ${current.error.message}`,
    };
  }
  const fresh = updateFreshnessFor({ current: current.value, previewed });
  if (!fresh.fresh) {
    return { kind: "refused", reason: fresh.reason };
  }
  return { current: current.value, kind: "fresh" };
}

/**
 * The update path, already inside the door.
 *
 * No byte of a C3 description depends on the day it is written, so a write that changes nothing renders the live
 * bytes exactly and stays `unchanged`. Either way, a same-repository pull request then gets its missing kind
 * labels (`./kindLabelApply.ts`), read back.
 *
 * @param api the write API
 * @param comments the walkthrough the same update posts after the PATCH, exactly as GitHub receives it; the PATCH's
 *   review binds it, so the one receipt also covers the round's own check
 * @param previewed the pull request as previewed before the door — the base freshness re-read compares
 *   against this
 * @param draft the merged or whole draft the write will send
 * @param pasted media a human pasted into the live description, put back after the block it followed
 * @param trailing third-party bytes after the rendered description, re-appended verbatim
 * @param home the state home whose ledger records the write
 * @param locus the branch locus, used only to label an unconfirmed outcome
 * @param deps the injectable clock and output sink
 * @param installationIdentifiers the installation's own identifiers the scan forgives on this target, the same
 *   value the preview was gated with
 * @returns the update outcome
 */
export async function performUpdate({
  api,
  comments,
  previewed,
  draft,
  pasted,
  trailing,
  home,
  locus,
  deps,
  installationIdentifiers,
}: {
  api: GithubWriteApi;
  comments: readonly DescriptionReviewComment[];
  previewed: WrittenPr;
  draft: PrFormDraft;
  pasted: readonly C3PastedMediaBlock[];
  trailing: string;
  home: string;
  locus: string;
  deps: GithubPrDeps;
  installationIdentifiers: InstallationIdentifiers | undefined;
}): Promise<PrOutcome> {
  const { owner, repo } = ownerRepoOf({ fullName: previewed.baseRepoFullName });
  const live = await freshLive({ api, owner, previewed, repo });
  if (live.kind === "refused") {
    return live;
  }
  const { current } = live;
  const outgoing = outgoingUpdate({
    ...writeGates({ home }),
    draft,
    installationIdentifiers,
    live: current,
    pasted,
    today: deps.now(),
    trailing,
  });
  if (outgoing.kind === "refused") {
    return outgoing;
  }
  const { body, form } = outgoing;
  const outcome = await sendDecidedUpdate({ api, body, comments, current, deps, form, home, locus });
  if (outcome.kind === "refused") {
    return outcome;
  }
  // The author check ran before the door, so only the fork case is left: a fork's labels are its author's.
  const sameRepository = current.head.repoFullName === current.baseRepoFullName;
  if ((outcome.kind === "updated" || outcome.kind === "unchanged") && sameRepository) {
    const target = { number: current.number, owner, repo, title: form.title };
    for (const line of await applyKindLabels({ api, target })) {
      deps.out({ line });
    }
  }
  return outcome;
}
