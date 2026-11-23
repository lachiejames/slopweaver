/**
 * The pure preflight over a markdown body bound for Notion, and the canonical-digest helper the ledger
 * stores.
 *
 * This is what remains of a much larger module. A bespoke markdown→block converter lived here first; it was
 * deleted once Notion's own enhanced-Markdown endpoints were measured to handle every construct the golden
 * proposal shape uses. Reimplementing a first-party provider capability is a permanent drift liability, so
 * what is left is only the part Notion cannot do for us: refusing a body it would reject or silently
 * mangle, BEFORE a page exists.
 *
 * Pure: text in, refusals out. No I/O, no provider client.
 */
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../lib/result.js";
import { extensionOf, MEDIA_CONTENT_TYPES, type MediaBlockType } from "./mediaPlaceholder.js";

/** Notion's documented per-request payload ceiling. */
export const REQUEST_BYTES_MAX = 500_000;

/** One reason a body cannot be published, in the operator's vocabulary. */
export type BodyCheck = Result<void>;

const HEADING_ONE = /^#\s+\S/m;

/**
 * An image whose source is neither an `http(s)` URL nor a `file:` upload placeholder.
 *
 * `file:` is carved out rather than allowed by accident: Notion ACCEPTS `![cap](./hero.png)` and silently
 * builds a broken external-image block from it, so a bare local path is a mistake the provider will not
 * report. See `./mediaPlaceholder.ts` for what `file:` then does, and {@link LOCAL_LINK} for the document
 * half of the same trap.
 */
const UNPUBLISHABLE_IMAGE = /^!\[[^\]]*\]\((?!https?:\/\/|file:)([^)\s]+)\)\s*$/gm;

/**
 * A LINK alone on its line whose target is a local path — the document half of the same trap.
 *
 * Notion builds a dead link from `[the DPA](./dpa.pdf)` and reports nothing, exactly as it builds a broken
 * image block from a bare image path. The refusal is narrowed by EXTENSION at the callsite rather than
 * here, because a link is the one construct a body is full of legitimately: `[see below](#appendix)` and
 * `[mail me](mailto:…)` must pass, and so must a link to a file type this lane could not have uploaded
 * anyway — refusing that one would offer no fix. What is left is the exact case where `file:` is the
 * answer.
 */
const LOCAL_LINK = /^\[[^\]]*\]\((?!https?:\/\/|file:)([^)\s]+)\)\s*$/gm;

/** Every query parameter AWS signs a temporary file URL with. Its presence means the URL rotates per read. */
const SIGNED_PARAM_PREFIX = "X-Amz-";

/** A markdown image, so a signed source can be normalised out of the update-safety digest. */
const IMAGE_SOURCE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * The placeholder spelling that actually works for one block type.
 *
 * The remedy has to match the EXTENSION, not the construct the author reached for. Advising `file:` in a
 * link for `./hero.png` would be advising a sigil the next run refuses, because a link means a `pdf` block
 * — so a reader following the refusal literally would be refused again, by a different rule.
 */
function placeholderSpelling({ blockType }: { blockType: MediaBlockType }): string {
  if (blockType === "pdf") {
    return "`[caption](file:./doc.pdf)`";
  }
  return "`![caption](file:./shot.png)` — an image needs the `!`, because a link means a `pdf` block";
}

/** * Check a markdown body against the constraints Notion enforces and the ones this repo owns.
 *
 * Every finding is a REFUSAL rather than a repair. A body that is too large could be split, and an image
 * placeholder could be dropped, but both of those report success while publishing something other than what
 * was reviewed — and a Notion page that fails halfway through already exists, so discovering the problem at
 * the provider is strictly worse than discovering it here.
 *
 * @param markdown the body to publish, without its H1 title line
 * @returns ok, or one line per reason it cannot be sent
 */
