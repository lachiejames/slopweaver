/**
 * Reading Vanta's EVIDENCE requests out of the atlas as `policy diff` needs to see them: one flat record per
 * evidence document, carrying its uploads, links and mapped controls, with no atlas vocabulary on it.
 *
 * ## What is read, and what is deliberately not
 *
 * The atlas holds five kinds that together describe one evidence request: `evidence` (`/v1/documents`),
 * `document-upload` and `document-link` beneath it, `control-document-link` joining it to controls, and
 * `control` for the names. {@link evidenceView} reduces the five to one record per document — a pure
 * function over plain provider detail, so every rule below is settled by a unit test.
 *
 * An upload's FILE NAME and TITLE are not carried at all, nor is a link's URL or title. A review page and its
 * team post are shared beyond compliance, and those fields carry people's names (board CVs, a visitor log) and, for
 * a link, an access grant (a public share view). The upload's own Vanta address is left out for the same
 * reason: it embeds the upload's title. What a reader gets instead is the evidence request's own Vanta link.
 *
 * ## Sensitivity fails CLOSED
 *
 * A document is treated as sensitive unless Vanta says `isSensitive: false` in exactly those words. An absent
 * or malformed flag is sensitive, never public — a renderer that shows file detail for "not known to be
 * sensitive" is the one that eventually publishes an employee's background check.
 */
import type { VantaKind } from "../atlas/vanta/model.js";
import { readVantaKindFile, vantaAtlasPaths } from "../atlas/vanta/store.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { apiDetail } from "./atlasView.js";

/** One or more of the five evidence kinds could not be read from the atlas, so no evidence view was built. */
export interface EvidenceAtlasUnreadError {
  readonly code: "EVIDENCE_ATLAS_UNREAD";
  readonly message: string;
  readonly reasons: readonly string[];
}

/**
 * The factory for why the evidence view could not be read.
 *
 * @internal
 */
export const EvidenceAtlasErrors = {
  unread: ({ reasons }: { reasons: readonly string[] }): EvidenceAtlasUnreadError => ({
    code: "EVIDENCE_ATLAS_UNREAD",
    message: `the Vanta atlas gave no whole picture of evidence: ${reasons.join("; ")}`,
    reasons,
  }),
} as const;

/**
 * One file uploaded to an evidence request, reduced to what may be shown.
 *
 * @internal
 */
export interface EvidenceUpload {
  readonly uploadId: string;
  readonly creationDate: string | null;
  readonly effectiveDate: string | null;
  readonly mimeType: string | null;
  /** `USER`, `INTEGRATION` — the uploader's KIND, never who. */
  readonly uploadedByType: string | null;
}

/**
 * One link attached to an evidence request, reduced to its host.
 *
 * @internal
 */
export interface EvidenceLink {
  readonly linkId: string;
  readonly creationDate: string | null;
  /** The host alone — the whole URL can be an access grant. */
  readonly host: string | null;
}

/**
 * One control an evidence request is mapped to.
 *
 * @internal
 */
export interface EvidenceControl {
  readonly controlId: string;
  readonly externalId: string | null;
  readonly name: string | null;
}

/** One evidence request, everything a review page may say about it. */
export interface EvidenceDocument {
  readonly documentId: string;
  readonly title: string;
  readonly category: string | null;
  readonly description: string | null;
  /** Vanta's own words: `OK`, `Needs update`, `Needs document`. */
  readonly uploadStatus: string | null;
  readonly uploadStatusDate: string | null;
  readonly url: string | null;
  /** True unless Vanta said `isSensitive: false` exactly. */
  readonly sensitive: boolean;
  readonly uploads: readonly EvidenceUpload[];
  readonly links: readonly EvidenceLink[];
  readonly controls: readonly EvidenceControl[];
}

/** The provider detail of every kind {@link evidenceView} reads, one array per kind. */
export interface EvidenceKindDetails {
  readonly documents: readonly unknown[];
  readonly uploads: readonly unknown[];
  readonly links: readonly unknown[];
  readonly controlLinks: readonly unknown[];
  readonly controls: readonly unknown[];
}

