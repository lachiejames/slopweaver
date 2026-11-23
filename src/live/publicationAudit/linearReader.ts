/**
 * The publication audit's Linear door: every object `./linearInventory.ts` resolved from the fleet's own write
 * ledgers, read back as it stands now through the same named-object read `linear read` uses (`./linearSeam.ts`).
 *
 * ## Exact objects only, and never somebody else's words
 *
 * A comment and a project update are found by their exact id inside their parent's connection, and ONLY that node's
 * `body` is judged: the other comments on the same issue are other people's, outside what the fleet published. Each
 * parent is read once, however many of the fleet's objects hang off it.
 *
 * ## A partial read is never clean
 *
 * Every blind spot is a fixed label from `LINEAR_PUBLICATION_GAPS` — never an id, a title, a URL or a provider
 * message. `NOT_FOUND` cannot prove a deletion, so it is `object not found or not visible`; a connection with more
 * pages than one read holds is `activity page ceiling reached`; an object that answers no Linear link stands in its
 * parent's, or the workspace root, and says so. Any gap, or any upload the published text links, makes the door
 * `partial`.
 */
import { isRecord } from "#lib/parsers.js";

import { planLinearAssets } from "../linear/assetPlan.js";

import {
  type LinearInventory,
  type ParentKind,
  type ParentRef,
  type PlannedObject,
  planLinearPublications,
} from "./linearInventory.js";
import { LINEAR_PUBLICATION_GAPS, type LinearPublicationReadError, type LinearPublicationSeam } from "./linearSeam.js";
import { doorCoverage, type PublicationRead, type PublishedText } from "./types.js";

/** Objects one run judges before it reports a ceiling — the Slack door's own bound. */
const LINEAR_PUBLICATION_OBJECT_LIMIT = 500;

/** The shape a Linear link takes; anything else stands in the parent's, or the workspace root, and says so. */
const LINEAR_LINK = /^https:\/\/linear\.app\/\S+$/u;

/** The stand-in link when neither the object nor its parent answered an address: fixed, so it carries no text. */
const LINEAR_ROOT_LINK = "https://linear.app/";

/** The fixed fields each object kind publishes, in the order they are judged. */
const OWN_FIELDS: Readonly<Record<ParentKind, readonly string[]>> = {
  document: ["title", "content"],
  issue: ["title", "description"],
  project: ["name", "description", "content"],
};

/** The objects one parent read serves, gathered so each parent is read once. */
interface ReadUnit {
  readonly parent: ParentRef;
  readonly objects: PlannedObject[];
}

/** The plan's objects grouped by parent, in the order each parent first appears in the sorted plan. */
function unitsOf({ objects }: { objects: readonly PlannedObject[] }): readonly ReadUnit[] {
  const units = new Map<string, ReadUnit>();
  for (const object of objects) {
    const key = `${object.parent.kind} ${object.parent.address}`;
    const unit = units.get(key);
    if (unit === undefined) {
      units.set(key, { objects: [object], parent: object.parent });
    } else {
      unit.objects.push(object);
    }
  }
  return [...units.values()];
}

/** The fixed gap one failed read contributes — never the provider's message. */
function readGap({ error }: { error: LinearPublicationReadError }): string {
  if (error.code === "NOT_FOUND") {
    return LINEAR_PUBLICATION_GAPS.objectNotFound;
  }
  if (error.code === "INVALID_ADDRESS" || error.code === "AMBIGUOUS_ADDRESS") {
    return LINEAR_PUBLICATION_GAPS.objectNotAddressable;
  }
  return LINEAR_PUBLICATION_GAPS.objectReadFailed;
}

/** A node's `url` when it is a Linear link, else undefined. */
function linearLinkOf({ node }: { node: unknown }): string | undefined {
  const url = isRecord(node) ? node["url"] : undefined;
  return typeof url === "string" && LINEAR_LINK.test(url) ? url : undefined;
}

