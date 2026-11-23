/**
 * The GitHub org lane's pure row projection: the org, one repo and one team (with its membership and repo
 * permission relations) from raw SDK payloads into durable {@link StructureBronzeRow}s. No network and no clock;
 * the walk that fetches these payloads is `org.ts`.
 */
import { isRecord } from "../../lib/parsers.js";
import { optStr as ghStr } from "../slack/shape.js";
import type { AttrValue, StructureBronzeRow, StructureRelation } from "../structures/types.js";

/** Compose an org attrs entry only when the value is present (drops undefined). Pure. */
function optAttr({ key, value }: { key: string; value: AttrValue | undefined }): Readonly<Record<string, AttrValue>> {
  return value !== undefined ? { [key]: value } : {};
}

/**
 * Project the org object (`orgs.get`) into an `org` structure row. Pure — undefined without a login.
 *
 * @param raw the raw `orgs.get` payload, of unvalidated shape
 * @param fetchedAtIso when the fetch happened, recorded on the row rather than read from a clock here
 * @returns the row, or undefined when there is no `login` — the login IS the identity, so a row without
 *   one cannot be filed
 */
export function projectOrgRow({
  raw,
  fetchedAtIso,
}: {
  raw: unknown;
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  const login = isRecord(raw) ? ghStr({ value: raw["login"] }) : undefined;
  if (!isRecord(raw) || login === undefined) {
    return undefined;
  }
  const name = ghStr({ value: raw["name"] });
  const url = ghStr({ value: raw["html_url"] });
  return {
    attrs: {
      ...optAttr({
        key: "publicRepos",
        value: typeof raw["public_repos"] === "number" ? raw["public_repos"] : undefined,
      }),
    },
    fetchedAtIso,
    identity: { nativeId: login, ...(name !== undefined ? { name } : {}), ...(url !== undefined ? { url } : {}) },
    kind: "org",
    provenance: ["github.orgs.get"],
    raw,
    relations: [],
    source: "github",
    sourceId: login,
    version: 1,
    warnings: [],
  };
}

/**
 * Project one repo object (`repos.listForOrg`) into a `repo` structure row. Pure — undefined without full_name.
 *
 * @param raw one raw repo object, of unvalidated shape
 * @param fetchedAtIso when the fetch happened
 * @returns the row, or undefined without a `full_name` — the owner-qualified name is the identity
 */
export function projectRepoRow({
  raw,
  fetchedAtIso,
}: {
  raw: unknown;
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  const fullName = isRecord(raw) ? ghStr({ value: raw["full_name"] }) : undefined;
  if (!isRecord(raw) || fullName === undefined) {
    return undefined;
  }
  const name = ghStr({ value: raw["name"] });
  const url = ghStr({ value: raw["html_url"] });
  const language = ghStr({ value: raw["language"] });
  const defaultBranch = ghStr({ value: raw["default_branch"] });
  const visibility = ghStr({ value: raw["visibility"] });
  return {
    attrs: {
      archived: raw["archived"] === true,
      fork: raw["fork"] === true,
      private: raw["private"] === true,
      ...(language !== undefined ? { language } : {}),
      ...(defaultBranch !== undefined ? { defaultBranch } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
    },
    fetchedAtIso,
    identity: {
      nativeId: fullName,
      slug: fullName,
      ...(name !== undefined ? { name } : {}),
      ...(url !== undefined ? { url } : {}),
    },
    kind: "repo",
    provenance: ["github.orgs.listRepos"],
    raw,
    relations: [],
    source: "github",
    sourceId: fullName,
    version: 1,
    warnings: [],
  };
}

/** The `member` relations off a team's member logins (each points at a `github:<login>` person). Pure. */
function teamMemberRelations({ members }: { members: readonly unknown[] }): readonly StructureRelation[] {
  return members
    .map((member) => (isRecord(member) ? ghStr({ value: member["login"] }) : undefined))
    .filter((login): login is string => login !== undefined)
    .map((login) => ({ targetId: `github:${login}`, targetKind: "person", targetSource: "person", type: "member" }));
}

/** The `permission` relations off a team's repos (each carries the access level). Pure. */
function teamRepoRelations({ repos }: { repos: readonly unknown[] }): readonly StructureRelation[] {
  const relations: StructureRelation[] = [];
  for (const repo of repos) {
    const fullName = isRecord(repo) ? ghStr({ value: repo["full_name"] }) : undefined;
    if (fullName === undefined) {
      continue;
    }
    const permission = isRecord(repo) ? ghStr({ value: repo["permission"] }) : undefined;
    relations.push({
      targetId: fullName,
      targetKind: "repo",
      targetSource: "github",
      type: "permission",
      ...(permission !== undefined ? { attrs: { permission } } : {}),
    });
  }
  return relations;
}

/**
 * Project one team (+ its members + repo permissions) into a `team` structure row. Pure — undefined without a slug.
 *
 * @param raw one raw team object, of unvalidated shape
 * @param members the team's already-fetched members, becoming membership relations
 * @param repos the team's already-fetched repo permissions, becoming permission relations
 * @param fetchedAtIso when the fetch happened
 * @returns the row, or undefined without a `slug` — the slug is the stable identity, not the display name
 */
export function projectTeamRow({
  raw,
  members,
  repos,
  fetchedAtIso,
}: {
  raw: unknown;
  members: readonly unknown[];
  repos: readonly unknown[];
  fetchedAtIso: string;
}): StructureBronzeRow | undefined {
  const slug = isRecord(raw) ? ghStr({ value: raw["slug"] }) : undefined;
  if (!isRecord(raw) || slug === undefined) {
    return undefined;
  }
  const name = ghStr({ value: raw["name"] });
  const url = ghStr({ value: raw["html_url"] });
  const description = ghStr({ value: raw["description"] });
  const privacy = ghStr({ value: raw["privacy"] });
  return {
    attrs: {
      ...(description !== undefined ? { description } : {}),
      ...(privacy !== undefined ? { privacy } : {}),
    },
    fetchedAtIso,
    identity: {
      nativeId: slug,
      slug,
      ...(name !== undefined ? { name } : {}),
      ...(url !== undefined ? { url } : {}),
    },
    kind: "team",
    provenance: ["github.teams.list"],
    raw,
    relations: [...teamMemberRelations({ members }), ...teamRepoRelations({ repos })],
    source: "github",
    sourceId: slug,
    version: 1,
    warnings: [],
  };
}