/** A record field read as a non-empty string, or null. */
function stringField({ record, key }: { record: Record<string, unknown>; key: string }): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Plain code-unit order, so a sort never depends on the machine's locale. */
function byCodeUnit({ left, right }: { left: string; right: string }): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/** A URL's host, or null when it is not a URL at all. */
function hostOf({ url }: { url: string | null }): string | null {
  if (url === null) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Push a value onto the list held under a key, creating the list on first use. */
function pushUnder<T>({ map, key, value }: { map: Map<string, T[]>; key: string; value: T }): void {
  const held = map.get(key);
  if (held === undefined) {
    map.set(key, [value]);
    return;
  }
  held.push(value);
}

/** What a document holds under one key: a document nothing points at holds nothing, by design. */
function heldBy<T>({ map, documentId }: { map: Map<string, Iterable<T>>; documentId: string }): T[] {
  const held = map.get(documentId);
  if (held === undefined) {
    return [];
  }
  return [...held];
}

/** Every live upload, grouped by the evidence document it belongs to. */
function uploadsByDocument({ uploads }: { uploads: readonly unknown[] }): Map<string, EvidenceUpload[]> {
  const grouped = new Map<string, EvidenceUpload[]>();
  for (const detail of uploads) {
    if (!isRecord(detail) || detail["deletionDate"] != null) {
      continue;
    }
    const parentId = stringField({ key: "parentId", record: detail });
    const uploadId = stringField({ key: "id", record: detail });
    if (parentId === null || uploadId === null) {
      continue;
    }
    const uploadedBy = detail["uploadedBy"];
    pushUnder({
      key: parentId,
      map: grouped,
      value: {
        creationDate: stringField({ key: "creationDate", record: detail }),
        effectiveDate: stringField({ key: "effectiveDate", record: detail }),
        mimeType: stringField({ key: "mimeType", record: detail }),
        uploadId,
        uploadedByType: isRecord(uploadedBy) ? stringField({ key: "type", record: uploadedBy }) : null,
      },
    });
  }
  return grouped;
}

/** Every link, grouped by the evidence document it belongs to. */
function linksByDocument({ links }: { links: readonly unknown[] }): Map<string, EvidenceLink[]> {
  const grouped = new Map<string, EvidenceLink[]>();
  for (const detail of links) {
    if (!isRecord(detail)) {
      continue;
    }
    const parentId = stringField({ key: "parentId", record: detail });
    const linkId = stringField({ key: "id", record: detail });
    if (parentId === null || linkId === null) {
      continue;
    }
    pushUnder({
      key: parentId,
      map: grouped,
      value: {
        creationDate: stringField({ key: "creationDate", record: detail }),
        host: hostOf({ url: stringField({ key: "url", record: detail }) }),
        linkId,
      },
    });
  }
  return grouped;
}

/**
 * Every mapped control id, grouped by evidence document, deduplicated.
 *
 * The atlas records one mapping from BOTH ends — a control's documents (`parentKind: control`, the document
 * as `childId`) and a document's controls (`parentKind: evidence`, the control as `childId`) — so the same
 * pair usually arrives twice and is kept once.
 */
function controlIdsByDocument({ controlLinks }: { controlLinks: readonly unknown[] }): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const detail of controlLinks) {
    if (!isRecord(detail)) {
      continue;
    }
    const parentKind = stringField({ key: "parentKind", record: detail });
    const parentId = stringField({ key: "parentId", record: detail });
    const childId = stringField({ key: "childId", record: detail });
    if (parentId === null || childId === null) {
      continue;
    }
    let mapping: { control: string; document: string };
    if (parentKind === "evidence") {
      mapping = { control: childId, document: parentId };
    } else if (parentKind === "control") {
      mapping = { control: parentId, document: childId };
    } else {
      continue;
    }
    const held = grouped.get(mapping.document);
    if (held === undefined) {
      grouped.set(mapping.document, new Set([mapping.control]));
    } else {
      held.add(mapping.control);
    }
  }
  return grouped;
}

/** Every control's display fields, by id. */
function controlsById({ controls }: { controls: readonly unknown[] }): Map<string, EvidenceControl> {
  const byId = new Map<string, EvidenceControl>();
  for (const detail of controls) {
    if (!isRecord(detail)) {
      continue;
    }
    const controlId = stringField({ key: "id", record: detail });
    if (controlId === null) {
      continue;
    }
    byId.set(controlId, {
      controlId,
      externalId: stringField({ key: "externalId", record: detail }),
      name: stringField({ key: "name", record: detail }),
    });
  }
  return byId;
}

/** The sort key a control is listed under: its framework id when it has one, else its Vanta id. */
function controlKey({ control }: { control: EvidenceControl }): string {
  if (control.externalId === null) {
    return `~${control.controlId}`;
  }
  return control.externalId;
}

