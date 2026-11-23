/**
 * Turn what the JumpCloud administrator console asked for into atlas rows — the OPERATION it called and the
 * field NAMES that came back, never a value.
 *
 * ## This file is the redaction, and it is committed so a reviewer can read it rather than trust it
 *
 * A signed-in administrator console sees every user, device and credential policy in the organisation. The
 * console channel records what the client ASKS FOR, never what the organisation holds, so the reduction is a
 * thing a reviewer reads once here. The census walk is `kit/responseShape.ts`, shared with the other walked
 * atlases; what is JumpCloud's own is here.
 *
 * ## The denial boundary runs BEFORE the census, not after it
 *
 * The API channel's `sensitiveFields.ts` names the fields this atlas never stores — a TOTP secret, an agent
 * enrolment key, a password-policy hash. The console's own calls return the same documents, so a body is
 * projected through `projectJumpcloudValue` first and only the projected document's field names are walked.
 * The endpoint is deliberately NOT supplied: a console path shape is not the bound provider path the
 * endpoint-scoped denials are written against, and `sensitiveFields.ts` makes an unknown endpoint match every
 * entry — so the console is held to the strictest reading of the boundary rather than a guessed one. What
 * leaves this module is a count of what the boundary removed, never which fields they were.
 *
 * ## First party is the whole `jumpcloud.com` tree
 *
 * The console calls its own `/api/…` routes on `console.jumpcloud.com` and reaches other JumpCloud hosts for
 * insights and SaaS management. The test is the registrable domain, written as a SUFFIX test so
 * `notjumpcloud.com` and `jumpcloud.com.evil.test` are both rejected — a sloppy `includes` would admit a
 * third party's telemetry into a first-party surface map.
 *
 * ## The operation is `<METHOD> <host><path shape>`
 *
 * JumpCloud's routes carry their meaning in the path (`/api/systemusers`, `/api/v2/usergroups/{id}/members`),
 * so the path shape is the identity and every value segment in it — a 24-hex object id, a uuid, a digit run,
 * an opaque token — becomes a placeholder.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

import { projectJumpcloudValue } from "./projection.js";

/**
 * The registrable domain every first-party JumpCloud host sits under.
 *
 * @internal
 */
export const JUMPCLOUD_DOMAIN = "jumpcloud.com";

/** A JumpCloud object id: 24 hex characters, the Mongo ObjectId every v1 and v2 resource is keyed by. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** A uuid, dashed or bare. */
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A bare run of digits — a numeric id, an epoch, or a page offset. */
const DIGITS_ONLY = /^[0-9]+$/;

/** A long segment of token alphabet. The length floor keeps ordinary route names out of it. */
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{24,}$/;

/** An email address, which a user-scoped route can carry as a path segment. */
const EMAIL = /^[^@/\s]+@[^@/\s]+$/;

/**
 * JumpCloud's own value-segment shapes, handed to the kit's redaction pass.
 *
 * @returns the placeholder to substitute, or `null` for a segment that is a real path name
 * @internal
 */
export const JUMPCLOUD_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (OBJECT_ID.test(segment) || UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{id}" };
  }
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{n}" };
  }
  if (EMAIL.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{email}" };
  }
  // A route name JumpCloud writes is lower-case words joined by `_` or `-`; a token mixes case or digits.
  if (OPAQUE_TOKEN.test(segment) && /[A-Z0-9]/.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "{token}" };
  }
  return null;
};

/**
 * How deep into a response body the field census walks before it stops.
 * @internal
 */
export const JUMPCLOUD_PATH_DEPTH = 2;

/**
 * The most field names one observation keeps.
 * @internal
 */
export const JUMPCLOUD_PATH_CAP = 200;

/** One call the administrator console made, reduced to what may be stored. */
export interface JumpcloudObservedCall {
  readonly method: string;
  readonly host: string;
  /** The path with every value segment replaced, e.g. `/api/v2/usergroups/{id}/members`. */
  readonly pathShape: string;
  readonly statusCode: number;
  /** Every field name observed in the PROJECTED response body, sorted. Names only, never a value. */
  readonly responseFields: readonly string[];
  /** How many fields the denial boundary removed before the census ran. A count, never the names. */
  readonly deniedFieldCount: number;
}

/** A URL, or `null` when it cannot be read. */
function parseUrl({ url }: { url: string }): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether a captured response went to JumpCloud itself, rather than to the telemetry a page also sends.
 *
 * @param url the response's URL
 * @returns whether the host is `jumpcloud.com` or a subdomain of it
 *
 * @internal
 */
export function isFirstPartyJumpcloudCall({ url }: { url: string }): boolean {
  const parsed = parseUrl({ url });
  if (parsed === null) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return host === JUMPCLOUD_DOMAIN || host.endsWith(`.${JUMPCLOUD_DOMAIN}`);
}

/**
 * The path shape of a JumpCloud URL, with every value segment redacted.
 *
 * @param url the response's URL
 * @returns the redacted path shape, or `null` when the URL cannot be read
 *
 * @internal
 */
export function jumpcloudPathShape({ url }: { url: string }): string | null {
  const parsed = parseUrl({ url });
  if (parsed === null) {
    return null;
  }
  const shaped = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const placeholder = JUMPCLOUD_SEGMENTS({ segment });
      return placeholder === null ? segment : placeholder.placeholder;
    });
  return `/${shaped.join("/")}`;
}

/**
 * The provider key one observed operation is stored under.
 *
 * @param call the reduced call
 * @returns `<METHOD> <host><path shape>`
 */
export function jumpcloudCallKey({ call }: { call: JumpcloudObservedCall }): string {
  return `${call.method.toUpperCase()} ${call.host}${call.pathShape}`;
}

/**
 * Reduce one page's captured responses to the rows the atlas may store.
 *
 * @param responses everything the page's own client asked for while it rendered
 * @returns one row per first-party call, ordered by host then path so a published file is stable
 */
export function reduceJumpcloudCalls({
  responses,
}: {
  responses: readonly CapturedResponse[];
}): readonly JumpcloudObservedCall[] {
  const rows = responses.flatMap((response): readonly JumpcloudObservedCall[] => {
    if (!isFirstPartyJumpcloudCall({ url: response.url })) {
      return [];
    }
    const parsed = parseUrl({ url: response.url });
    const pathShape = jumpcloudPathShape({ url: response.url });
    if (parsed === null || pathShape === null) {
      return [];
    }
    const projected = projectJumpcloudValue({ endpoint: undefined, value: response.body });
    return [
      {
        deniedFieldCount: projected.dropped.length,
        host: parsed.hostname.toLowerCase(),
        method: response.method.toUpperCase(),
        pathShape,
        responseFields: [
          ...responseFieldPaths({
            body: projected.value,
            classify: JUMPCLOUD_SEGMENTS,
            depthCap: JUMPCLOUD_PATH_DEPTH,
          }),
        ]
          .toSorted()
          .slice(0, JUMPCLOUD_PATH_CAP),
        statusCode: response.statusCode,
      },
    ];
  });
  return rows.toSorted((left, right) =>
    `${left.host}${left.pathShape}`.localeCompare(`${right.host}${right.pathShape}`),
  );
}
