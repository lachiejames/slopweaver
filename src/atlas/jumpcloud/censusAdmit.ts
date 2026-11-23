/**
 * The page admitter the structural census (`tools/jumpcloudResponseCensus.ts`) walks the live tenant with, and
 * nothing else does.
 *
 * The census exists to re-measure a tenant whose answers have DRIFTED from the generated boundaries. Walked through
 * the production admitter, the first drifted page refuses, so the walk never reaches that surface's later pages nor
 * any fan-out keyed on its ids — and the census comes back short exactly where it was needed. Measured:
 * `v1-systems-list` refused on `mdm.enrollmentStatus`, the sync held 0 systems records, and every per-system
 * fan-out was unreachable. So this admitter reads each surface in the carrier its boundary DECLARES and checks no
 * field. A changed carrier still refuses, because a census that re-guessed the carrier would declare the wrong one.
 *
 * Production never passes this: every dependency builder wires `admitJumpcloudPage`, and admitting a field no
 * boundary declares is the drift a boundary exists to refuse.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type JumpcloudReadError, JumpcloudReadErrors } from "./errors.js";
import { JUMPCLOUD_FILE_RESPONSES } from "./fileResponses.js";
import { headerTotal, type JumpcloudPage, type JumpcloudPageShape } from "./paging.js";
import { admitJumpcloudPage, JUMPCLOUD_RESPONSE_REGISTRY } from "./responseRegistry.js";

/** Whether a parsed body is a plain object, so the reader narrows rather than asserts. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Admit one answered page for the census: a file surface exactly as production does, every other surface in its
 * declared carrier with no field checked.
 *
 * @param surface the registry surface that answered
 * @param text the 2xx body exactly as the provider sent it
 * @param headers the response headers, lowercased
 * @returns the page's records, carrier and total; `BODY_NOT_JSON` for a body that does not parse; `UNEXPECTED_SHAPE`
 *   for a surface no boundary declares, or an answer in a carrier other than the declared one
 */
export function admitJumpcloudCensusPage({
  surface,
  text,
  headers,
}: {
  surface: string;
  text: string;
  headers: Readonly<Record<string, string>>;
}): Result<JumpcloudPage, JumpcloudReadError> {
  if (JUMPCLOUD_FILE_RESPONSES[surface] !== undefined) {
    return admitJumpcloudPage({ headers, surface, text });
  }
  const boundary = JUMPCLOUD_RESPONSE_REGISTRY.get(surface);
  if (boundary === undefined) {
    return err(
      JumpcloudReadErrors.unexpectedShape({
        detail: "no response boundary is declared for this surface, so the census has no carrier to read it in",
        surface,
      }),
    );
  }
  const fromHeader = headerTotal({ headers });
  if (text.trim().length === 0) {
    return ok({ records: [], shape: "empty", totalCount: fromHeader });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err(JumpcloudReadErrors.bodyNotJson({ length: text.length, surface }));
  }
  return readDeclaredCarrier({ carrier: boundary.carrier, fromHeader, surface, value });
}

/** The drift a surface reports when it answers in a carrier other than the one its boundary declares. */
function carrierChanged({
  carrier,
  found,
  surface,
}: {
  carrier: JumpcloudPageShape;
  found: string;
  surface: string;
}): Result<JumpcloudPage, JumpcloudReadError> {
  return err(
    JumpcloudReadErrors.unexpectedShape({
      detail: `the surface declares a ${carrier} carrier and answered ${found}`,
      surface,
    }),
  );
}

/** Read a parsed, non-empty body in the carrier its surface declares, checking no field inside it. */
function readDeclaredCarrier({
  carrier,
  fromHeader,
  surface,
  value,
}: {
  carrier: JumpcloudPageShape;
  fromHeader: number | null;
  surface: string;
  value: unknown;
}): Result<JumpcloudPage, JumpcloudReadError> {
  switch (carrier) {
    case "empty":
      return carrierChanged({ carrier, found: "a body", surface });
    case "bare-array":
      return Array.isArray(value)
        ? ok({ records: value, shape: "bare-array", totalCount: fromHeader })
        : carrierChanged({ carrier, found: "no array", surface });
    case "wrapped-results": {
      if (!isRecord(value) || !Array.isArray(value["results"])) {
        return carrierChanged({ carrier, found: "no results array", surface });
      }
      const declared = value["totalCount"];
      return ok({
        records: value["results"],
        shape: "wrapped-results",
        totalCount: typeof declared === "number" ? declared : fromHeader,
      });
    }
    case "single-object":
      return isRecord(value)
        ? ok({ records: [value], shape: "single-object", totalCount: fromHeader })
        : carrierChanged({ carrier, found: "no object", surface });
    default: {
      const unhandled: never = carrier;
      return carrierChanged({ carrier, found: String(unhandled), surface });
    }
  }
}
