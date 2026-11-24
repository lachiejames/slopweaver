/**
 * The flags of the approval-gated `github repo` writes that act on a repository's lifecycle, settings and Actions —
 * `--create [--public]`, `--set-public`, `--apply-manifest <path>` and `--enable-actions` — read apart from
 * `./repoCore.ts` so the one parser stays one screen. Pure: no credential, no network.
 */

/** The approval-gated `github repo` writes `./repoApprovedWrite.ts` runs. */
export type GithubRepoApprovedKind = "create" | "set-public" | "apply-manifest" | "enable-actions" | "push-fresh-cut";

/** The boolean flags these writes add to the verb's flag spec. */
export const GITHUB_REPO_APPROVED_WRITE_FLAGS: readonly string[] = ["create", "public", "set-public", "enable-actions"];

/** The string flags these writes add to the verb's flag spec. */
export const GITHUB_REPO_APPROVED_WRITE_STRING_FLAGS: readonly string[] = ["apply-manifest", "push-fresh-cut"];

/** Every write flag, in the order a usage problem names them. */
export const GITHUB_REPO_WRITE_FLAG_LIST =
  "--description, --rename-to, --transfer-to, --archive, --create, --set-public, --apply-manifest, --enable-actions " +
  "or --push-fresh-cut";

/** A fresh-cut record id, as `fresh-cut produce` prints it: a lower-case UUID. */
const FRESH_CUT_RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One resolved create, visibility change, settings apply or Actions policy, previewed unless `approve` carries the digest. */
export interface GithubRepoApprovedArgs {
  readonly owner: string;
  readonly repo: string;
  readonly write: GithubRepoApprovedKind;
  /** Only a create reads it: true makes the new repository public, false (the default) private. */
  readonly public: boolean;
  /** Only a settings apply reads it: the apply artifact's path. */
  readonly manifestPath: string | undefined;
  /** Only a fresh-cut push reads it: the cut's record id. */
  readonly freshCutRecordId: string | undefined;
  readonly approve: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Read every approved write the flags name, refusing `--public` anywhere but on a create.
 *
 * @param values the parsed flag values
 * @param errors the list a problem is appended to
 * @returns every approved write named, so the caller can refuse more than one write
 */
export function approvedWritesOf({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean | undefined>>;
  errors: string[];
}): GithubRepoApprovedKind[] {
  const writes: GithubRepoApprovedKind[] = [];
  if (values["create"] === true) {
    writes.push("create");
  }
  if (values["set-public"] === true) {
    writes.push("set-public");
  }
  const manifestPath = values["apply-manifest"];
  if (typeof manifestPath === "string") {
    if (manifestPath.trim() === "") {
      errors.push("--apply-manifest takes the apply artifact's path");
    } else {
      writes.push("apply-manifest");
    }
  }
  if (values["enable-actions"] === true) {
    writes.push("enable-actions");
  }
  if (freshCutPushNamed({ errors, values })) {
    writes.push("push-fresh-cut");
  }
  if (values["public"] === true && values["create"] !== true) {
    errors.push("--public only qualifies --create; --set-public makes an existing repository public");
  }
  return writes;
}

/**
 * Whether `--push-fresh-cut` names a write, appending the refusal when its value is not a record id.
 *
 * @param values the parsed flag values
 * @param errors the list a malformed record id is appended to
 * @returns true when the flag carries a well-formed record id
 */
function freshCutPushNamed({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean | undefined>>;
  errors: string[];
}): boolean {
  const recordId = values["push-fresh-cut"];
  if (typeof recordId !== "string") {
    return false;
  }
  if (!FRESH_CUT_RECORD_ID.test(recordId)) {
    errors.push("--push-fresh-cut takes the cut's record id, the UUID fresh-cut produce printed");
    return false;
  }
  return true;
}