/**
 * Reduce the five evidence kinds to one record per evidence document, every list in a stable order.
 *
 * A deleted upload is dropped, an upload or link whose document is not listed has nowhere to render and is
 * dropped with it, and a mapped control the control kind does not name is still listed, by its id.
 *
 * @param details each kind's Manage-API detail, already filtered to entities Vanta still lists
 * @returns one record per evidence document, ordered by document id
 */
export function evidenceView({ details }: { details: EvidenceKindDetails }): readonly EvidenceDocument[] {
  const uploads = uploadsByDocument({ uploads: details.uploads });
  const links = linksByDocument({ links: details.links });
  const controlIds = controlIdsByDocument({ controlLinks: details.controlLinks });
  const controls = controlsById({ controls: details.controls });
  const documents: EvidenceDocument[] = [];
  for (const detail of details.documents) {
    if (!isRecord(detail)) {
      continue;
    }
    const documentId = stringField({ key: "id", record: detail });
    const title = stringField({ key: "title", record: detail });
    if (documentId === null || title === null) {
      continue;
    }
    const mapped = heldBy({ documentId, map: controlIds }).map((controlId) => {
      const named = controls.get(controlId);
      if (named === undefined) {
        return { controlId, externalId: null, name: null };
      }
      return named;
    });
    documents.push({
      category: stringField({ key: "category", record: detail }),
      controls: mapped.toSorted((left, right) =>
        byCodeUnit({ left: controlKey({ control: left }), right: controlKey({ control: right }) }),
      ),
      description: stringField({ key: "description", record: detail }),
      documentId,
      links: heldBy({ documentId, map: links }).toSorted((left, right) =>
        byCodeUnit({ left: `${left.creationDate}|${left.linkId}`, right: `${right.creationDate}|${right.linkId}` }),
      ),
      sensitive: detail["isSensitive"] !== false,
      title,
      uploadStatus: stringField({ key: "uploadStatus", record: detail }),
      uploadStatusDate: stringField({ key: "uploadStatusDate", record: detail }),
      uploads: heldBy({ documentId, map: uploads }).toSorted((left, right) =>
        byCodeUnit({
          left: `${left.creationDate}|${left.uploadId}`,
          right: `${right.creationDate}|${right.uploadId}`,
        }),
      ),
      url: stringField({ key: "url", record: detail }),
    });
  }
  return documents.toSorted((left, right) => byCodeUnit({ left: left.documentId, right: right.documentId }));
}

/** Every Manage-API detail one kind file holds for entities Vanta still lists. */
function liveDetails({
  home,
  kind,
}: {
  home: string;
  kind: VantaKind;
}): Result<readonly unknown[], EvidenceAtlasUnreadError> {
  const file = readVantaKindFile({ kind, paths: vantaAtlasPaths({ home }) });
  if (file.isErr()) {
    return err(EvidenceAtlasErrors.unread({ reasons: file.error }));
  }
  if (file.value === null) {
    return err(
      EvidenceAtlasErrors.unread({
        reasons: [`the Vanta atlas holds no ${kind} file — run: slopweaver atlas vanta sync`],
      }),
    );
  }
  return ok(file.value.entities.map((entity) => apiDetail({ entity })).filter((detail) => detail !== null));
}

/**
 * Read every evidence document the Vanta atlas holds, with its uploads, links and controls.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns one record per evidence document, or every kind that could not be read
 */
export function readEvidenceAtlasView({
  home,
}: {
  home: string;
}): Result<readonly EvidenceDocument[], EvidenceAtlasUnreadError> {
  const documents = liveDetails({ home, kind: "evidence" });
  const uploads = liveDetails({ home, kind: "document-upload" });
  const links = liveDetails({ home, kind: "document-link" });
  const controlLinks = liveDetails({ home, kind: "control-document-link" });
  const controls = liveDetails({ home, kind: "control" });
  if (documents.isErr() || uploads.isErr() || links.isErr() || controlLinks.isErr() || controls.isErr()) {
    const reasons = [documents, uploads, links, controlLinks, controls].flatMap((kind) =>
      kind.isErr() ? kind.error.reasons : [],
    );
    return err(EvidenceAtlasErrors.unread({ reasons }));
  }
  return ok(
    evidenceView({
      details: {
        controlLinks: controlLinks.value,
        controls: controls.value,
        documents: documents.value,
        links: links.value,
        uploads: uploads.value,
      },
    }),
  );
}
