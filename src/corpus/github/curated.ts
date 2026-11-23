/**
 * The pure half of the GitHub curated-knowledge lane (PR4.3): the deliberately-authored planning + ownership
 * artefacts — discussions, releases + milestones, and CODEOWNERS — shaped from raw payloads and projected into
 * `CorpusRecord`s, with milestone→issue grouping edges and CODEOWNERS→owner ownership edges. Unit-tested with
 * fixtures. `./curatedFetch.ts` gathers those raw payloads.
 */
import { isRecord } from "../../lib/parsers.js";
import { classifyCurated } from "../curated/classify.js";
import { CURATED_CLASS_ATTR, CURATED_EDGES_ATTR, encodeCuratedEdgeRef } from "../curated/types.js";
import { extractRefs } from "../refs.js";
import { optStr as str } from "../slack/shape.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { authorLoginOf, releaseNameOf, strOrEmpty } from "./curatedFields.js";

/** A GitHub discussion (deliberately-authored Q&A / RFC / decision). */
export interface GithubDiscussionItem {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tsIso: string;
  readonly author?: string;
  readonly category?: string;
}

/** A GitHub release (a shipped-status artefact). */
export interface GithubReleaseItem {
  readonly tag: string;
  readonly name: string;
  readonly body: string;
  readonly url: string;
  readonly tsIso: string;
  readonly author?: string;
}

/** A GitHub milestone + the issue/PR numbers grouped under it (the grouping edge targets). */
export interface GithubMilestoneItem {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly tsIso: string;
  readonly state?: string;
  readonly issueNumbers: readonly number[];
}

/** The parsed CODEOWNERS file: the raw rules text + the distinct owners it names. */
export interface GithubCodeownersItem {
  readonly path: string;
  readonly text: string;
  readonly owners: readonly string[];
}

/** The curated GitHub surfaces gathered for one repo. */
export interface GithubCuratedItems {
  readonly discussions: readonly GithubDiscussionItem[];
  readonly releases: readonly GithubReleaseItem[];
  readonly milestones: readonly GithubMilestoneItem[];
  readonly codeowners?: GithubCodeownersItem;
}

/**
 * Shape one raw GraphQL discussion node, or undefined when number-less. Pure.
 *
 * @param node one raw discussion node, of unvalidated shape
 * @returns the item, or undefined without a `number` — the number is the identity, so a node without one
 *   cannot be filed or cited
 */
export function parseDiscussionNode({ node }: { node: unknown }): GithubDiscussionItem | undefined {
  if (!isRecord(node) || typeof node["number"] !== "number") {
    return undefined;
  }
  const category = isRecord(node["category"]) ? str({ value: node["category"]["name"] }) : undefined;
  const author = authorLoginOf({ value: node["author"] });
  return {
    body: strOrEmpty({ value: node["body"] }),
    number: node["number"],
    title: str({ value: node["title"] }) ?? `Discussion #${String(node["number"])}`,
    tsIso: strOrEmpty({ value: node["updatedAt"] }),
    url: strOrEmpty({ value: node["url"] }),
    ...(author !== undefined ? { author } : {}),
    ...(category !== undefined ? { category } : {}),
  };
}

/**
 * Shape one raw REST release, or undefined when tag-less. Pure.
 *
 * @param raw one raw release object, of unvalidated shape
 * @returns the item, or undefined without a tag name — the tag is the identity
 */
export function parseReleaseNode({ raw }: { raw: unknown }): GithubReleaseItem | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const tag = str({ value: raw["tag_name"] });
  if (tag === undefined) {
    return undefined;
  }
  const author = authorLoginOf({ value: raw["author"] });
  return {
    body: strOrEmpty({ value: raw["body"] }),
    name: releaseNameOf({ name: raw["name"], tag }),
    tag,
    tsIso: str({ value: raw["published_at"] }) ?? strOrEmpty({ value: raw["created_at"] }),
    url: strOrEmpty({ value: raw["html_url"] }),
    ...(author !== undefined ? { author } : {}),
  };
}

/**
 * Shape one raw REST milestone (without its issues — the shell attaches those), or undefined. Pure.
 *
 * @param raw one raw milestone object, of unvalidated shape
 * @returns the item minus `issueNumbers`, which the effectful shell attaches after a separate fetch, or
 *   undefined when the milestone cannot be identified
 */
export function parseMilestoneNode({ raw }: { raw: unknown }): Omit<GithubMilestoneItem, "issueNumbers"> | undefined {
  if (!isRecord(raw) || typeof raw["number"] !== "number") {
    return undefined;
  }
  const state = str({ value: raw["state"] });
  return {
    description: strOrEmpty({ value: raw["description"] }),
    number: raw["number"],
    title: str({ value: raw["title"] }) ?? `Milestone ${String(raw["number"])}`,
    tsIso: str({ value: raw["updated_at"] }) ?? strOrEmpty({ value: raw["created_at"] }),
    url: strOrEmpty({ value: raw["html_url"] }),
    ...(state !== undefined ? { state } : {}),
  };
}

/**
 * The `number`s of a raw issue list (the issues grouped under a milestone). Pure.
 *
 * @param raw the raw issue list, of unvalidated shape
 * @returns the issue numbers; an entry with no numeric `number` is dropped rather than counted
 */
export function issueNumbersOf({ raw }: { raw: readonly unknown[] }): readonly number[] {
  return raw
    .map((issue) => (isRecord(issue) && typeof issue["number"] === "number" ? issue["number"] : undefined))
    .filter((n): n is number => n !== undefined);
}

/** One CODEOWNERS owner token → its `github:<team|user>:<id>` node key (an `@`-prefixed handle). Pure. */
function ownerNode({ owner }: { owner: string }): string | undefined {
  if (!owner.startsWith("@") || owner.length < 2) {
    return undefined;
  }
  const handle = owner.slice(1);
  return handle.includes("/") ? `github:team:${handle}` : `github:user:${handle}`;
}