export function checkMarkdownBody({ markdown }: { markdown: string }): BodyCheck {
  const errors: string[] = [];
  if (markdown.trim().length === 0) {
    errors.push("the body is empty; there is nothing to publish");
  }
  const bytes = Buffer.byteLength(markdown, "utf8");
  if (bytes > REQUEST_BYTES_MAX) {
    errors.push(
      `the body is ${String(bytes)} bytes and Notion's per-request ceiling is ${String(REQUEST_BYTES_MAX)}. ` +
        "Move the heavy detail into a linked page rather than letting this be truncated.",
    );
  }
  if (HEADING_ONE.test(markdown)) {
    errors.push(
      "the body carries an H1. A Notion page title is a PROPERTY, set with --title, so an H1 in the body " +
        "renders as a second heading under the real title. Drop it, or promote it with --title.",
    );
  }
  for (const match of markdown.matchAll(UNPUBLISHABLE_IMAGE)) {
    errors.push(
      `image source ${JSON.stringify(match[1]!)} is neither an http(s) URL nor a \`file:\` upload ` +
        "placeholder. Notion embeds an external image by URL and would build a BROKEN image block from a " +
        "bare local path without complaining. Write it as `![caption](file:./shot.png)` to have slopweaver " +
        "upload it into Notion's own storage at that exact position, or link a hosted URL.",
    );
  }
  for (const match of markdown.matchAll(LOCAL_LINK)) {
    const target = match[1]!;
    const accepted = MEDIA_CONTENT_TYPES[extensionOf({ path: target })];
    if (accepted === undefined) {
      continue;
    }
    errors.push(
      `link target ${JSON.stringify(target)} is a local path to a file this lane can upload, and Notion ` +
        "would build a DEAD link from it without complaining. Write it as " +
        `${placeholderSpelling({ blockType: accepted.blockType })} to have slopweaver upload it into ` +
        "Notion's own storage at that exact position, or link a hosted URL.",
    );
  }
  return errors.length > 0 ? err(errors) : ok(undefined);
}

/**
 * Strip the rotating signature off an image URL, so the digest describes the PAGE rather than the read.
 *
 * A Notion-hosted image comes back from `retrieveMarkdown` as a pre-signed S3 URL carrying `X-Amz-Date`,
 * `X-Amz-Expires` and `X-Amz-Signature`. Those change on EVERY read: two reads of one untouched page, 1.5
 * seconds apart, were measured returning different markdown. A digest over that is not a fingerprint of the
 * page at all, and update-safety would refuse every re-publish of any page carrying an uploaded image.
 *
 * Keyed on the signature parameters rather than on a list of Notion's file hosts, because the instability is
 * the signature: an image URL that carries one is unstable wherever it is hosted, and one that does not is
 * stable wherever it is hosted. The cost is stated rather than hidden — the query of a signed image URL is
 * outside the safety check, so a swap between two signed URLs with the same path would not be detected. The
 * path, the caption, the position and every other byte of the page still are.
 *
 * A `pdf` BLOCK needs none of this, and that is measured rather than assumed. Notion renders one as
 * `<pdf src="file://…attachment:<uuid>:<name>…">caption</pdf>` — an attachment reference plus a
 * permission record, with no signed query anywhere in it — so two reads of an untouched page hash
 * identically with nothing normalised. Repro: attach a PDF, then read the page back twice through
 * `api.retrieveMarkdown` and compare `canonicalHash`; measured, both passes
 * return the same hash. So `IMAGE_SOURCE` stays an IMAGE pattern on purpose: widening it to
 * documents would normalise a string that was never unstable.
 *
 * @param canonical the markdown Notion returned from `retrieveMarkdown`
 * @returns the same markdown with every signed image URL reduced to its stable path
 */
export function stableCanonical({ canonical }: { canonical: string }): string {
  return canonical.replaceAll(IMAGE_SOURCE, (whole, caption: string, source: string) => {
    const parsed = URL.parse(source);
    const signed =
      parsed !== null && [...parsed.searchParams.keys()].some((key) => key.startsWith(SIGNED_PARAM_PREFIX));
    return signed ? `![${caption}](${parsed.origin}${parsed.pathname})` : whole;
  });
}

