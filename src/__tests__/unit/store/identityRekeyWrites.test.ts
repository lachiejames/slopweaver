/**
 * `textArray` renders a list as ONE `array[...]::text[]` with a bound parameter per element — never the
 * tuple the `sql` template makes of a bare JS array, which Postgres refuses to cast (`cannot cast type
 * record to text[]`). `PgDialect` is drizzle's own pure renderer and reaches no database.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { StoreWriter } from "../../../store/client.js";
import type { PersonDraft } from "../../../store/identity/people.js";
import { rekeyTemporaryEmail } from "../../../store/identity/rekey.js";
import { planRekeys, textArray } from "../../../store/identity/rekeyWrites.js";

const dialect = new PgDialect();

/** A writer that fails the test the moment anything touches it — a seam, not a mock: it records nothing. */
const untouchableWriter = new Proxy(
  {},
  {
    get: (): never => {
      throw new Error("planRekeys reached the database");
    },
  },
) as StoreWriter;

/** A member-only draft: no google id, so no rename can be planned for it. */
const memberDraft = ({ email }: { email: string }): PersonDraft => ({
  active: true,
  displayName: "Member",
  email,
  familyName: null,
  githubId: null,
  githubLogin: null,
  givenName: null,
  googleId: null,
  linearDisplayName: null,
  linearUserId: null,
  notionUserId: null,
  orgUnitPath: null,
  slackUserId: "U0SYNMEMB0001",
  title: null,
});

describe("planRekeys with no google id among the drafts", () => {
  it("still refuses a draft in the reserved scratch namespace, without reading the store", async () => {
    const email = rekeyTemporaryEmail({ googleId: "100000000000000000001" });
    const plan = await planRekeys({ people: [memberDraft({ email })], writer: untouchableWriter });
    expect(plan.rekeys).toEqual([]);
    expect(plan.collisions.map((collision) => collision.value)).toEqual([email]);
  });

  it("plans nothing for ordinary member drafts, without reading the store", async () => {
    const plan = await planRekeys({
      people: [memberDraft({ email: "member@example.invalid" })],
      writer: untouchableWriter,
    });
    expect(plan).toEqual({ collisions: [], rekeys: [] });
  });
});

describe("textArray", () => {
  it("binds one parameter per element inside a text array cast", () => {
    const query = dialect.sqlToQuery(textArray({ values: ["ada@acme.test", "grace@acme.test"] }));
    expect(query.sql).toBe("array[$1, $2]::text[]");
    expect(query.params).toEqual(["ada@acme.test", "grace@acme.test"]);
  });

  it("renders an empty list as an empty array with no parameters", () => {
    const query = dialect.sqlToQuery(textArray({ values: [] }));
    expect(query.sql).toBe("array[]::text[]");
    expect(query.params).toEqual([]);
  });
});
