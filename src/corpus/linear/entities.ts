/**
 * The eight bulk Linear entities the connector never fetched, and where each one lands.
 *
 * Routing them is the whole design problem — "capture everything" is easy, "capture everything somewhere a
 * reader will actually find it" is not. Three destinations, chosen per entity by what the thing IS:
 * this file projects the record and member lanes, and the two STRUCTURE kinds are projected in
 * `./vocabularyRows.ts`.
 *
 * | entity | measured | destination | why |
 * | --- | --- | --- | --- |
 * | `customerNeeds` | 2,568 | a NEW searchable `need` record kind | the only one carrying verbatim CUSTOMER prose; nothing existing fits, and burying it in an attr would make the org's own customer evidence unsearchable |
 * | `projectMilestones` | 1,244 | the existing `milestone` record kind | dated checkpoints, exactly what that kind already means for GitHub |
 * | `initiativeUpdates` | 93 | the existing `update` record kind | the strategy layer's project-status update |
 * | `templates` | 86 | the existing `document` record kind | deliberately-authored scaffolding, same class as a spec |
 * | `issueLabels` | 1,255 | a NEW `issue_label` STRUCTURE kind | org vocabulary, not activity — and only label NAMES rode the issue query, so every description and the whole hierarchy were lost |
 * | `customViews` | 152 | a NEW `custom_view` STRUCTURE kind | a durable statement about what a team treats as one body of work |
 * | `externalUsers` | 652 | the MEMBERS store | identity substrate; each carries an email, so a customer contact becomes joinable to the comments they left |
 * | `initiativeToProjects` | 776 | the existing `project-item` curated EDGE | a link, not an entity — and see below on where it is read from |
 *
 * ## The initiative→project link is read from the nested connection, not the root query
 *
 * `Initiative.projects` is already fetched on the initiatives lane, with `includeArchived` and
 * `includeSubInitiatives`, and it yields the identical set of links for ZERO extra requests. It also gives the
 * edge a natural HOLDER — the initiative's own record — whereas the root `initiativeToProjects` query returns
 * standalone join rows with nowhere to live. What the root query would add is the join row's own `id`,
 * `createdAt` and `sortOrder`; those are not captured, and that is a stated trade rather than an oversight.
 * The measured maximum is 51 projects on one initiative, well inside the inline page, and an overflow is
 * REPORTED rather than silently truncated.
 *
 * ## A failing lane never aborts the run, and never passes as complete
 *
 * A workspace or plan may not expose an entity, and `auditEntries` proves the shape of that risk: it exists in
 * the schema and returns HTTP 403 for this token, so it is left out of `makeLinearApi` rather than walked. A
 * lane that IS walked and then fails yields an empty list and an `incomplete` line, never a failed fetch:
 * `refresh` turns that line into a coverage gap, which fails the source and holds its cursor so the next pass
 * re-reads the window, while the lanes that did arrive are still committed.
 */
import { isRecord } from "../../lib/parsers.js";
import { classifyCurated } from "../curated/classify.js";
import { CURATED_CLASS_ATTR } from "../curated/types.js";
import { buildMemberIdentity } from "../members/email.js";
import type { MemberBronzeRow } from "../members/types.js";
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { displayName, nestedStr, parseReactionData, str, strOrEmpty } from "./parseFields.js";

/** Copy each defined, non-empty entry into an attrs map. Pure. */
function attrsOf({
  entries,
}: {
  entries: readonly (readonly [string, CorpusAttributeValue | undefined])[];
}): Record<string, CorpusAttributeValue> {
  const out: Record<string, CorpusAttributeValue> = {};
  for (const [key, value] of entries) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** `Label: value` when defined, else undefined. Pure. */
function labelled({ label, value }: { label: string; value: string | number | undefined }): string | undefined {
  return value === undefined ? undefined : `${label}: ${String(value)}`;
}

/** Join the defined parts of a context line. Pure. */
function contextLine({ parts }: { parts: readonly (string | undefined)[] }): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" · ");
}

/** Join defined blocks with a blank line between them. Pure. */
function joinBlocks({ parts }: { parts: readonly (string | undefined)[] }): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join("\n");
}

