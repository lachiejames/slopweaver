/**
 * Everything a restore rehearsal settles before it starts a container: what the live store is, the checked
 * target, that no container already has its name, and the fetched backup with its other legs read. So a wrong
 * target costs no download and no container — the order `./rehearsal.ts` calls the safety.
 *
 * Split from `./rehearsal.ts` when it grew past the size ratchet: this half runs before the throwaway exists,
 * that half inside it.
 */
import { err, ok, type Result } from "#lib/result.js";

import { supabaseContainer } from "./plan.js";
import type { RehearsalDeps } from "./rehearsal.js";
import type { LegsReading } from "./rehearsalCheck.js";
import { type RehearsalError, RehearsalErrors } from "./rehearsalErrors.js";
import { chooseBackup, type RehearsalSource } from "./rehearsalSource.js";
import { type LiveStore, type RehearsalRequest, type RehearsalTarget, rehearsalTarget } from "./rehearsalTarget.js";

/**
 * The live store's coordinates, from its connection string and its container.
 *
 * @param liveUrl the store selection
 * @param deps the effects, for `docker inspect`
 * @returns what the rehearsal must never touch
 */
function describeLive({
  liveUrl,
  deps,
}: {
  liveUrl: string;
  deps: Pick<RehearsalDeps, "inspectLiveContainer">;
}): Result<LiveStore, RehearsalError> {
  let parsed: URL;
  try {
    parsed = new URL(liveUrl);
  } catch {
    return err(RehearsalErrors.liveUnreadable({ reasons: ["the store selection is not a connection string"] }));
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const port = Number(parsed.port);
  if (database.length === 0 || !Number.isInteger(port) || port <= 0) {
    return err(
      RehearsalErrors.liveUnreadable({ reasons: ["the store selection names no database, or no explicit port"] }),
    );
  }
  const container = supabaseContainer({ service: "db" });
  const inspected = deps.inspectLiveContainer({ container });
  if (inspected.isErr()) {
    return err(inspected.error);
  }
  return ok({ container, database, imageId: inspected.value.imageId, mounts: inspected.value.mounts, port });
}

/**
 * Everything a rehearsal settles before it starts a container: what live is, the checked target, that no
 * container already has its name, and the fetched backup with its other legs read. So a wrong target costs no
 * download and no container.
 *
 * @param liveUrl the live store's connection string
 * @param requested the throwaway the caller asked for
 * @param destination the local destination root the backups are listed from
 * @param from a prefix to rehearse instead of the newest, or `null`
 * @param deps the effects
 * @returns what the throwaway needs, or why the rehearsal stops here
 */
export async function prepareRehearsal({
  liveUrl,
  requested,
  destination,
  from,
  deps,
}: {
  liveUrl: string;
  requested: RehearsalRequest;
  destination: string;
  from: string | null;
  deps: RehearsalDeps;
}): Promise<
  Result<{ live: LiveStore; target: RehearsalTarget; source: RehearsalSource; legs: LegsReading }, RehearsalError>
> {
  const live = describeLive({ deps, liveUrl });
  if (live.isErr()) {
    return err(live.error);
  }
  const target = rehearsalTarget({ live: live.value, requested });
  if (target.isErr()) {
    return err(target.error);
  }
  const taken = deps.containerNameTaken({ name: target.value.container });
  if (taken.isErr()) {
    return err(taken.error);
  }
  if (taken.value) {
    return err(RehearsalErrors.containerExists({ container: target.value.container }));
  }
  const prefix = await chooseBackup({ destination, from, listBackups: deps.listBackups });
  if (prefix.isErr()) {
    return err(prefix.error);
  }
  const source = await deps.fetchSource({ prefix: prefix.value });
  if (source.isErr()) {
    return err(source.error);
  }
  const legs = await deps.readOtherLegs({ directory: source.value.directory });
  if (legs.isErr()) {
    return err(legs.error);
  }
  return ok({ legs: legs.value, live: live.value, source: source.value, target: target.value });
}
