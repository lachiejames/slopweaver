/**
 * Reading one field of a Trelica record through the allowlist — a string, a number, or the organisation's
 * own people named against an application. Pure; `projection.ts` is the only caller.
 */
import { isRecord } from "../../lib/parsers.js";

import type { TrelicaAppDetail } from "./model.js";

/**
 * Read a string field, treating an empty one as absent so `""` never reaches a `min(1)` schema.
 *
 * @returns the trimmed string, or `null` when it is absent, empty or not a string
 */
export function textOf({ record, key }: { record: Record<string, unknown>; key: string }): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Read a finite number field, treating anything else as absent.
 *
 * @returns the number, or `null` when it is absent or not finite
 */
export function numberOf({ record, key }: { record: Record<string, unknown>; key: string }): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The organisation's own people recorded against an application, through the allowlist.
 *
 * MEASURED on `POST /AppsApi/CustomerApp/FilterItems`: each entry nests the person under
 * `contact` beside the role fields — `{ contact: { name, email }, roleId, isOwner, terminated }` — on every
 * application that carried one. Reading `name` off the entry itself had silently dropped every one.
 *
 * @param record one inventory record
 * @returns each named person with their role, owner flag and termination, sorted by name
 */
export function trelicaContactsOf({
  record,
}: {
  record: Record<string, unknown>;
}): TrelicaAppDetail["internalContacts"] {
  const raw = record["internalContacts"];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .flatMap((entry: unknown) => {
      if (!isRecord(entry) || !isRecord(entry["contact"])) {
        return [];
      }
      const person = entry["contact"];
      const name = textOf({ key: "name", record: person });
      if (name === null) {
        return [];
      }
      return [
        {
          email: textOf({ key: "email", record: person }),
          isOwner: entry["isOwner"] === true,
          name,
          role: textOf({ key: "roleId", record: entry }),
          terminated: entry["terminated"] === true,
        },
      ];
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}