/** A finite number, or undefined. */
function num({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * One customer need → a `need` record.
 *
 * `body` is the customer's own words; `content` is the rich-text form of the same thing. Both are tried, in
 * that order, so a need is never reduced to its metadata. The customer NAME goes into the searchable text as
 * well as `attrs`, because `retrievalIndex.ts` indexes title/text/refs and "what did <customer> ask for" is
 * precisely the question this entity exists to answer. Pure.
 *
 * @param node the raw customer-need node
 * @returns the record, or undefined without an id or any prose
 */
export function customerNeedRecord({ node }: { node: unknown }): CorpusRecord | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  const prose = str({ value: node["body"] }) ?? str({ value: node["content"] });
  if (id === undefined || prose === undefined) {
    return undefined;
  }
  const customer = nestedStr({ key: "name", value: node["customer"] });
  const issue = nestedStr({ key: "identifier", value: node["issue"] });
  const project = nestedStr({ key: "name", value: node["project"] });
  const context = contextLine({
    parts: [
      labelled({ label: "Customer", value: customer }),
      labelled({ label: "Issue", value: issue }),
      labelled({ label: "Project", value: project }),
    ],
  });
  const text = joinBlocks({ parts: [context, prose] });
  return {
    attrs: attrsOf({
      entries: [
        ["customer", customer],
        ["issue", issue],
        ["project", project],
        ["priority", num({ value: node["priority"] })],
        ["creator", displayName({ value: node["creator"] })],
        ["createdAt", str({ value: node["createdAt"] })],
      ],
    }),
    container: "linear",
    kind: "need",
    raw: node,
    refs: extractRefs({ text: joinBlocks({ parts: [issue, prose] }) }),
    source: "linear",
    sourceId: `need:${id}`,
    text,
    title: customer === undefined ? "Customer need" : `Customer need — ${customer}`,
    tsIso: strOrEmpty({ value: node["updatedAt"] }),
    url: strOrEmpty({ value: node["url"] }),
  };
}

/**
 * One project milestone → a `milestone` record (the kind GitHub milestones already use, so no new vocabulary).
 *
 * @param node the raw milestone node
 * @returns the record, or undefined without an id + name
 */
export function projectMilestoneRecord({ node }: { node: unknown }): CorpusRecord | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  const name = str({ value: node["name"] });
  if (id === undefined || name === undefined) {
    return undefined;
  }
  const project = nestedStr({ key: "name", value: node["project"] });
  const status = str({ value: node["status"] });
  const targetDate = str({ value: node["targetDate"] });
  const description = str({ value: node["description"] });
  const context = contextLine({
    parts: [
      labelled({ label: "Project", value: project }),
      labelled({ label: "Status", value: status }),
      labelled({ label: "Target", value: targetDate }),
    ],
  });
  return {
    attrs: attrsOf({
      entries: [
        ["project", project],
        ["status", status],
        ["targetDate", targetDate],
        ["progress", num({ value: node["progress"] })],
        ["createdAt", str({ value: node["createdAt"] })],
        ["archivedAt", str({ value: node["archivedAt"] })],
      ],
    }),
    container: "linear",
    kind: "milestone",
    raw: node,
    refs: extractRefs({ text: joinBlocks({ parts: [name, description] }) }),
    source: "linear",
    sourceId: `milestone:${id}`,
    text: joinBlocks({ parts: [context, description] }) || name,
    title: name,
    tsIso: strOrEmpty({ value: node["updatedAt"] }),
    url: "",
  };
}

/**
 * One initiative update → an `update` record, classified `status` by the same heuristic project updates use.
 *
 * @param node the raw initiative-update node
 * @returns the record, or undefined without an id + body
 */