/**
 * The digest of a page's CANONICAL markdown, as Notion reads it back.
 *
 * Never taken over the bytes that were sent. Notion normalises on ingest — a pipe table comes back as
 * `<table>`, blank lines are dropped — so a digest of the input would differ from a digest of the page on
 * every single comparison, and update-safety would refuse every legitimate re-publish.
 *
 * @param canonical the markdown Notion returned from `retrieveMarkdown`
 * @returns a stable hex digest
 */
export function canonicalHash({ canonical }: { canonical: string }): string {
  return createHash("sha256").update(stableCanonical({ canonical }), "utf8").digest("hex").slice(0, 32);
}

/**
 * A table in Notion's canonical read-back, in either of the two spellings it uses.
 *
 * `<table>` is what `retrieveMarkdown` actually returns for a table today; the pipe row is kept because it
 * is what an operator WRITES, and a check that silently stopped matching if Notion changed its canonical
 * form would go quiet exactly when it mattered rather than fail.
 */
const CANONICAL_TABLE = /^\s*(?:<table\b|\|.*\|\s*$)/mu;

/**
 * Whether a canonical read-back carries a table — the one construct the byte-identical safety check is
 * KNOWN to be blind to.
 *
 * A Notion table's column widths are layout, not content: they are absent from `retrieveMarkdown` in either
 * spelling, so a colleague who drags a column wider becomes the page's `last_edited_by` while the canonical
 * markdown stays byte-identical. `resolveExternalEdit` therefore reads that touch as no edit at all and lets
 * the update through, and the update — which replaces every block — resets the widths. This predicate is
 * what turns that from a silent loss into a stated one: the write still proceeds, exactly as the mermaid
 * display-toggle case requires, but a reader is told what the check could not see. Same posture as
 * {@link stableCanonical}'s signed-query cost, and for the same reason: the gap is named, not hidden.
 *
 * @param canonical the markdown Notion returned from `retrieveMarkdown`
 * @returns true when the page carries at least one table
 */
export function canonicalCarriesTable({ canonical }: { canonical: string }): boolean {
  return CANONICAL_TABLE.test(canonical);
}

/**
 * Whether a canonical read-back is complete enough to hash.
 *
 * @param truncated whether Notion reported the markdown as truncated
 * @param unknownBlockIds the blocks Notion could not express as markdown
 * @returns undefined when the read is complete, else the reason it cannot be used as evidence
 */
export function incompleteReadReason({
  truncated,
  unknownBlockIds,
}: {
  truncated: boolean;
  unknownBlockIds: readonly string[];
}): string | undefined {
  if (truncated) {
    return "Notion reported the page's markdown as TRUNCATED, so a digest over it would compare a partial read against a whole one.";
  }
  if (unknownBlockIds.length > 0) {
    return (
      `Notion could not express ${String(unknownBlockIds.length)} block(s) as markdown (${unknownBlockIds.slice(0, 3).join(", ")}). ` +
      "Those blocks are invisible to the safety check, so an update could destroy them unseen."
    );
  }
  return undefined;
}

/**
 * A short preview of a body, for a dry run.
 *
 * @param markdown the body
 * @param lines how many leading lines to show
 * @returns the first `lines` non-empty lines, each clipped for the terminal
 */
export function bodyPreviewLines({ markdown, lines }: { markdown: string; lines: number }): readonly string[] {
  const kept = markdown.split("\n").filter((line) => line.trim().length > 0);
  const shown = kept.slice(0, lines).map((line) => (line.length > 110 ? `${line.slice(0, 110)}…` : line));
  return kept.length > lines ? [...shown, `… and ${String(kept.length - lines)} more line(s)`] : shown;
}
