/**
 * The whole diff, built once, that every rendering reads: the owner's page, the team's page and the team post.
 *
 * Pure — the sources arrive as text, the identifier context and the phrase links as values. Everything that can be
 * wrong is collected and returned together, so one run names every gap in the record rather than the first.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { BareRefContext } from "../../outbound/linkify/bareRefs.js";
import { alignDocuments, isMaterial } from "./align.js";
import { type AnnotatedRow, annotateRows } from "./annotate.js";
import type { ImageSources } from "./inline.js";
import { type DocDiffIssue, DocDiffIssues } from "./issues.js";
import { bareAddresses, brokenAddresses, linkDocumentMarkdown, type PhraseLink } from "./link.js";
import type { DocDiffDocument, DocDiffRecord } from "./record.js";
import { documentUnits } from "./units.js";

/** One document's before and after markdown, as read. */
export interface DocumentSources {
  readonly before: string;
  readonly after: string;
}

/** A control a document's Vanta slot is linked to, with where it links. */
interface LinkedControl {
  readonly id: string;
  readonly url: string;
}

/** One document's diff. */
export interface DocumentDiff {
  readonly document: DocDiffDocument;
  readonly rows: readonly AnnotatedRow[];
  /** The document's Vanta evidence slot. */
  readonly slotUrl: string;
  readonly controls: readonly LinkedControl[];
  readonly counts: { readonly material: number; readonly formatting: number; readonly same: number };
}

/** The whole diff. */
export interface DocDiffModel {
  readonly record: DocDiffRecord;
  readonly documents: readonly DocumentDiff[];
  readonly images: ImageSources;
}

/** The link `linkifyMarkdown` writes for a control id, read back out. */
const MARKDOWN_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

/**
 * Resolve each control id a document lists through the same resolver its text uses.
 *
 * @returns the linked controls, and what linking them found wrong
 */
function linkControls({ ids, context }: { ids: readonly string[]; context: BareRefContext }): {
  readonly controls: readonly LinkedControl[];
  readonly issues: readonly DocDiffIssue[];
} {
  const controls: LinkedControl[] = [];
  const issues: DocDiffIssue[] = [];
  for (const id of ids) {
    const linked = linkDocumentMarkdown({ context, markdown: id, phrases: [] });
    const match = MARKDOWN_LINK.exec(linked.markdown);
    issues.push(...linkIssues({ linked }));
    if (match === null) {
      issues.push(DocDiffIssues.unlinkedIdentifier({ identifier: id }));
    } else {
      controls.push({ id, url: match[2]! });
    }
  }
  return { controls, issues };
}

/**
 * Diff one document.
 *
 * @returns the document's diff, or every problem with it
 */
function diffDocument({
  document,
  sources,
  context,
  phrases,
  slotUrl,
  images,
}: {
  document: DocDiffDocument;
  sources: DocumentSources;
  context: BareRefContext;
  phrases: readonly PhraseLink[];
  slotUrl: string;
  images: ImageSources;
}): Result<DocumentDiff, readonly DocDiffIssue[]> {
  const before = documentUnits({ markdown: sources.before });
  const after = documentUnits({ markdown: sources.after });
  const issues: DocDiffIssue[] = [];
  const linkUnits = ({ units }: { units: typeof before.units }): typeof before.units =>
    units.map((unit) => {
      if (unit.kind === "fence" || unit.kind === "front") {
        return unit;
      }
      const linked = linkDocumentMarkdown({ context, markdown: unit.raw, phrases });
      issues.push(...linkIssues({ linked }));
      issues.push(...deadAddressIssues({ images: new Set(images.keys()), linked }));
      return { ...unit, raw: linked.markdown };
    });
  const rows = alignDocuments({ after: linkUnits({ units: after.units }), before: linkUnits({ units: before.units }) });
  const annotated = annotateRows({ document, rows });
  if (annotated.isErr()) {
    issues.push(...annotated.error);
  }
  const controls = linkControls({ context, ids: document.controls });
  issues.push(...controls.issues);
  if (issues.length > 0 || annotated.isErr()) {
    return err(issues);
  }
  const counts = { formatting: 0, material: 0, same: 0 };
  for (const row of annotated.value) {
    if (isMaterial({ kind: row.kind })) {
      counts.material += 1;
    } else if (row.kind === "formatting") {
      counts.formatting += 1;
    } else {
      counts.same += 1;
    }
  }
  return ok({ controls: controls.controls, counts, document, rows: annotated.value, slotUrl });
}

/** What linking one text found wrong: an identifier nothing resolved, and an address a page must not carry. */
function linkIssues({
  linked,
}: {
  linked: { readonly unresolved: readonly string[]; readonly unsafe: readonly string[] };
}): readonly DocDiffIssue[] {
  return [
    ...linked.unresolved.map((identifier) => DocDiffIssues.unlinkedIdentifier({ identifier })),
    ...linked.unsafe.map((url) =>
      DocDiffIssues.unsafeLink({
        url,
        why: "only https, http and mailto links are published, so it cannot run as script",
      }),
    ),
  ];
}

