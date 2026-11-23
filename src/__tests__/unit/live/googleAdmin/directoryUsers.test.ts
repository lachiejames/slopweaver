/**
 * The whole-directory reader, driven through its client-construction seam — a plain fake standing in for
 * the Admin SDK — so paging, the request shape, projection and the first-refusal exit are pinned with no
 * network.
 */
import type { admin_directory_v1 } from "@googleapis/admin";
import { OAuth2Client } from "googleapis-common";
import { describe, expect, it } from "vitest";

import { projectDirectoryUser } from "../../../../corpus/directory/project.js";
import type { DirectoryUserRow } from "../../../../corpus/directory/types.js";
import { toIngestError } from "../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type DirectoryUsersFactory, pullDirectoryUsers } from "../../../../live/googleAdmin/directoryUsers.js";

const CLIENT = new OAuth2Client({ clientId: "client-1", clientSecret: "secret-1" });
const FETCHED_AT = "2026-10-13T06:00:00.000Z";

/** One page answer, or a throw standing in for the provider refusing that page. */
type PageAnswer = { readonly data: admin_directory_v1.Schema$Users } | { readonly throws: unknown };

/**
 * A fake directory factory answering one scripted page per call, recording the construction options and
 * every request's params in order.
 */
const scriptedDirectory = ({ pages }: { pages: readonly PageAnswer[] }) => {
  const constructed: { auth: OAuth2Client; version: string }[] = [];
  const requests: admin_directory_v1.Params$Resource$Users$List[] = [];
  const createDirectory: DirectoryUsersFactory = (options) => {
    constructed.push(options);
    return {
      users: {
        list: async (params) => {
          requests.push(params);
          const answer = pages[requests.length - 1];
          if (answer === undefined) {
            throw new Error(`no page scripted for request ${String(requests.length)}`);
          }
          if ("throws" in answer) {
            throw answer.throws;
          }
          return answer;
        },
      },
    };
  };
  return { constructed, createDirectory, requests };
};

/** The row the shared projector makes of one user, throwing when it would skip it. */
const projectedRow = ({ user }: { user: admin_directory_v1.Schema$User }): DirectoryUserRow => {
  const projected = projectDirectoryUser({ fetchedAtIso: FETCHED_AT, user });
  if (!("row" in projected)) {
    throw new Error(`expected a row, got a skip: ${projected.skipped}`);
  }
  return projected.row;
};

const ADA: admin_directory_v1.Schema$User = {
  id: "g-1",
  name: { fullName: "Ada L" },
  primaryEmail: "ada@example.test",
};
const BEN: admin_directory_v1.Schema$User = { id: "g-2", primaryEmail: "ben@example.test" };
const CY: admin_directory_v1.Schema$User = { id: "g-3", primaryEmail: "cy@example.test", suspended: true };
const NO_EMAIL: admin_directory_v1.Schema$User = { id: "g-4" };

describe("pullDirectoryUsers", () => {
  it("follows the page token to a null terminator, every request carrying the full whole-directory shape", async () => {
    const directory = scriptedDirectory({
      pages: [
        { data: { nextPageToken: "page-2", users: [ADA, BEN] } },
        { data: { nextPageToken: null, users: [CY, NO_EMAIL] } },
      ],
    });

    const pull = unwrap(
      await pullDirectoryUsers({
        account: "admin@example.test",
        client: CLIENT,
        createDirectory: directory.createDirectory,
        fetchedAtIso: FETCHED_AT,
      }),
    );

    expect(directory.constructed).toEqual([{ auth: CLIENT, version: "directory_v1" }]);
    expect(directory.requests).toEqual([
      { customer: "my_customer", maxResults: 500, orderBy: "email", projection: "full" },
      { customer: "my_customer", maxResults: 500, orderBy: "email", pageToken: "page-2", projection: "full" },
    ]);
    expect(pull.pages).toBe(2);
    expect(pull.rows.map((row) => row.googleId)).toEqual(["g-1", "g-2", "g-3"]);
    expect(pull.rows).toEqual([ADA, BEN, CY].map((user) => projectedRow({ user })));
    expect(pull.skipped).toEqual(["user g-4 has no primaryEmail"]);
  });

  it("reads a page that omits users and carries no token as one empty, successful page", async () => {
    const directory = scriptedDirectory({ pages: [{ data: {} }] });

    const pull = unwrap(
      await pullDirectoryUsers({
        account: "admin@example.test",
        client: CLIENT,
        createDirectory: directory.createDirectory,
        fetchedAtIso: FETCHED_AT,
      }),
    );

    expect(pull).toEqual({ pages: 1, rows: [], skipped: [] });
    expect(directory.requests).toHaveLength(1);
  });

  it("returns a second page's refusal as its one message and makes no third request", async () => {
    const refusal = Object.assign(new Error("Not Authorized to access this resource/api"), { status: 403 });
    const directory = scriptedDirectory({
      pages: [{ data: { nextPageToken: "page-2", users: [ADA] } }, { throws: refusal }, { data: { users: [BEN] } }],
    });

    const result = await pullDirectoryUsers({
      account: "admin@example.test",
      client: CLIENT,
      createDirectory: directory.createDirectory,
      fetchedAtIso: FETCHED_AT,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["Not Authorized to access this resource/api"]);
    expect(unwrapErr(result)).toEqual([
      toIngestError({ error: refusal, operation: "google-admin.directory.users.list", provider: "google-admin" })
        .message,
    ]);
    expect(directory.requests).toHaveLength(2);
  });
});
