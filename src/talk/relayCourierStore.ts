/**
 * The hand-off from a relay cmux refused to the pinned chair's courier — the one process inside cmux that can type a
 * relay a console started outside it could not.
 *
 * ## Why a courier
 *
 * MEASURED: when main moved, `scripts/docs-site.sh --refresh` restarted the console from a
 * process outside cmux, and the new server held no `CMUX_SOCKET_CAPABILITY`. Every voice relay after it
 * was answered `Access denied - only processes started inside cmux can connect` (repro:
 * `slopweaver talk log --json | jq -r '.rows[] | "\(.registeredAtIso) \(.delivery.detail)"'`), and the voice told the owner
 * twice it had passed them on. The token is a credential, never persisted or forwarded
 * (`docs/cmux-client/socket-and-measured-facts.md` § 1), and switching cmux off `cmuxOnly` widens who can drive the owner's
 * terminals — the owner's decision, not a fix. A process cmux started already holds the access, so the relay is handed to
 * one: `slopweaver talk courier`, which the pinned chair runs as a background task (`../cli/commands/talk/courierRun.ts`).
 *
 * ## The protocol: one winner at every step, at most one paste
 *
 * - The relay writes `pending/<turnId>.json` with `wx` — only after cmux's access refusal, which is typed at the
 *   socket boundary and comes before any delivery claim, so nothing was typed and the turn's `.delivery` claim is
 *   still free. A turn whose request already sits in `claimed/` is not re-offered: the relay waits on that courier.
 * - A courier takes it by `rename` into `claimed/`: of two couriers, or a follower and a sweep's `--once`, exactly one
 *   rename succeeds and the other is told `ENOENT`.
 * - The relay waits a bounded while; still pending, it `unlink`s the request. `ENOENT` means a courier renamed it
 *   first, and the relay waits for that courier's delivery on the turn. Success means no courier took THIS request —
 *   not that none holds the turn, since a retry can queue a duplicate beside one a courier took — so before it records
 *   `courier-unavailable` the relay takes the turn's `.delivery` claim itself, and on losing it waits instead.
 * - The courier takes the same `.delivery` claim (`./relayDeliveryClaim.ts`) before it types, so a turn is typed at
 *   most once whichever process types it, and is never recorded `failed` by a relay while a courier holds it.
 *
 * A request names a turn id and nothing else: no words, no line, no path, no command. The courier rebuilds the line
 * from the turn record itself, so a forged request can at most re-offer a registered turn its delivery claim already
 * guards.
 */
import { readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { createFileExclusive, ensureDirectory } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

/** A turn id the courier will name a file after: a relay's own UUID shape, so no id can climb out of the directory. */
const TURN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** What a courier request holds — a turn id and when it was asked, nothing the courier types. */
const requestSchema = z
  .object({
    kind: z.literal("relay"),
    requestedAtIso: z.iso.datetime(),
    turnId: z.string().regex(TURN_ID),
    version: z.literal(1),
  })
  .strict();

/** One hand-off, as `pending/<turnId>.json` holds it. */
export type RelayCourierRequest = z.infer<typeof requestSchema>;

/** A courier file could not be written, renamed, removed or listed. */
interface CourierStoreFailedError {
  readonly code: "COURIER_STORE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A request file is not a request, or names a different turn from its own filename. */
interface CourierRequestMalformedError {
  readonly code: "COURIER_REQUEST_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** A turn id that is not a relay's UUID, refused before any path is built from it. */
interface CourierTurnIdInvalidError {
  readonly code: "COURIER_TURN_ID_INVALID";
  readonly message: string;
}

/** A held turn a batch line reached the chat with could not be read or written, so its request is left standing. */
interface CourierTurnUnwritableError {
  readonly code: "COURIER_TURN_UNWRITABLE";
  readonly message: string;
  readonly turnId: string;
}

/** Every way the courier hand-off can fail. */
export type RelayCourierError =
  CourierStoreFailedError | CourierRequestMalformedError | CourierTurnIdInvalidError | CourierTurnUnwritableError;

/** Builds each {@link RelayCourierError}. */
export const RelayCourierErrors = {
  turnUnwritable: ({ turnId, why }: { turnId: string; why: string }): CourierTurnUnwritableError => ({
    code: "COURIER_TURN_UNWRITABLE",
    message: `held turn ${turnId} could not record the batch that carried it: ${why}`,
    turnId,
  }),
  malformed: ({ path, why }: { path: string; why: string }): CourierRequestMalformedError => ({
    code: "COURIER_REQUEST_MALFORMED",
    message: `${path} is not a courier request: ${why}`,
    path,
  }),
  storeFailed: ({ cause, path }: { cause: unknown; path: string }): CourierStoreFailedError => ({
    code: "COURIER_STORE_FAILED",
    message: `courier store ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  turnIdInvalid: ({ turnId }: { turnId: string }): CourierTurnIdInvalidError => ({
    code: "COURIER_TURN_ID_INVALID",
    message: `"${turnId.slice(0, 80)}" is not a relay turn id`,
  }),
} as const;

/** Where a request stands. */
type Stage = "pending" | "claimed";

/** The node error code a filesystem call threw, or `undefined`. */
function errnoOf({ cause }: { cause: unknown }): string | undefined {
  if (typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return undefined;
}

/** One stage's directory. */
function stageDirectory({ home, stage }: { home: string; stage: Stage }): string {
  return join(stateHomePaths({ home }).talkCourier, stage);
}

/** One request's path at one stage, once its turn id is known to be safe to name a file after. */
function requestPath({
  home,
  stage,
  turnId,
}: {
  home: string;
  stage: Stage;
  turnId: string;
}): Result<string, RelayCourierError> {
  if (!TURN_ID.test(turnId)) {
    return err(RelayCourierErrors.turnIdInvalid({ turnId }));
  }
  return ok(join(stageDirectory({ home, stage }), `${turnId}.json`));
}

/**
 * Hand a turn to the chair's courier. A request already pending for the same turn is the same hand-off, never a
 * second one, and a request a courier already took is never re-offered: that courier may still be about to type it,
 * so a second request no courier takes must not let the relay record the turn undeliverable underneath it.
 *
 * @param home the state home
 * @param turnId the registered turn cmux refused to let this process type
 * @param nowIso when it was handed over
 * @returns `queued`, `already` when this turn's request was pending before, or `claimed` when a courier holds it
 */
export function enqueueCourier({
  home,
  turnId,
  nowIso,
}: {
  home: string;
  turnId: string;
  nowIso: string;
}): Result<"queued" | "already" | "claimed", RelayCourierError> {
  const path = requestPath({ home, stage: "pending", turnId });
  if (path.isErr()) {
    return err(path.error);
  }
  const held = requestStanding({ home, stage: "claimed", turnId });
  if (held.isErr()) {
    return err(held.error);
  }
  if (held.value) {
    return ok("claimed");
  }
  const request: RelayCourierRequest = { kind: "relay", requestedAtIso: nowIso, turnId, version: 1 };
  try {
    ensureDirectory({ directory: stageDirectory({ home, stage: "pending" }) });
    createFileExclusive({
      contents: `${safeJsonStringify({ label: "courier request", value: request })}\n`,
      path: path.value,
    });
    return ok("queued");
  } catch (cause) {
    if (errnoOf({ cause }) !== "EEXIST") {
      return err(RelayCourierErrors.storeFailed({ cause, path: path.value }));
    }
  }
  const standing = readRequest({ path: path.value, turnId });
  if (standing.isErr()) {
    return err(standing.error);
  }
  return ok("already");
}

/**
 * Take a request back that no courier took. The `unlink` is the race's judge: it succeeds only while the request is
 * still pending, and a courier's rename that won leaves nothing to remove.
 *
 * @param home the state home
 * @param turnId the turn handed over
 * @returns `withdrawn` when no courier had it, `taken` when one renamed it first
 */
export function withdrawCourier({
  home,
  turnId,
}: {
  home: string;
  turnId: string;
}): Result<"withdrawn" | "taken", RelayCourierError> {
  const path = requestPath({ home, stage: "pending", turnId });
  if (path.isErr()) {
    return err(path.error);
  }
  try {
    unlinkSync(path.value);
    return ok("withdrawn");
  } catch (cause) {
    if (errnoOf({ cause }) === "ENOENT") {
      return ok("taken");
    }
    return err(RelayCourierErrors.storeFailed({ cause, path: path.value }));
  }
}

/**
 * Whether a turn's request is still waiting for a courier.
 *
 * @param home the state home
 * @param turnId the turn handed over
 * @returns true while `pending/<turnId>.json` is there
 */
export function courierPending({ home, turnId }: { home: string; turnId: string }): Result<boolean, RelayCourierError> {
  return requestStanding({ home, stage: "pending", turnId });
}

/**
 * A pending request's contents, refused unless it parses as a request for exactly the turn its name says.
 *
 * @param home the state home
 * @param turnId the turn whose pending request is read
 * @returns the request, or why it is unreadable or malformed
 */
export function pendingRequest({
  home,
  turnId,
}: {
  home: string;
  turnId: string;
}): Result<RelayCourierRequest, RelayCourierError> {
  const path = requestPath({ home, stage: "pending", turnId });
  if (path.isErr()) {
    return err(path.error);
  }
  return readRequest({ path: path.value, turnId });
}

/** Whether a turn's request file stands at one stage. */
function requestStanding({
  home,
  stage,
  turnId,
}: {
  home: string;
  stage: Stage;
  turnId: string;
}): Result<boolean, RelayCourierError> {
  const path = requestPath({ home, stage, turnId });
  if (path.isErr()) {
    return err(path.error);
  }
  try {
    readFileSync(path.value);
    return ok(true);
  } catch (cause) {
    if (errnoOf({ cause }) === "ENOENT") {
      return ok(false);
    }
    return err(RelayCourierErrors.storeFailed({ cause, path: path.value }));
  }
}

/**
 * The turns waiting at one stage, oldest name first. A file that is not `<uuid>.json` is no request and is left alone.
 *
 * @param home the state home
 * @param stage `pending` for the courier's queue, `claimed` for what a courier took and has not finished
 * @returns the turn ids, or an empty list when the stage was never written
 */
export function courierTurns({ home, stage }: { home: string; stage: Stage }): Result<string[], RelayCourierError> {
  const directory = stageDirectory({ home, stage });
  try {
    return ok(
      readdirSync(directory)
        .filter((name) => name.endsWith(".json") && TURN_ID.test(name.slice(0, -".json".length)))
        .map((name) => name.slice(0, -".json".length))
        .toSorted(),
    );
  } catch (cause) {
    if (errnoOf({ cause }) === "ENOENT") {
      return ok([]);
    }
    return err(RelayCourierErrors.storeFailed({ cause, path: directory }));
  }
}

/**
 * Take one pending request. Of every courier racing for it exactly one rename succeeds; the rest are told `gone`.
 *
 * @param home the state home
 * @param turnId the turn to take
 * @returns the request now in `claimed/`, or `gone` when another courier or a withdrawing relay got there first
 */
export function takeCourier({
  home,
  turnId,
}: {
  home: string;
  turnId: string;
}): Result<
  { readonly kind: "taken"; readonly request: RelayCourierRequest } | { readonly kind: "gone" },
  RelayCourierError
> {
  const from = requestPath({ home, stage: "pending", turnId });
  const to = requestPath({ home, stage: "claimed", turnId });
  if (from.isErr()) {
    return err(from.error);
  }
  if (to.isErr()) {
    return err(to.error);
  }
  try {
    ensureDirectory({ directory: stageDirectory({ home, stage: "claimed" }) });
    renameSync(from.value, to.value);
  } catch (cause) {
    if (errnoOf({ cause }) === "ENOENT") {
      return ok({ kind: "gone" });
    }
    return err(RelayCourierErrors.storeFailed({ cause, path: from.value }));
  }
  const request = readRequest({ path: to.value, turnId });
  if (request.isErr()) {
    return err(request.error);
  }
  return ok({ kind: "taken", request: request.value });
}

/**
 * Put a claimed request back in the queue — only for a courier that died before the turn's delivery claim, when no
 * line can have been typed. The caller proves that; this only moves the file.
 *
 * @param home the state home
 * @param turnId the turn a dead courier took
 * @returns nothing; a claimed request already gone was finished by the courier that held it
 */
export function requeueCourier({ home, turnId }: { home: string; turnId: string }): Result<void, RelayCourierError> {
  const from = requestPath({ home, stage: "claimed", turnId });
  const to = requestPath({ home, stage: "pending", turnId });
  if (from.isErr()) {
    return err(from.error);
  }
  if (to.isErr()) {
    return err(to.error);
  }
  try {
    renameSync(from.value, to.value);
    return ok(undefined);
  } catch (cause) {
    if (errnoOf({ cause }) === "ENOENT") {
      return ok(undefined);
    }
    return err(RelayCourierErrors.storeFailed({ cause, path: from.value }));
  }
}

/**
 * Remove a finished request — its delivery is on the turn, so the request has nothing left to say.
 *
 * @param home the state home
 * @param turnId the turn delivered
 * @returns nothing; a request already gone is finished too
 */
export function finishCourier({ home, turnId }: { home: string; turnId: string }): Result<void, RelayCourierError> {
  const path = requestPath({ home, stage: "claimed", turnId });
  if (path.isErr()) {
    return err(path.error);
  }
  try {
    unlinkSync(path.value);
    return ok(undefined);
  } catch (cause) {
    if (errnoOf({ cause }) === "ENOENT") {
      return ok(undefined);
    }
    return err(RelayCourierErrors.storeFailed({ cause, path: path.value }));
  }
}

/** A request file's contents, refused unless it is a request for exactly the turn its name says. */
function readRequest({
  path,
  turnId,
}: {
  path: string;
  turnId: string;
}): Result<RelayCourierRequest, RelayCourierError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return err(RelayCourierErrors.storeFailed({ cause, path }));
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "courier request", text });
  } catch (cause) {
    return err(RelayCourierErrors.malformed({ path, why: cause instanceof Error ? cause.message : String(cause) }));
  }
  const request = requestSchema.safeParse(parsed);
  if (!request.success) {
    return err(RelayCourierErrors.malformed({ path, why: request.error.message }));
  }
  if (request.data.turnId !== turnId) {
    return err(RelayCourierErrors.malformed({ path, why: `it names turn ${request.data.turnId}` }));
  }
  return ok(request.data);
}