/** Every address in some linked text that would lead nowhere once published, bar one already refused as unsafe. */
function deadAddressIssues({
  linked,
  images,
}: {
  linked: { readonly markdown: string; readonly unsafe: readonly string[] };
  images: ReadonlySet<string>;
}): readonly DocDiffIssue[] {
  return brokenAddresses({ images, markdown: linked.markdown })
    .filter((url) => !linked.unsafe.includes(url))
    .map((url) =>
      DocDiffIssues.unsafeLink({
        url,
        why: "it names no public web host or mailbox, or an image this run did not read, so on the published page it would lead nowhere",
      }),
    );
}

/** Each issue once: an identifier both sides cite, in two documents, is one thing to fix. */
function distinct({ issues }: { issues: readonly DocDiffIssue[] }): readonly DocDiffIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\u0000${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** The context with the record's repository as the one a bare `#7` means, when the record names one. */
function withRepository({
  context,
  repository,
}: {
  context: BareRefContext;
  repository: string | undefined;
}): BareRefContext {
  if (repository === undefined) {
    return context;
  }
  const [owner, repo] = repository.split("/");
  return { ...context, repos: [{ owner: owner!, repo: repo! }] };
}

/**
 * Build the whole diff from the record and what was read for it.
 *
 * @param record the validated record
 * @param sources each document's before and after markdown, by document id
 * @param context what an identifier resolves against
 * @param phrases the names to link, every record link already resolved to a URL
 * @param slotUrls each Vanta evidence slot's address, by evidence id
 * @param images inlined image addresses, by the source the markdown names
 * @returns the model, or every problem found across every document
 */
export function buildDocDiffModel({
  record,
  sources,
  context,
  phrases,
  slotUrls,
  images,
}: {
  record: DocDiffRecord;
  sources: ReadonlyMap<string, DocumentSources>;
  context: BareRefContext;
  phrases: readonly PhraseLink[];
  slotUrls: ReadonlyMap<string, string>;
  images: ImageSources;
}): Result<DocDiffModel, readonly DocDiffIssue[]> {
  const documents: DocumentDiff[] = [];
  const resolving = withRepository({ context, repository: record.repository });
  const linked = linkRecord({ context: resolving, phrases, record });
  const issues: DocDiffIssue[] = [...linked.issues];
  for (const document of linked.record.documents) {
    const read = sources.get(document.id);
    const slotUrl = slotUrls.get(document.vantaEvidence);
    if (read === undefined) {
      issues.push(DocDiffIssues.unreadableSource({ cause: "no source was read for it", source: document.id }));
      continue;
    }
    if (slotUrl === undefined) {
      issues.push(DocDiffIssues.unresolvedLink({ target: `vanta-evidence:${document.vantaEvidence}` }));
      continue;
    }
    const diff = diffDocument({ context: resolving, document, images, phrases, slotUrl, sources: read });
    if (diff.isErr()) {
      issues.push(...diff.error);
    } else {
      documents.push(diff.value);
    }
  }
  if (issues.length > 0) {
    return err(distinct({ issues }));
  }
  return ok({ documents, images, record: linked.record });
}

/**
 * The record with every sentence a reader sees linked the way the documents are — a reason that says "NET-38 was
 * missing" is read beside a document where NET-38 is a link, and a bare one there is the same defect. Match
 * strings, labels and titles are left alone: a match is compared as plain text, and a title is not prose.
 *
 * @returns the linked record, and what linking its prose found wrong
 */
function linkRecord({
  record,
  context,
  phrases,
}: {
  record: DocDiffRecord;
  context: BareRefContext;
  phrases: readonly PhraseLink[];
}): { readonly record: DocDiffRecord; readonly issues: readonly DocDiffIssue[] } {
  const issues: DocDiffIssue[] = [];
  const link = ({ markdown }: { markdown: string }): string => {
    const linked = linkDocumentMarkdown({ context, markdown, phrases });
    issues.push(...linkIssues({ linked }), ...deadAddressIssues({ images: new Set(), linked }));
    for (const url of bareAddresses({ markdown: linked.markdown })) {
      issues.push(
        DocDiffIssues.unsafeLink({
          url,
          why: "it is a bare address a reader's client would link, at no public web host or mailbox — write it as a link to where it should lead, or in backticks",
        }),
      );
    }
    return linked.markdown;
  };
  const [first, second, third] = record.keyChanges;
  return {
    record: {
      ...record,
      documents: record.documents.map((document) => ({
        ...document,
        changes: document.changes.map((change) => ({
          ...change,
          was: link({ markdown: change.was }),
          why: link({ markdown: change.why }),
        })),
        marks: document.marks.map((mark) => ({ ...mark, note: link({ markdown: mark.note }) })),
      })),
      keyChanges: [link({ markdown: first }), link({ markdown: second }), link({ markdown: third })],
      lede: link({ markdown: record.lede }),
      team: {
        ...record.team,
        ask: link({ markdown: record.team.ask }),
        opener: link({ markdown: record.team.opener }),
      },
    },
    issues,
  };
}