/** The texts one object publishes under its fixed field names; an empty or absent field is not text. */
function textsOf({
  node,
  fields,
  objectKey,
  link,
}: {
  node: Record<string, unknown>;
  fields: readonly string[];
  objectKey: string;
  link: string;
}): readonly PublishedText[] {
  return fields.flatMap((field) => {
    const text = node[field];
    if (typeof text !== "string" || text.length === 0) {
      return [];
    }
    return [{ door: "linear" as const, field, link, linkCarriesNoText: false, objectKey, text }];
  });
}

/** What one unit's read produced: the texts, the keys of the objects judged, and the gaps it met. */
interface UnitRead {
  readonly texts: readonly PublishedText[];
  readonly objectKeys: readonly string[];
  readonly gaps: readonly string[];
}

/** A read that judged nothing and met one gap. */
function gapOnly({ gap }: { gap: string }): UnitRead {
  return { gaps: [gap], objectKeys: [], texts: [] };
}

/**
 * The exact-id nodes of one connection: each wanted object's node when present, the ceiling gap when the connection
 * says more follow, and the not-found gap when it ended without it. A malformed connection is a failed read.
 */
function exactNodes({
  connection,
  wanted,
  parentLink,
}: {
  connection: unknown;
  wanted: readonly PlannedObject[];
  parentLink: string;
}): UnitRead {
  const listed = isRecord(connection) ? connection["nodes"] : undefined;
  const pageInfo = isRecord(connection) ? connection["pageInfo"] : undefined;
  if (!Array.isArray(listed) || !isRecord(pageInfo) || typeof pageInfo["hasNextPage"] !== "boolean") {
    return gapOnly({ gap: LINEAR_PUBLICATION_GAPS.objectReadFailed });
  }
  const nodes: readonly unknown[] = listed;
  const texts: PublishedText[] = [];
  const objectKeys: string[] = [];
  const gaps: string[] = [];
  const missingGap = pageInfo["hasNextPage"]
    ? LINEAR_PUBLICATION_GAPS.activityPageCeiling
    : LINEAR_PUBLICATION_GAPS.objectNotFound;
  for (const object of wanted) {
    const node: unknown = nodes.find((candidate) => isRecord(candidate) && candidate["id"] === object.id);
    if (!isRecord(node)) {
      gaps.push(missingGap);
      continue;
    }
    const own = linearLinkOf({ node });
    let link: string;
    if (own === undefined) {
      gaps.push(LINEAR_PUBLICATION_GAPS.objectAddressUnresolved);
      link = parentLink;
    } else {
      link = own;
    }
    const found = textsOf({ fields: ["body"], link, node, objectKey: object.objectKey });
    if (found.length > 0) {
      objectKeys.push(object.objectKey);
      texts.push(...found);
    }
  }
  return { gaps, objectKeys, texts };
}

/** The link a child stands in when it answers none: the parent's own, else its recorded address, else the root. */
function parentLinkOf({ node, parent }: { node: unknown; parent: ParentRef }): string {
  const live = linearLinkOf({ node });
  if (live !== undefined) {
    return live;
  }
  if (LINEAR_LINK.test(parent.address)) {
    return parent.address;
  }
  return LINEAR_ROOT_LINK;
}

/** The own object's texts off a read node, linked by its live URL or a stand-in that says so. */
function ownTexts({
  node,
  unit,
  object,
}: {
  node: Record<string, unknown>;
  unit: ReadUnit;
  object: PlannedObject;
}): UnitRead {
  const own = linearLinkOf({ node });
  let link: string;
  let gaps: readonly string[];
  if (own === undefined) {
    link = parentLinkOf({ node: undefined, parent: unit.parent });
    gaps = [LINEAR_PUBLICATION_GAPS.objectAddressUnresolved];
  } else {
    link = own;
    gaps = [];
  }
  const texts = textsOf({ fields: OWN_FIELDS[unit.parent.kind], link, node, objectKey: object.objectKey });
  return {
    gaps,
    objectKeys: texts.length > 0 ? [object.objectKey] : [],
    texts,
  };
}

