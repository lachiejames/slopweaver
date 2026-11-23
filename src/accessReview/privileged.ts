/**
 * The privileged-access table — every console administrator on a platform that names one, against employment.
 *
 * This is the ISO A.8.2 evidence pack, and it is the WHOLE table rather than an extract: an auditor asking
 * "who holds privileged access" is owed every row, and a report that showed the interesting ones would be
 * answering a different question.
 *
 * ## An empty table is a refusal, never an answer
 *
 * The one failure this file exists to prevent is printing zero rows and letting that read as "no privileged
 * accounts". A platform whose people kind has never been read successfully, or whose declared surface family
 * has been renamed out from under the projection, produces exactly the same empty list as a tenancy with no
 * administrators. So {@link privilegedTableOf} reports the SUBJECT it examined — the platform, the kind, its
 * read stamp and how many rows it looked at — and the renderer refuses to print a bare zero without them.
 *
 * ## Employment comes from the spine, and a missing row is said out loud
 *
 * An administrator the roster has no person for is reported as `no roster row`, not as current. That is the
 * unjoinable case `join.ts` names, and on this table it is the sharpest version of it.
 */
import type { AccessLevelValue } from "./levels.js";
import type { Roster } from "./roster.js";
import type { AccessPlatformRows, AccessRow } from "./rows.js";

/** The level label that carries a console role, when a platform names one. */
export const CONSOLE_ROLE_LABEL = "console role";

/** One administrator. */
export interface PrivilegedRow {
  readonly email: string;
  readonly display: string | null;
  /** The platform's own role name, verbatim. */
  readonly role: string;
  /** Every other level the platform carries for them, verbatim. */
  readonly levels: readonly AccessLevelValue[];
  /** Every employment status the roster holds for this address, verbatim; empty when it holds no person. */
  readonly employmentStatuses: readonly string[];
  /** Whether any employment spell on this address is live; `null` when the roster holds no person for it. */
  readonly stillEmployed: boolean | null;
  /** The roster's employment end date, or `null` when there is none. */
  readonly employmentEndIso: string | null;
}

/** The table, and the subject it was computed over. */
export interface PrivilegedTable {
  readonly platform: string;
  readonly kind: string;
  /** That kind's last successful read, or `null` when it has never had one. */
  readonly readStampIso: string | null;
  /** How many rows of the right family the projection examined, so a zero is readable. */
  readonly rowsExamined: number;
  readonly rows: readonly PrivilegedRow[];
}

/** Role first, then address — a stable order an auditor can diff between two runs. */
function byRoleThenEmail({ left, right }: { left: PrivilegedRow; right: PrivilegedRow }): number {
  const byRole = left.role.localeCompare(right.role);
  if (byRole !== 0) {
    return byRole;
  }
  return left.email.localeCompare(right.email);
}

/** The role one row names, or `null` when it names none. */
function roleOf({ row }: { row: AccessRow }): string | null {
  const found = row.levels.find((level) => level.label === CONSOLE_ROLE_LABEL);
  if (found === undefined) {
    return null;
  }
  return found.value;
}

/**
 * Every administrator one platform declares, joined against the roster.
 *
 * @param rows the platform's projected rows
 * @param roster the spine, for employment
 * @param readStampIso that kind's last successful read
 * @returns the table, carrying the subject it was computed over so an empty one is readable
 */
export function privilegedTableOf({
  rows,
  roster,
  readStampIso,
}: {
  rows: AccessPlatformRows;
  roster: Roster;
  readStampIso: string | null;
}): PrivilegedTable {
  const byAddress = new Map(roster.people.map((person) => [person.email, person]));
  const privileged = rows.rows.flatMap((row): readonly PrivilegedRow[] => {
    const role = roleOf({ row });
    if (role === null) {
      return [];
    }
    const person = byAddress.get(row.email);
    return [
      {
        display: row.display,
        email: row.emailVerbatim,
        employmentEndIso: person === undefined ? null : person.endDateIso,
        employmentStatuses: person === undefined ? [] : person.statuses,
        levels: row.levels.filter((level) => level.label !== CONSOLE_ROLE_LABEL),
        role,
        stillEmployed: person === undefined ? null : person.stillEmployed,
      },
    ];
  });
  return {
    kind: rows.kind,
    platform: rows.platform,
    readStampIso,
    rows: privileged.toSorted((left, right) => byRoleThenEmail({ left, right })),
    rowsExamined: rows.rows.length,
  };
}
