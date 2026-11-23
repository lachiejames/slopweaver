/**
 * The read-back SHAPERS of the Linear write API — one per object kind, each turning a raw GraphQL read-back into
 * the typed object `./write.ts`'s `LinearWriteApi` hands back, or `undefined` when Linear has no such id.
 *
 * Split out of `./write.ts` under the file-size cap. The types they shape stay there, beside the interface that
 * returns them.
 */
import { isRecord } from "../../lib/parsers.js";
import type { ReadComment, ReadIssue, ReadMilestone, ReadProject, ReadProjectUpdate, ReadRelation } from "./write.js";
import { relationFrom, str } from "./writeGraphql.js";

/**
 * Shape a read-back. A MISSING issue is `undefined` rather than an error: "this id does not exist" is a real,
 * useful answer to a reconciliation question, and collapsing it into a failure would make a caller unable to
 * distinguish "not created" from "could not ask".
 *
 * @param data the raw GraphQL data
 * @returns the issue, or undefined when Linear has no such id
 */
export function readIssueFrom({ data }: { data: unknown }): ReadIssue | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const node = data["issue"];
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const identifier = str({ key: "identifier", node });
  const url = str({ key: "url", node });
  const updatedAt = str({ key: "updatedAt", node });
  const title = str({ key: "title", node });
  if (
    id === undefined ||
    identifier === undefined ||
    url === undefined ||
    updatedAt === undefined ||
    title === undefined
  ) {
    // A partial issue is not a smaller issue, it is an unreadable one. Filling the gaps with empty strings
    // here is how a caller ends up comparing its rendered body against "" and deciding nothing changed.
    return undefined;
  }
  const raw = node["description"];
  return {
    description: typeof raw === "string" ? raw : undefined,
    id,
    identifier,
    title,
    updatedAt,
    url,
  };
}

/**
 * Shape a project read-back. A MISSING project is `undefined` rather than an error, same reading as
 * `readIssueFrom`.
 *
 * @param data the raw GraphQL data
 * @returns the project, or undefined when Linear has no such id
 */
export function readProjectFrom({ data }: { data: unknown }): ReadProject | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const node = data["project"];
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const name = str({ key: "name", node });
  const url = str({ key: "url", node });
  const slugId = str({ key: "slugId", node });
  const updatedAt = str({ key: "updatedAt", node });
  if (id === undefined || name === undefined || url === undefined || slugId === undefined || updatedAt === undefined) {
    return undefined;
  }
  const rawDescription = node["description"];
  const rawTargetDate = node["targetDate"];
  return {
    description: typeof rawDescription === "string" ? rawDescription : undefined,
    id,
    name,
    slugId,
    targetDate: typeof rawTargetDate === "string" ? rawTargetDate : undefined,
    updatedAt,
    url,
  };
}

/**
 * Shape a milestone read-back. A MISSING milestone is `undefined` rather than an error, same reading as
 * `readIssueFrom`.
 *
 * Everything the milestone document itself carries, which is everything but `projectUrl`: the SDK fragment
 * selects `project { id }`, so the reference resolves to an id here and the url is a caller's follow-up.
 * Requiring a url the document never selects is exactly how this read silently answered `undefined` for
 * every milestone that existed — measured live, reproducible with
 * `yarn tsx .cache/linear-probe/probe-milestone-live.ts`.
 *
 * @param data the raw GraphQL data
 * @returns the milestone without its project url, or undefined when Linear has no such id
 */
export function readMilestoneFrom({ data }: { data: unknown }): Omit<ReadMilestone, "projectUrl"> | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const node = data["projectMilestone"];
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const name = str({ key: "name", node });
  const updatedAt = str({ key: "updatedAt", node });
  const projectNode = node["project"];
  const projectId = isRecord(projectNode) ? str({ key: "id", node: projectNode }) : undefined;
  if (id === undefined || name === undefined || updatedAt === undefined || projectId === undefined) {
    return undefined;
  }
  const rawDescription = node["description"];
  const rawTargetDate = node["targetDate"];
  return {
    description: typeof rawDescription === "string" ? rawDescription : undefined,
    id,
    name,
    projectId,
    targetDate: typeof rawTargetDate === "string" ? rawTargetDate : undefined,
    updatedAt,
  };
}

/**
 * Shape a project-update read-back.
 *
 * @param data the query response body
 * @returns the project update, or undefined when the id does not exist or the node is malformed
 */
export function readProjectUpdateFrom({ data }: { data: unknown }): ReadProjectUpdate | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const node = data["projectUpdate"];
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const url = str({ key: "url", node });
  const health = str({ key: "health", node });
  const updatedAt = str({ key: "updatedAt", node });
  if (id === undefined || url === undefined || health === undefined || updatedAt === undefined) {
    return undefined;
  }
  const raw = node["body"];
  return { body: typeof raw === "string" ? raw : undefined, health, id, updatedAt, url };
}

/**
 * Shape a comment read-back. A MISSING comment is `undefined` rather than an error, same reading as
 * {@link readIssueFrom}.
 *
 * `body` follows the same `string | undefined` distinction `ReadIssue.description` does, and for the same
 * reason: `""` means Linear stored an empty comment, `undefined` means it returned none at all, and
 * collapsing them would let a failed read look like a comment with nothing in it.
 *
 * @param data the raw GraphQL data
 * @returns the comment, or undefined when Linear has no such id
 */
export function readCommentFrom({ data }: { data: unknown }): ReadComment | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const node = data["comment"];
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const url = str({ key: "url", node });
  const updatedAt = str({ key: "updatedAt", node });
  if (id === undefined || url === undefined || updatedAt === undefined) {
    return undefined;
  }
  const raw = node["body"];
  return { body: typeof raw === "string" ? raw : undefined, id, updatedAt, url };
}

/**
 * Shape a relation read-back. A MISSING relation is `undefined` rather than an error, same reading as
 * {@link readIssueFrom}.
 *
 * @param data the raw GraphQL data
 * @returns the relation, or undefined when Linear has no such id
 */
export function readRelationFrom({ data }: { data: unknown }): ReadRelation | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const node = data["issueRelation"];
  return isRecord(node) ? relationFrom({ node }) : undefined;
}
