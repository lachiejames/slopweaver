/**
 * Which atlas kind each Figma operation feeds, and why the answer is not simply the operation's tag.
 *
 * ## The tag is Figma's vocabulary; the kind is the reader's
 *
 * Datadog's registry takes its kind from the first meaningful path segment, and JumpCloud's from the
 * Directory API's own roots, because on those platforms the provider's noun and the reader's noun coincide.
 * On Figma they diverge in three ways that each cost a reader an answer:
 *
 * - **A tag can name the CONTAINER when the response is its contents.** `getFolderFiles` and
 *   `getProjectFiles` are tagged `Folders` and `Projects`; both return files. Filed under the container,
 *   "which files are in this folder" and "what is this folder" become one question with two answers.
 * - **One tag can hold two dispositions.** `Library Analytics` covers six operations, three of which are
 *   dated action feeds (observations) and three of which are current usage listings (configuration). The
 *   voluminous criterion in `docs/atlas-intent/06-holdings.md` cuts THROUGH that tag rather than along it, and the
 *   three usage operations feed the assets they are about — component, style, variable — rather than a
 *   shared analytics bucket.
 * - **A tag can be about the CREDENTIAL rather than the organisation.** `Users` has one operation,
 *   `GET /v1/me`, which answers who this token authenticates as. Filed under a person kind it would put an
 *   installation detail in a file whose every other row is a thing the organisation owns.
 *
 * So the kind is a decision recorded here, `alsoFeeds` carries the fan-out, and the generator refuses an
 * operation this table cannot place — which is what stops a new Figma tag from silently landing in a kind
 * nobody chose.
 *
 * ## Two kinds are fed by NO operation, and that is the finding rather than an oversight
 *
 * `team` and `person` are declared and no row produces them, because Figma's REST surface has no operation
 * that returns either. There is no endpoint that lists the teams a credential can see — so every
 * team-scoped call needs a `team_id` that only a browser URL supplies — and none that returns a team's or
 * an organisation's membership. Both are reachable in the browser and nowhere else, which is
 * `docs/atlas-intent/02-both-surfaces.md`'s "things via the browser you can't get by API" arriving as a measured property
 * of this platform. Declaring the kinds is how the atlas SAYS that; omitting them would let the same fact
 * read as an absence nobody noticed.
 */

/**
 * Every kind the Figma atlas holds, sorted.
 *
 * Two of them map the platform rather than the organisation — `method` is the API surface and `page` the
 * browser one. The other sixteen are entities, because Figma is the "everything reachable" side of
 * `docs/atlas-intent/06-holdings.md`'s test: nothing else in this installation holds a Figma file, component,
 * variable or library, so if this atlas does not, nothing does.
 */
export const FIGMA_ATLAS_KINDS = [
  "comment",
  "component",
  "component-set",
  "credential",
  "dev-resource",
  "event-shape",
  "file",
  "file-version",
  "folder",
  "method",
  "page",
  "person",
  "project",
  "reaction",
  "style",
  "team",
  "variable",
  "webhook",
] as const;

/** One kind the Figma atlas holds. */
export type FigmaAtlasKind = (typeof FIGMA_ATLAS_KINDS)[number];

/**
 * The kind each of Figma's own tags feeds by default.
 *
 * Total over the 18 tags the pinned document declares. Every one of them carries at least one operation, so
 * unlike the Airtable table there is no entry here placed purely against a future endpoint.
 */
const KIND_BY_TAG: Readonly<Record<string, FigmaAtlasKind>> = {
  "Activity Logs": "event-shape",
  "AI Usage": "event-shape",
  "Comment Reactions": "reaction",
  Comments: "comment",
  "Component Sets": "component-set",
  Components: "component",
  "Dev Resources": "dev-resource",
  "Developer Logs": "event-shape",
  Files: "file",
  Folders: "folder",
  "Library Analytics": "event-shape",
  oEmbed: "file",
  Payments: "person",
  Projects: "project",
  Styles: "style",
  Users: "credential",
  Variables: "variable",
  Webhooks: "webhook",
};

/**
 * The operations whose kind their tag gets wrong, each with the reason.
 *
 * Every entry is a case where the tag names the CONTAINER, the PRODUCT AREA or the CREDENTIAL and the
 * reader needs the RESOURCE. Kept as an explicit table rather than derived from the path, because deriving
 * it would put a second, weaker classifier beside this one and the two would eventually disagree.
 */
const KIND_BY_OPERATION: Readonly<Record<string, FigmaAtlasKind>> = {
  // Tagged `Files` because the file is what the path names; the resource returned is the version history,
  // which is a different thing with its own identity and its own retention rules.
  getFileVersions: "file-version",
  // Tagged for their container. Both return files.
  getFolderFiles: "file",
  getProjectFiles: "file",
  // The three CURRENT-STATE halves of the Library Analytics tag. Each returns, for one published library,
  // the assets in it and where they are used — a finite listing keyed by an asset somebody named, not a
  // dated feed. So each feeds the asset kind it is about. The three `…Actions` siblings take a
  // start_date/end_date window and stay `event-shape` via the tag default, which is the voluminous
  // criterion cutting through the tag rather than along it.
  getLibraryAnalyticsComponentUsages: "component",
  getLibraryAnalyticsStyleUsages: "style",
  getLibraryAnalyticsVariableUsages: "variable",
  // Tagged `Webhooks` because that is the resource in the path. What it RETURNS is the stream of delivery
  // attempts Figma made — observations emitted by the platform, which is a different kind from the
  // webhook configuration that produced them.
  getWebhookRequests: "event-shape",
};

/**
 * The kinds one operation feeds BEYOND its own, because its single response carries them nested.
 *
 * One member. `GET /v1/files/{file_key}` returns the whole document and, beside the node tree, the file's
 * own `components`, `componentSets` and `styles` maps — every published asset the file references, keyed by
 * the same ids `getComponent` and `getStyle` take. A registry that could only name `file` would make those
 * invisible, and they are the part of the response an asset-inventory question actually needs.
 */
const ALSO_FEEDS: Readonly<Record<string, readonly FigmaAtlasKind[]>> = {
  getFile: ["component", "component-set", "style"],
};

/** The kind an operation id names outright, else the one its tag names, else none. */
function placedKind({ operationId, tag }: { operationId: string; tag: string }): FigmaAtlasKind | undefined {
  const byOperation = KIND_BY_OPERATION[operationId];
  if (byOperation == null) {
    return KIND_BY_TAG[tag];
  }
  return byOperation;
}

/**
 * Which kind an operation feeds, and which others its response also fills.
 *
 * @param operationId Figma's own operation id
 * @param tag the operation's first declared tag
 * @returns the primary kind and the fan-out, or `null` when this table cannot place the operation
 */
export function figmaKindFor({ operationId, tag }: { operationId: string; tag: string }): {
  readonly alsoFeeds: readonly FigmaAtlasKind[];
  readonly kind: FigmaAtlasKind;
} | null {
  const kind = placedKind({ operationId, tag });
  if (kind === undefined) {
    return null;
  }
  // `ALSO_FEEDS` names only the operations whose response fills a second kind; the rest fill their own alone.
  const alsoFeeds = ALSO_FEEDS[operationId];
  if (alsoFeeds === undefined) {
    return { alsoFeeds: [], kind };
  }
  return { alsoFeeds, kind };
}