/**
 * Parse CODEOWNERS text into `{text, owners}` — the distinct `@`-owners across every rule. Pure.
 *
 * @param content the whole CODEOWNERS file text, kept verbatim on the item
 * @param path where the file was found, since GitHub accepts several locations
 * @returns the item with owners deduped across every rule — only explicit `@`-prefixed owners, never a
 *   guess from a bare path
 */
export function parseCodeowners({ content, path }: { content: string; path: string }): GithubCodeownersItem {
  const owners = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    for (const token of trimmed.split(/\s+/).slice(1)) {
      if (token.startsWith("@")) {
        owners.add(token);
      }
    }
  }
  return { owners: [...owners], path, text: content };
}

/** Attach a classification attr when the heuristic fires. Pure. */
function classifiedAttrs({
  attrs,
  kind,
  title,
  text,
}: {
  attrs: Record<string, CorpusAttributeValue>;
  kind: CorpusRecord["kind"];
  title: string;
  text: string;
}): Record<string, CorpusAttributeValue> {
  const classification = classifyCurated({ kind, text, title });
  return classification !== undefined ? { ...attrs, [CURATED_CLASS_ATTR]: classification } : attrs;
}

/** One `discussion` record. Pure. */
function discussionRecord({ discussion, repo }: { discussion: GithubDiscussionItem; repo: string }): CorpusRecord {
  const text = discussion.body.length > 0 ? discussion.body : discussion.title;
  return {
    attrs: classifiedAttrs({ attrs: {}, kind: "discussion", text, title: discussion.title }),
    container: repo,
    kind: "discussion",
    refs: extractRefs({ text: `${discussion.title}\n${discussion.body}` }),
    source: "github",
    sourceId: `discussion:#${String(discussion.number)}`,
    text,
    title: discussion.title,
    tsIso: discussion.tsIso,
    url: discussion.url,
    ...(discussion.author !== undefined ? { author: discussion.author } : {}),
  };
}

/** One `release` record (classified `status`). Pure. */
function releaseRecord({ release, repo }: { release: GithubReleaseItem; repo: string }): CorpusRecord {
  const text = release.body.length > 0 ? release.body : release.name;
  return {
    attrs: classifiedAttrs({ attrs: {}, kind: "release", text, title: release.name }),
    container: repo,
    kind: "release",
    refs: extractRefs({ text: `${release.name}\n${release.body}` }),
    source: "github",
    sourceId: `release:${release.tag}`,
    text,
    title: release.name,
    tsIso: release.tsIso,
    url: release.url,
    ...(release.author !== undefined ? { author: release.author } : {}),
  };
}

/** One `milestone` record, with a grouping edge to each grouped issue/PR. Pure. */
function milestoneRecord({ milestone, repo }: { milestone: GithubMilestoneItem; repo: string }): CorpusRecord {
  const edges = milestone.issueNumbers.map((n) =>
    encodeCuratedEdgeRef({ kind: "milestone", target: `github:#${String(n)}` }),
  );
  const base: Record<string, CorpusAttributeValue> = edges.length > 0 ? { [CURATED_EDGES_ATTR]: edges } : {};
  const text = milestone.description.length > 0 ? milestone.description : milestone.title;
  return {
    attrs: classifiedAttrs({ attrs: base, kind: "milestone", text, title: milestone.title }),
    container: repo,
    kind: "milestone",
    refs: extractRefs({ text: `${milestone.title}\n${milestone.description}` }),
    source: "github",
    sourceId: `milestone:${String(milestone.number)}`,
    text,
    title: milestone.title,
    tsIso: milestone.tsIso,
    url: milestone.url,
  };
}

/** One `codeowners` record (classified `ownership`), with an `owns` edge to each named team/user. Pure. */
function codeownersRecord({ codeowners, repo }: { codeowners: GithubCodeownersItem; repo: string }): CorpusRecord {
  const edges = codeowners.owners
    .map((owner) => ownerNode({ owner }))
    .filter((node): node is string => node !== undefined)
    .map((target) => encodeCuratedEdgeRef({ kind: "owns", target }));
  const base: Record<string, CorpusAttributeValue> = edges.length > 0 ? { [CURATED_EDGES_ATTR]: edges } : {};
  return {
    attrs: { ...base, [CURATED_CLASS_ATTR]: "ownership" },
    container: repo,
    kind: "codeowners",
    refs: [],
    source: "github",
    sourceId: `codeowners:${codeowners.path}`,
    text: codeowners.text,
    title: `CODEOWNERS (${codeowners.path})`,
    tsIso: "",
    url: `https://github.com/${repo}/blob/HEAD/${codeowners.path}`,
  };
}

/**
 * Project the curated GitHub surfaces into corpus records (+ their grouping/ownership edges).
 *
 * @param items the gathered curated surfaces
 * @param repo the `owner/repo` container string
 * @returns the flattened corpus records
 */
export function projectGithubCurated({
  items,
  repo,
}: {
  items: GithubCuratedItems;
  repo: string;
}): readonly CorpusRecord[] {
  const records: CorpusRecord[] = [];
  for (const discussion of items.discussions) {
    records.push(discussionRecord({ discussion, repo }));
  }
  for (const release of items.releases) {
    records.push(releaseRecord({ release, repo }));
  }
  for (const milestone of items.milestones) {
    records.push(milestoneRecord({ milestone, repo }));
  }
  if (items.codeowners !== undefined && items.codeowners.text.trim().length > 0) {
    records.push(codeownersRecord({ codeowners: items.codeowners, repo }));
  }
  return records;
}
