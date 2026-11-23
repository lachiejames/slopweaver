import { describe, expect, it } from "vitest";

import { ACCESS_LEVEL_TABLE, ROSTER_SPINE } from "../../../accessReview/levels.js";
import { CONSOLE_ROLE_LABEL, privilegedTableOf } from "../../../accessReview/privileged.js";
import { type Roster, rosterOf } from "../../../accessReview/roster.js";
import { accessRowsOf } from "../../../accessReview/rows.js";

import { entity, personDetail } from "./fixtures.js";

const JUMPCLOUD = ACCESS_LEVEL_TABLE.find((spec) => spec.platform === "jumpcloud")!;

/** JumpCloud rows built from one person detail each. */
function jumpcloudRows({
  people,
}: {
  people: readonly { readonly email: string; readonly role: string | null; readonly state?: string }[];
}): ReturnType<typeof accessRowsOf> {
  return accessRowsOf({
    entities: people.map(({ email, role, state = "ACTIVATED" }, index) =>
      entity({
        detail: {
          displayname: "A Person",
          email,
          state,
          ...(role === null ? {} : { admin: { roleName: role } }),
        },
        providerId: `v1-systemusers-get:${String(index)}`,
      }),
    ),
    spec: JUMPCLOUD,
  });
}

/** A roster from one spell per entry. */
function rosterFrom({
  spells,
}: {
  spells: readonly { readonly email: string; readonly status: string; readonly endDate: string | null }[];
}): Roster {
  return rosterOf({
    entities: spells.map((spell, index) =>
      entity({
        detail: personDetail({ display: "A Person", email: spell.email, endDate: spell.endDate, status: spell.status }),
        providerId: `person:${String(index)}`,
      }),
    ),
    spec: ROSTER_SPINE,
  });
}

describe("privilegedTableOf", () => {
  it("takes only the rows naming a console role", () => {
    const table = privilegedTableOf({
      readStampIso: "2026-09-06T00:00:00.000Z",
      roster: rosterFrom({ spells: [{ email: "admin@x.test", endDate: null, status: "CURRENT" }] }),
      rows: jumpcloudRows({
        people: [
          { email: "admin@x.test", role: "administrator" },
          { email: "plain@x.test", role: null },
        ],
      }),
    });
    expect(table.rows.map((row) => row.email)).toEqual(["admin@x.test"]);
    expect(table.rows[0]!.role).toBe("administrator");
    expect(table.rowsExamined).toBe(2);
  });

  it("carries the subject so an empty table cannot read as no administrators", () => {
    const table = privilegedTableOf({
      readStampIso: null,
      roster: rosterFrom({ spells: [] }),
      rows: jumpcloudRows({ people: [{ email: "plain@x.test", role: null }] }),
    });
    expect(table.rows).toEqual([]);
    expect(table.platform).toBe("jumpcloud");
    expect(table.kind).toBe("systemusers");
    expect(table.readStampIso).toBe(null);
    expect(table.rowsExamined).toBe(1);
  });

  it("drops the role from the other levels it carries", () => {
    const table = privilegedTableOf({
      readStampIso: "2026-09-06T00:00:00.000Z",
      roster: rosterFrom({ spells: [{ email: "admin@x.test", endDate: null, status: "CURRENT" }] }),
      rows: jumpcloudRows({ people: [{ email: "admin@x.test", role: "administrator" }] }),
    });
    expect(table.rows[0]!.levels.filter((level) => level.label === CONSOLE_ROLE_LABEL)).toEqual([]);
    expect(table.rows[0]!.levels.find((level) => level.label === "state")!.value).toBe("ACTIVATED");
  });

  it("reports an administrator the roster holds no person for as having no statuses", () => {
    const table = privilegedTableOf({
      readStampIso: "2026-09-06T00:00:00.000Z",
      roster: rosterFrom({ spells: [] }),
      rows: jumpcloudRows({ people: [{ email: "stranger@x.test", role: "administrator" }] }),
    });
    expect(table.rows[0]!.employmentStatuses).toEqual([]);
    expect(table.rows[0]!.stillEmployed).toBe(null);
    expect(table.rows[0]!.employmentEndIso).toBe(null);
  });

  it("carries a departed administrator's status and end date", () => {
    const table = privilegedTableOf({
      readStampIso: "2026-09-06T00:00:00.000Z",
      roster: rosterFrom({
        spells: [{ email: "admin@x.test", endDate: "2026-09-11T00:00:00.000Z", status: "FORMER" }],
      }),
      rows: jumpcloudRows({ people: [{ email: "admin@x.test", role: "administrator" }] }),
    });
    expect(table.rows[0]!.employmentStatuses).toEqual(["FORMER"]);
    expect(table.rows[0]!.stillEmployed).toBe(false);
    expect(table.rows[0]!.employmentEndIso).toBe("2026-09-11T00:00:00.000Z");
  });

  it("carries both statuses for a rehired administrator", () => {
    const table = privilegedTableOf({
      readStampIso: "2026-09-06T00:00:00.000Z",
      roster: rosterFrom({
        spells: [
          { email: "admin@x.test", endDate: "2026-04-28T00:00:00.000Z", status: "FORMER" },
          { email: "admin@x.test", endDate: null, status: "CURRENT" },
        ],
      }),
      rows: jumpcloudRows({ people: [{ email: "admin@x.test", role: "administrator" }] }),
    });
    expect(table.rows[0]!.employmentStatuses).toEqual(["FORMER", "CURRENT"]);
    expect(table.rows[0]!.stillEmployed).toBe(true);
    expect(table.rows[0]!.employmentEndIso).toBe("2026-04-28T00:00:00.000Z");
  });

  it("orders by role then address, so two runs diff", () => {
    const table = privilegedTableOf({
      readStampIso: "2026-09-06T00:00:00.000Z",
      roster: rosterFrom({ spells: [] }),
      rows: jumpcloudRows({
        people: [
          { email: "zoe@x.test", role: "manager" },
          { email: "amy@x.test", role: "manager" },
          { email: "bob@x.test", role: "administrator" },
        ],
      }),
    });
    expect(table.rows.map((row) => `${row.role}/${row.email}`)).toEqual([
      "administrator/bob@x.test",
      "manager/amy@x.test",
      "manager/zoe@x.test",
    ]);
  });

  it("keeps the address verbatim, which is what an auditor searches for", () => {
    const table = privilegedTableOf({
      readStampIso: "2026-09-06T00:00:00.000Z",
      roster: rosterFrom({ spells: [] }),
      rows: jumpcloudRows({ people: [{ email: "Admin@X.test", role: "administrator" }] }),
    });
    expect(table.rows[0]!.email).toBe("Admin@X.test");
  });
});
