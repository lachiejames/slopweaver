/**
 * The Google Workspace directory, read whole — every user Google Admin lists, values included.
 *
 * ## Why this is not the atlas fill
 *
 * `slopweaver atlas google-admin fill` reaches the same `directory.users.list` and keeps only each record's
 * KEY NAMES: an atlas describes a surface, and its `withheldValues: true` is a deliberate literal. The
 * person table needs the values — the address, the name, the suspended flag — so this is a second, narrow
 * reader through the same grant and the same official SDK (`@googleapis/admin`, `docs/provider-sdks.md`),
 * bound to the one capability it needs (`directory-users`) rather than to whatever the grant happens to
 * carry.
 *
 * ## Whole, not bounded
 *
 * The atlas stops at ten pages and says so, because an atlas mirrors nothing. A roster that stopped early
 * would silently leave people unkeyed, so this follows `nextPageToken` to the end; MEASURED: the
 * directory is about a thousand users, spanning multiple pages at Google's 500 maximum. `showDeleted` is left off on purpose — a
 * deleted account has no mailbox to key on, and its people survive through the member pull instead.
 */
import { admin, type admin_directory_v1 } from "@googleapis/admin";
import type { OAuth2Client } from "googleapis-common";

import { projectDirectoryUser } from "../../corpus/directory/project.js";
import type { DirectoryUserRow } from "../../corpus/directory/types.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";

/** Google's own ceiling for one `users.list` page. */
const PAGE_SIZE = 500;

/** What one whole-directory read brought back. */
export interface DirectoryPull {
  readonly rows: readonly DirectoryUserRow[];
  /** Users Google returned that could not be keyed, each with why. */
  readonly skipped: readonly string[];
  readonly pages: number;
}

/**
 * The next page token as the paging loop's own exit test reads it.
 *
 * The SDK types the field `string | null | undefined` while the loop stops on `undefined` alone, so the
 * two absent spellings are collapsed here, once, rather than at the call site — a `null` last page read as
 * a token would page forever.
 *
 * @param token whatever the response carried
 * @returns the token, or `undefined` when there is no next page
 */
function nextPage({ token }: { token: string | null | undefined }): string | undefined {
  if (token === null || token === undefined) {
    return undefined;
  }
  return token;
}

/**
 * Builds the Admin Directory client this reader pages through — the SDK's own `admin` constructor in
 * production — narrowed to the one call it makes.
 *
 * @internal — the seam {@link pullDirectoryUsers} constructs its client through; named by its test.
 */
export type DirectoryUsersFactory = (options: { auth: OAuth2Client; version: "directory_v1" }) => {
  readonly users: {
    list: (
      params: admin_directory_v1.Params$Resource$Users$List,
    ) => Promise<{ readonly data: admin_directory_v1.Schema$Users }>;
  };
};

/**
 * Read every user the directory lists, through the bound grant.
 *
 * @param client the OAuth client from a resolved grant
 * @param account the bound account, hashed into the shared rate scope and never stored
 * @param fetchedAtIso when this pull is running, stamped on every row
 * @param createDirectory constructs the directory client from that grant; the SDK's own constructor unless a
 *   test supplies its own
 * @returns the projected rows, or the first refusal any page met, as one message
 */
export async function pullDirectoryUsers({
  client,
  account,
  fetchedAtIso,
  createDirectory = admin,
}: {
  client: OAuth2Client;
  account: string;
  fetchedAtIso: string;
  createDirectory?: DirectoryUsersFactory;
}): Promise<Result<DirectoryPull>> {
  const directory = createDirectory({ auth: client, version: "directory_v1" });
  const scopeId = scopeIdForToken({ token: account });
  const rows: DirectoryUserRow[] = [];
  const skipped: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params: admin_directory_v1.Params$Resource$Users$List = {
      customer: "my_customer",
      maxResults: PAGE_SIZE,
      orderBy: "email",
      projection: "full",
      ...(pageToken === undefined ? {} : { pageToken }),
    };
    const answered = await safeProviderCall({
      execute: () => directory.users.list(params),
      operation: "google-admin.directory.users.list",
      provider: "google-admin",
      retryMode: "transient",
      scopeId,
    });
    if (answered.isErr()) {
      return err([answered.error.message]);
    }
    pages += 1;
    // Google omits `users` entirely on an empty page rather than sending one, so the absent case is the
    // same as no users and is named here.
    const { users = [] } = answered.value.data;
    for (const user of users) {
      const projected = projectDirectoryUser({ fetchedAtIso, user });
      if ("row" in projected) {
        rows.push(projected.row);
      } else {
        skipped.push(projected.skipped);
      }
    }
    pageToken = nextPage({ token: answered.value.data.nextPageToken });
  } while (pageToken !== undefined);
  return ok({ pages, rows, skipped });
}
