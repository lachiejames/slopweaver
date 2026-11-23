/**
 * The `local-page` destination of `proposal publish`: the proposal becomes a page in the store, written by the same
 * `page publish` core every other local page goes through.
 *
 * ## Which page a publish writes
 *
 * A re-publish writes the page its intake already recorded (`address.id` is the page slug). A first publish
 * with an intake writes `proposal-<intake id>`, so every later re-publish of that intake replaces the same
 * page. A first publish with no intake writes a slug derived from the title and the bytes, because nothing
 * would record which page a later run should replace — exactly as a no-intake Notion publish creates a page.
 *
 * ## Media
 *
 * A draft's `file:` placeholders are linked relatively under the page's own `media/` and handed to the publisher as
 * the files it reads them from, so the store holds each beside the page: a local page is served from its own stored
 * files and nothing else. Nothing is copied on disk.
 */
import { posix } from "node:path";

import { resolveMediaPath } from "../../../outbound/notion/mediaPlaceholder.js";
import type { ProposalAddress } from "../../../outbound/proposal/address.js";
import { derivedLocalPageSlug, localPageMedia, renderProposalHtml } from "../../../outbound/proposal/localPage.js";
import type { PageAssetSource } from "../../../pages/pageAssets.js";
import type { PagePublisher } from "../../../pages/publish.js";
import { isValidPageSlug } from "../../../pages/url.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { PublishTarget } from "./publishCore.js";
import type { PublishOutcome } from "./publishRunShared.js";

/**
 * The page slug this publish writes: the recorded one on a re-publish, else one keyed to the intake, else one
 * derived from the title and the bytes.
 *
 * @param target the reconciled publish target
 * @param intakeId the intake this publish belongs to, if any
 * @param title the proposal's title
 * @param markdown the proposal markdown, which keys a no-intake slug
 * @returns the page slug
 */
export function localProposalSlug({
  target,
  intakeId,
  title,
  markdown,
}: {
  target: PublishTarget;
  intakeId: string | undefined;
  title: string;
  markdown: string;
}): string {
  if (target.kind === "update") {
    return target.address.id;
  }
  if (intakeId !== undefined) {
    return `proposal-${intakeId}`;
  }
  return derivedLocalPageSlug({ markdown, title });
}

/**
 * Where the publisher reads each placeholder file from, or the line naming a media name outside `media/`.
 *
 * @param copies each placeholder's source and the name the page links it by
 * @param mediaBase the draft's own directory, which a source resolves against
 * @returns the asset source, or the refusal
 */
function mediaSource({
  copies,
  mediaBase,
}: {
  copies: ReturnType<typeof localPageMedia>["copies"];
  mediaBase: string;
}): { readonly source: PageAssetSource } | { readonly refusal: string } {
  const files: { relativePath: string; path: string }[] = [];
  for (const copy of copies) {
    // `localPageMedia` only ever names a file under `media/`; this holds the name to that even if it changed.
    if (!posix.normalize(copy.relative).startsWith("media/")) {
      return { refusal: `media name ${copy.relative} would land outside the page's media/. Nothing was published.` };
    }
    files.push({ path: resolveMediaPath({ baseDir: mediaBase, source: copy.source }), relativePath: copy.relative });
  }
  return { source: { files, kind: "files" } };
}

/**
 * Publish one proposal as a local page.
 *
 * @param target the reconciled publish target; a create goes to a new slug, an update to the recorded one
 * @param markdown the linted proposal markdown
 * @param home the state home the page is written under
 * @param title the proposal's title, written as the page heading; `proposal publish` refuses before this
 *   without one, and this refuses again rather than publish an untitled page
 * @param icon an emoji shown before the title
 * @param mediaBase the draft's own directory, which `file:` placeholders resolve against
 * @param dryRun render and report, writing nothing
 * @param intakeId the intake this publish belongs to, which keys a first publish's slug
 * @param nowIso the instant the page's frozen version is stamped with
 * @param out where the report lines go
 * @param err where refusal lines go
 * @param publishPage writes the page, its freeze and its media into the store
 * @returns the exit code, and the address written — none on a dry run or a refusal
 */
export async function publishLocalProposal({
  target,
  markdown,
  home,
  title,
  icon,
  mediaBase,
  dryRun,
  intakeId,
  nowIso,
  out,
  err,
  publishPage,
}: {
  target: PublishTarget;
  markdown: string;
  home: string;
  title: string | undefined;
  icon: string | undefined;
  mediaBase: string;
  dryRun: boolean;
  intakeId: string | undefined;
  nowIso: string;
  out: (line: string) => void;
  err: (line: string) => void;
  publishPage: PagePublisher;
}): Promise<PublishOutcome> {
  if (title === undefined || title.trim().length === 0) {
    err('--title "<text>" is required to publish to a local-page. Nothing was published.');
    return { address: undefined, code: EXIT_USAGE };
  }
  const slug = localProposalSlug({ intakeId, markdown, target, title });
  if (!isValidPageSlug({ slug })) {
    err(`"${slug}" cannot be a local page slug. Nothing was published.`);
    return { address: undefined, code: EXIT_ERROR };
  }
  const media = localPageMedia({ markdown });
  const fragment = renderProposalHtml({ icon, markdown: media.markdown, title });
  if (dryRun) {
    out(`would publish local page ${slug} into the store (${String(media.copies.length)} media file(s))`);
    return { address: undefined, code: EXIT_OK };
  }
  const assets = mediaSource({ copies: media.copies, mediaBase });
  if ("refusal" in assets) {
    err(assets.refusal);
    return { address: undefined, code: EXIT_ERROR };
  }
  const published = await publishPage({ assetSource: assets.source, fragment, home, nowIso, slug });
  if (published.isErr()) {
    for (const line of published.error) {
      err(line);
    }
    return { address: undefined, code: EXIT_ERROR };
  }
  const address: ProposalAddress = { id: slug, provider: "local", url: published.value.url };
  out(`published local page ${slug}`);
  out(published.value.url);
  return { address, code: EXIT_OK };
}