export function initiativeUpdateRecord({ node }: { node: unknown }): CorpusRecord | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  const body = str({ value: node["body"] });
  if (id === undefined || body === undefined) {
    return undefined;
  }
  const initiative = nestedStr({ key: "name", value: node["initiative"] });
  const health = str({ value: node["health"] });
  const author = nestedStr({ key: "id", value: node["user"] }) ?? displayName({ value: node["user"] });
  const classification = classifyCurated({ kind: "update", text: body });
  return {
    attrs: attrsOf({
      entries: [
        ["initiative", initiative],
        ["health", health],
        ["reactions", parseReactionData({ value: node["reactionData"] })],
        ["editedAt", str({ value: node["editedAt"] })],
        ...(classification !== undefined
          ? ([[CURATED_CLASS_ATTR, classification]] as const)
          : ([] as readonly (readonly [string, CorpusAttributeValue | undefined])[])),
      ],
    }),
    container: "linear",
    kind: "update",
    raw: node,
    refs: extractRefs({ text: body }),
    source: "linear",
    sourceId: `initiativeUpdate:${id}`,
    text: body,
    title: `Initiative update: ${initiative ?? "unknown"}${health === undefined ? "" : ` (${health})`}`,
    tsIso: strOrEmpty({ value: node["createdAt"] }),
    url: strOrEmpty({ value: node["url"] }),
    ...(author !== undefined ? { author } : {}),
  };
}

/**
 * One template → a `document` record. Deliberately-authored scaffolding for how work gets written down, which
 * is the same class of artefact as a spec.
 *
 * @param node the raw template node
 * @returns the record, or undefined without an id + name
 */
export function templateRecord({ node }: { node: unknown }): CorpusRecord | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  const name = str({ value: node["name"] });
  if (id === undefined || name === undefined) {
    return undefined;
  }
  const team = nestedStr({ key: "key", value: node["team"] });
  const type = str({ value: node["type"] });
  const description = str({ value: node["description"] });
  const context = contextLine({
    parts: [labelled({ label: "Team", value: team }), labelled({ label: "Type", value: type })],
  });
  return {
    attrs: attrsOf({
      entries: [
        ["team", team],
        ["templateType", type],
        ["creator", displayName({ value: node["creator"] })],
        ["createdAt", str({ value: node["createdAt"] })],
      ],
    }),
    container: "linear",
    kind: "document",
    raw: node,
    refs: extractRefs({ text: joinBlocks({ parts: [name, description] }) }),
    source: "linear",
    sourceId: `template:${id}`,
    text: joinBlocks({ parts: [context, description] }) || name,
    title: `Template: ${name}`,
    tsIso: strOrEmpty({ value: node["updatedAt"] }),
    url: "",
  };
}

/**
 * One external user → a MEMBER row.
 *
 * They belong with the members rather than as records for the same reason org members do: they are identity
 * substrate. What this closes is a real gap — 652 non-member commenters were entirely anonymous in the corpus,
 * so a comment from a customer contact had no author at all. Each carries an email, which is the resolver's
 * cross-source join key, so the contact becomes joinable to whatever else the org knows about them.
 *
 * `provenance` is what marks them external. There is no `external` profile flag to set and inventing one would
 * change the member contract for every source; the provenance string is already the honest signal. Pure.
 *
 * @param node the raw external-user node
 * @param fetchedAtIso the hydration timestamp
 * @returns the member row, or undefined without an id
 */
export function externalUserRow({
  node,
  fetchedAtIso,
}: {
  node: unknown;
  fetchedAtIso: string;
}): MemberBronzeRow | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  if (id === undefined) {
    return undefined;
  }
  const handle = str({ value: node["displayName"] });
  const name = str({ value: node["name"] }) ?? handle;
  const email = str({ value: node["email"] });
  const avatarUrl = str({ value: node["avatarUrl"] });
  return {
    fetchedAtIso,
    identity: buildMemberIdentity({
      nativeId: id,
      source: "linear",
      ...(handle !== undefined ? { handle } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
    }),
    profile: {
      // `active` is deliberately ABSENT rather than `true`. An external user has no `active` field at all,
      // so asserting one is a statement about the record rather than a reading of the provider — and
      // the store copies this field onto `PlatformIdentity.active`, where the whole contract is
      // "what the provider actually said", with `null` reserved for "it said nothing". A hardcoded `true`
      // there would report an external contact as confirmed-present on the word of an API that was never
      // asked. Every other reader tests `active !== false`, so absent and `true` are identical to them.
      bot: false,
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    },
    provenance: ["linear.externalUsers"],
    raw: node,
    source: "linear",
    sourceId: id,
    version: 1,
    warnings: email === undefined ? ["no email on Linear external user"] : [],
  };
}

// `initiativeProjectEdges` lives in `curated.ts` (re-exported here for every existing importer) — see that
// function's own doc comment for why.
export { initiativeProjectEdges } from "./curated.js";
