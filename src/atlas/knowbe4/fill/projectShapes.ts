/**
 * The shapes every KnowBe4 projector shares — what a projected row and page look like, the helpers more than one
 * projector needs, and the registry of every detail a projector built, which the publish checks against. The
 * projectors themselves, and the allowlist each one is, live in `project.ts`.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { BoundaryError } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";

/** One row a path answered, reduced to what the atlas keeps. */
export interface Knowbe4ProjectedItem {
  /** KnowBe4's own id, or `<parent>:<child>` for a per-parent edge. */
  readonly providerId: string;
  /** The allowlisted fields, never the wire row. */
  readonly detail: Readonly<Record<string, unknown>>;
}

/** One page of one path, projected. */
export interface Knowbe4ProjectedPage {
  readonly items: readonly Knowbe4ProjectedItem[];
  /** How many rows the page held on the wire — what tells the runner a short page ended the list. */
  readonly rowCount: number;
}

/** Why a page could not be projected: the boundary's drift, or a per-parent page read with no parent. */
export type Knowbe4ProjectError =
  | BoundaryError
  | { readonly code: "PARENT_MISSING"; readonly message: string }
  | { readonly code: "OWNER_MISSING"; readonly message: string };

/**
 * Freeze a value and everything under it, so nothing can be added to a projected detail after it was built.
 *
 * @param value the detail, or any value nested in one; a primitive is left as it is
 * @internal
 */
export function deepFreeze({ value }: { value: unknown }): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const child of Object.values(value)) {
    deepFreeze({ value: child });
  }
  Object.freeze(value);
}

/**
 * Every detail object a projector in `project.ts` built. `sync.ts` publishes no other, so a hand-built
 * observation carrying a field nobody allowlisted is refused at the publish rather than written (
 * KnowBe4 atlas review). Module-private on purpose: only {@link projected} adds to it.
 */
const PROJECTED_DETAILS = new WeakSet<object>();

/**
 * Record a detail as a projector's own, frozen deep, and hand it back. Frozen because membership is by identity:
 * a recorded object mutated afterwards would carry an added field past the publish check.
 *
 * @param detail the allowlisted fields a projector just copied into a fresh object
 * @returns the same object, now frozen and recorded
 */
export function projected({
  detail,
}: {
  detail: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  deepFreeze({ value: detail });
  PROJECTED_DETAILS.add(detail);
  return detail;
}

/**
 * Whether the projector for `template` built this detail object — the publish boundary's check. Identity alone
 * is not enough: a detail one projector built, filed under another path, would carry the first path's fields into
 * the second kind, so the detail's own frozen `family` must name the path it is published under.
 *
 * @param detail an item's detail, as an observation carries it
 * @param template the path the observation files it under
 * @returns `true` only for the very object that path's projector returned
 */
export function isProjectedDetail({
  detail,
  template,
}: {
  detail: Readonly<Record<string, unknown>>;
  template: string;
}): boolean {
  return PROJECTED_DETAILS.has(detail) && detail["family"] === template;
}

/**
 * The groups a campaign or test targets, in KnowBe4's order, each with the name KnowBe4 gives it there. The name
 * is kept because a target need not be a row of `/v1/groups`: KnowBe4's own example target is
 * `{ group_id: 0, name: "All Users" }`, and an id alone would leave that target unnameable.
 *
 * @param groups the row's `groups` array, which its boundary requires, so a row leaving it out never reads as
 *   targeting nobody
 * @returns each target's id as a string, and its name or `null`
 */
export function targetGroups({
  groups,
}: {
  groups: readonly { group_id: number; name?: string | null | undefined }[];
}): readonly { groupId: string; name: string | null }[] {
  return groups.map((group) => ({
    groupId: String(group.group_id),
    name: unsetFieldAsNull({ key: "name", record: group }),
  }));
}

/**
 * A training campaign's content, each item reduced to what it is and which purchase or policy it names.
 *
 * @param content the campaign's `content` array, which KnowBe4 may leave out or send as null
 * @returns one entry per item, or none when the campaign lists no content
 */
export function campaignContent({
  content,
}: {
  content:
    | readonly {
        content_type?: string | null | undefined;
        name?: string | null | undefined;
        policy_id?: number | null | undefined;
        store_purchase_id?: number | null | undefined;
      }[]
    | null
    | undefined;
}): readonly Readonly<Record<string, string | null>>[] {
  if (content == null) {
    return [];
  }
  return content.map((item) => ({
    contentType: unsetFieldAsNull({ key: "content_type", record: item }),
    name: unsetFieldAsNull({ key: "name", record: item }),
    policyId: item.policy_id == null ? null : String(item.policy_id),
    storePurchaseId: item.store_purchase_id == null ? null : String(item.store_purchase_id),
  }));
}

/**
 * The words a projector's refusal may publish. A strict boundary names every field KnowBe4 sent that it does not
 * declare, and that name is KnowBe4's choice: it can be data (`ssn_123_45_6789`) or a token spelled across two
 * keys, and it would land in a coverage cell and a log line. So an undeclared or renamed field is
 * COUNTED, never named; a missing or retyped field is one this repository declared, so it is named.
 *
 * @param error the projector's refusal
 * @returns the refusal's message with no field name KnowBe4 chose
 */
export function publishableWords({ error }: { error: Knowbe4ProjectError }): string {
  if (error.code !== "BOUNDARY_SHAPE_CHANGED") {
    return error.message;
  }
  const declared = error.drift.filter((entry) => entry.kind === "missing" || entry.kind === "changed");
  const undeclared = error.drift.length - declared.length;
  const words = [
    ...declared.map((entry) => entry.detail),
    ...(undeclared === 0
      ? []
      : [`${String(undeclared)} undeclared field(s), named nowhere since KnowBe4 chose the names`]),
  ];
  return `${error.endpoint} answered a shape this version does not read — refused, not guessed: ${words.join("; ")}`;
}

/**
 * Refuse a per-parent page projected without its parent — a runner defect, never a provider answer.
 *
 * @param path the per-parent path template being projected
 * @returns the `PARENT_MISSING` refusal
 */
export function parentMissing({ path }: { path: string }): Result<never, Knowbe4ProjectError> {
  return err({
    code: "PARENT_MISSING",
    message: `${path} was projected without the parent id its call was made under`,
  });
}

/**
 * Refuse a page holding a per-person row — an enrolment, a phishing recipient — that names neither a user id nor
 * an email: the nag's claim is "this person has not completed this", and a row that cannot say who is nothing
 * anyone can act on. The boundary cannot carry this check — a custom Zod check may rewrite the
 * payload — so it runs after the read.
 *
 * @param rows the page's rows, as the boundary read them
 * @param path the list they came from, for the refusal
 * @param rowId the row's own KnowBe4 id, for the refusal
 * @returns the same rows, or `OWNER_MISSING` naming the first one without an owner
 */
export function rowsOwned<
  T extends { readonly user: { readonly email?: string | null | undefined; readonly id?: number | null | undefined } },
>({
  rows,
  path,
  rowId,
}: {
  rows: readonly T[];
  path: string;
  rowId: (row: T) => number;
}): Result<readonly T[], Knowbe4ProjectError> {
  const unowned = rows.find(({ user }) => user.id == null && (user.email == null || user.email.trim().length === 0));
  if (unowned === undefined) {
    return ok(rows);
  }
  return err({
    code: "OWNER_MISSING",
    message: `${path} row ${String(rowId(unowned))} names neither a user id nor an email`,
  });
}
