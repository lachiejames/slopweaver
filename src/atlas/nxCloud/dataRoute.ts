/**
 * Reading what the first-party web client reads: React Router single-fetch payloads, and the JSON resource
 * routes beside them.
 *
 * ## Two content types, one surface
 *
 * A `<path>.data` request answers `text/x-script` carrying a turbo-stream — the encoding React Router v7
 * uses for its own single fetch, a flat array of chunks with back-references, so a payload can carry cycles
 * and promises rather than a plain object. A resource route answers ordinary `application/json`. Both are
 * the same surface reached the same way; only the decoder differs, which is why that decision lives here
 * and nowhere else.
 *
 * `turbo-stream` is the dependency React Router itself encodes with, so this decodes with the same
 * implementation rather than with a hand-rolled reader of somebody else's wire format. It takes a
 * `ReadableStream`, so the text a transport already read is wrapped back into one — the payloads this atlas
 * asks for are single-digit kilobytes and the streaming half buys nothing here.
 *
 * ## A loader payload is keyed by ROUTE ID, and that is the useful half
 *
 * The decoded value is `{ "routes/_auth.orgs.$orgId": { data: … }, … }` — one block per route that
 * contributed a loader. So a single call carries several routes' worth of data, and which route produced
 * which block is exactly the provenance an atlas owes. {@link loaderBlocks} returns those pairs; a caller
 * asks for the one route it wants rather than guessing at a shape.
 */
import { decode } from "turbo-stream";
import { absentAsNull } from "#lib/absent.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type NxCloudAtlasError, NxCloudAtlasErrors } from "./errors.js";

/**
 * One route's own loader block out of a single-fetch payload.
 *
 * @internal
 */
export interface NxCloudLoaderBlock {
  /** The client's route id, e.g. `routes/_auth.orgs.$orgId.workspaces.$workspaceId`. */
  readonly routeId: string;
  /** What that route's loader returned. */
  readonly data: unknown;
}

/**
 * Decode a `text/x-script` single-fetch payload.
 *
 * @param text the whole response body
 * @param call the call id, so a failure names which surface could not be read
 * @returns the decoded value, or why it could not be read
 */
export async function decodeSingleFetch({
  text,
  call,
}: {
  text: string;
  call: string;
}): Promise<Result<unknown, NxCloudAtlasError>> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  try {
    const decoded = await decode(stream);
    // Deferred values are resolved BEFORE `done` is awaited: `done` settles once the stream is exhausted,
    // and a payload whose promises are still pending at that point resolves to nothing. An unobserved
    // rejection on `done` would also surface as an unhandled rejection rather than as this call's failure.
    const resolved = await resolveDeferred({ depth: 0, value: decoded.value });
    await decoded.done.catch(() => undefined);
    return ok(resolved);
  } catch (cause: unknown) {
    return err(
      NxCloudAtlasErrors.payloadUnreadable({
        call,
        detail: `turbo-stream refused it (${cause instanceof Error ? cause.message : String(cause)})`,
      }),
    );
  }
}

/**
 * How deep {@link resolveDeferred} follows a payload looking for promises.
 *
 * React Router streams a slow loader's result as a DEFERRED value, and turbo-stream hands it back as a
 * promise sitting inside an otherwise ordinary object. MEASURED: the workspace runs loader
 * returns `{ options, deferredRunListPage: Promise<{ runs, hasNext }> }`, so a reader that did not await
 * would see a payload with no runs in it at all and record the family as empty — a confident wrong answer
 * with no witness. Five levels is well past the two the observed payloads use.
 *
 * @internal
 */
export const NX_CLOUD_DEFERRED_DEPTH_CAP = 5;

/**
 * Whether one value is a promise, by the only property that decides it.
 *
 * A type guard rather than an assertion, because the payload is `unknown` by construction — turbo-stream
 * hands back whatever the server encoded — and asserting a narrower type over it would be a claim this code
 * cannot make.
 *
 * Positional by necessity rather than by choice: TypeScript's TS1230 forbids a type predicate over a
 * destructured parameter, which is the compiler's own decision and the exemption `named-object-params`
 * computes rather than a rule being dodged.
 *
 * @param value the node to test
 * @returns `true` when the value is thenable
 */
function isThenable(value: object): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown }).then === "function";
}

/**
 * Await every deferred value in a decoded payload, so what a caller walks is what the client renders.
 *
 * A rejected deferred becomes `null` rather than throwing: the loader that produced it failed, which is a
 * fact about one field, and letting it reject would lose every other field in the same payload.
 *
 * @param value the decoded payload, or any node inside it
 * @param depth how far down this node already is
 * @returns the same shape with its promises resolved
 */
export async function resolveDeferred({ value, depth }: { value: unknown; depth: number }): Promise<unknown> {
  if (depth > NX_CLOUD_DEFERRED_DEPTH_CAP || value === null || typeof value !== "object") {
    return value;
  }
  if (isThenable(value)) {
    const settled = await Promise.resolve(value).catch(() => null);
    return resolveDeferred({ depth: depth + 1, value: settled });
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry: unknown) => resolveDeferred({ depth: depth + 1, value: entry })));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = await resolveDeferred({ depth: depth + 1, value: entry });
  }
  return out;
}

/**
 * The per-route blocks a decoded single-fetch payload carries.
 *
 * A block whose value is not an object, or which carries no `data` key, is dropped rather than guessed at:
 * React Router also uses this envelope for errors and redirects, and reading one of those as a loader
 * result is how a 403 becomes a confident empty record.
 *
 * @param value the decoded payload
 * @returns one entry per route that contributed loader data, in payload order
 */
export function loaderBlocks({ value }: { value: unknown }): readonly NxCloudLoaderBlock[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([routeId, block]): readonly NxCloudLoaderBlock[] => {
    if (!isRecord(block) || !("data" in block)) {
      return [];
    }
    return [{ data: block["data"], routeId }];
  });
}

/**
 * One route's loader data out of a payload.
 *
 * @param value the decoded payload
 * @param routeId the client route id to read
 * @returns that route's data, or `null` when the payload carries no such block
 */
export function loaderData({ value, routeId }: { value: unknown; routeId: string }): unknown {
  return absentAsNull({ value: loaderBlocks({ value }).find((block) => block.routeId === routeId)?.data });
}

/**
 * Decode an `application/json` resource-route body.
 *
 * @param text the whole response body
 * @param call the call id, so a failure names which surface could not be read
 * @returns the parsed value, or why it could not be read
 */
export function decodeResourceJson({ text, call }: { text: string; call: string }): Result<unknown, NxCloudAtlasError> {
  try {
    return ok(JSON.parse(text));
  } catch (cause: unknown) {
    return err(
      NxCloudAtlasErrors.payloadUnreadable({
        call,
        detail: `not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`,
      }),
    );
  }
}