/** The parent object itself and its comments: one read, or none when only project updates hang off it. */
async function readParentObject({ unit, seam }: { unit: ReadUnit; seam: LinearPublicationSeam }): Promise<{
  readonly reads: readonly UnitRead[];
  readonly node: unknown;
}> {
  const own = unit.objects.filter((object) => object.role === "own");
  const comments = unit.objects.filter((object) => object.role === "comment");
  if (own.length === 0 && comments.length === 0) {
    return { node: undefined, reads: [] };
  }
  const read = await seam.readObject({ address: unit.parent.address, comments: comments.length > 0 });
  if (read.isErr()) {
    return { node: undefined, reads: [gapOnly({ gap: readGap({ error: read.error }) })] };
  }
  const node = read.value;
  if (!isRecord(node)) {
    return { node: undefined, reads: [gapOnly({ gap: LINEAR_PUBLICATION_GAPS.objectReadFailed })] };
  }
  const reads = own.map((object) => ownTexts({ node, object, unit }));
  if (comments.length > 0) {
    const parentLink = parentLinkOf({ node, parent: unit.parent });
    reads.push(exactNodes({ connection: node["comments"], parentLink, wanted: comments }));
  }
  return { node, reads };
}

/** One parent's whole read: the object and its comments, then its project updates. */
async function readUnit({ unit, seam }: { unit: ReadUnit; seam: LinearPublicationSeam }): Promise<readonly UnitRead[]> {
  const parentRead = await readParentObject({ seam, unit });
  const updates = unit.objects.filter((object) => object.role === "project-update");
  if (updates.length === 0) {
    return parentRead.reads;
  }
  const connection = await seam.readProjectUpdates({ address: unit.parent.address });
  if (connection.isErr()) {
    return [...parentRead.reads, gapOnly({ gap: readGap({ error: connection.error }) })];
  }
  const parentLink = parentLinkOf({ node: parentRead.node, parent: unit.parent });
  return [...parentRead.reads, exactNodes({ connection: connection.value, parentLink, wanted: updates })];
}

/**
 * Read back every Linear object the inventory names, sequentially, and judge nothing yet: the texts and the door's
 * coverage.
 *
 * @param inventory the ledgers, as `readLinearInventory` listed them
 * @param seam the reads (`productionLinearPublicationSeam` in production, plain functions in a test)
 * @param objectLimit objects judged before `object ceiling reached` is reported
 * @returns the texts to judge and the door's coverage, `partial` on any gap or unread upload
 */
export async function readLinearPublications({
  inventory,
  seam,
  objectLimit = LINEAR_PUBLICATION_OBJECT_LIMIT,
}: {
  inventory: LinearInventory;
  seam: LinearPublicationSeam;
  objectLimit?: number;
}): Promise<PublicationRead> {
  const plan = planLinearPublications({ inventory, objectLimit });
  const gaps: string[] = [...plan.gaps];
  const texts: PublishedText[] = [];
  const objectKeys = new Set<string>();
  // Sequential on purpose: the shared transport paces every Linear request against one budget.
  for (const unit of unitsOf({ objects: plan.objects })) {
    for (const read of await readUnit({ seam, unit })) {
      gaps.push(...read.gaps);
      texts.push(...read.texts);
      for (const key of read.objectKeys) {
        objectKeys.add(key);
      }
    }
  }
  const attachmentsNotSwept = planLinearAssets({ data: texts.map((piece) => piece.text), max: 0 }).found;
  if (attachmentsNotSwept > 0) {
    gaps.push(LINEAR_PUBLICATION_GAPS.uploadsNotRead);
  }
  return {
    coverage: doorCoverage({
      attachmentsNotSwept,
      door: "linear",
      gaps,
      objects: objectKeys.size,
      texts: texts.length,
    }),
    texts,
  };
}
