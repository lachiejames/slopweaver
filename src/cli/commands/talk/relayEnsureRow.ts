/**
 * Put a relay turn's row on the board exactly once — the step between claiming the turn and marking it registered.
 *
 * Split out of {@link ./relayRun.js} (the file-size ratchet) along that seam: `relayRun.ts` states the order a
 * relay runs its steps in, and this module owns the one decision that must never adopt a row it did not write.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { StatedWorkspace } from "../../../handover/workspace.js";
import { logger } from "../../../lib/logger.js";
import type { RelayCardDisposition } from "../../../talk/relayChannelSteer.js";
import type { RelayDraft } from "../../../talk/relayDraft.js";
import { setTurnRegistering, type TurnRecord } from "../../../talk/relayStore.js";
import { EXIT_OK } from "../../exitCodes.js";
import { runHandoverRegister } from "../handover/askRowRun.js";
import { carryRelayOffer } from "./relayOfferAttach.js";
import { relayRegisterArgv } from "./relayRegisterArgv.js";
import { resolveRelayRepository } from "./relayRepository.js";

/**
 * Put the turn's row on the board unless it is already there, and say so when it is not after all.
 *
 * A row carrying the turn's anchor is adopted only when the turn reads `registering`: a previous run of this
 * turn reached the registration call and may have written it before it died. An `intended` turn never asked
 * for a row, so one already at its slug was not written for it, and adopting it would let whatever that row
 * says — a picture path included — stand as this relay. That refusal is durable: the turn stays
 * `intended`, so a retry refuses the same row again, and a registration call that fails with no row on the
 * board puts the turn back to `intended` for the same reason. A failure is reported here rather than through a
 * `TalkError` variant: the exit code, the anchor that was looked for and the retry hint are all local to
 * this verb.
 *
 * The row is born with this build's own checkout as its `repo:`, so `cmux spawn` can seat it, unless their words land
 * on an `ask:` card, whose own row carries the work (`./relayRepository.ts`). A checkout that does not resolve never
 * stops their words landing: the row is registered held, with one line saying why.
 *
 * @param disposition whether their words land on the card they were looking at, which decides an answer relay
 * @returns the turn as it now stands, or `undefined` when no row of this turn's is on the board
 */
export async function ensureRow({
  args,
  dir,
  disposition,
  draft,
  home,
  lead,
  record,
}: {
  args: { priority: string; workspace: StatedWorkspace | undefined };
  dir: string;
  disposition: RelayCardDisposition;
  draft: RelayDraft;
  home: string;
  lead: string | undefined;
  record: TurnRecord;
}): Promise<TurnRecord | undefined> {
  const found = rowCarriesAnchor({ dir, draft });
  if (found && record.state === "registering") {
    // A run killed between the registration and the offer's write left the row without it: this finishes that write.
    return (await carryRelayOffer({ dir, draft, home })) ? record : undefined;
  }
  if (found || existsSync(join(dir, `${draft.slug}.md`))) {
    logger.error({
      msg:
        `talk relay: ${draft.slug} is already on the board, and this turn never registered a row — refusing to ` +
        `adopt it as this relay. Move that file aside and relay again.`,
    });
    return undefined;
  }
  const registered = await registerRow({ args, dir, disposition, draft, home, lead, record });
  if (registered === undefined) {
    return undefined;
  }
  // The offer goes on the row before the turn is marked registered, so a failure here leaves it `registering` and a
  // retry adopts the row and writes it then.
  return (await carryRelayOffer({ dir, draft, home })) ? registered : undefined;
}

/**
 * Mark the turn `registering`, then register its row, retrying held when the checkout moved underneath.
 *
 * @param disposition whether their words land on the card they were looking at, which decides the row's `repo:`
 * @returns the turn marked `registering` once a row carrying its anchor is on the board, else `undefined`, the turn
 *   put back to `intended` so a retry registers afresh
 */
async function registerRow({
  args,
  dir,
  disposition,
  draft,
  home,
  lead,
  record,
}: {
  args: { priority: string; workspace: StatedWorkspace | undefined };
  dir: string;
  disposition: RelayCardDisposition;
  draft: RelayDraft;
  home: string;
  lead: string | undefined;
  record: TurnRecord;
}): Promise<TurnRecord | undefined> {
  const repo = relayRowRepository({ about: draft.about, disposition, home, slug: draft.slug });
  const registering = setTurnRegistering({ home, record, registering: true });
  if (registering.isErr()) {
    logger.error({ msg: `talk relay: ${registering.error.message}` });
    return undefined;
  }
  // Through the same verb a human would run.
  const register = ({ withRepo }: { withRepo: string | undefined }): Promise<number> =>
    runHandoverRegister(
      relayRegisterArgv({ dir, draft, home, lead, priority: args.priority, repo: withRepo, workspace: args.workspace }),
    );
  let registered = await register({ withRepo: repo });
  // The checkout can move between resolving it and register re-judging it; the row is then held, never lost.
  // Only that: a refusal for any other reason, with the checkout still resolving, keeps the repo and fails.
  const checkoutMoved =
    registered !== EXIT_OK &&
    repo !== undefined &&
    !rowCarriesAnchor({ dir, draft }) &&
    resolveRelayRepository({ about: draft.about, disposition, home }).isErr();
  if (checkoutMoved) {
    logger.error({ msg: `talk relay: ${draft.slug} is held rather than ready — ${repo} no longer resolves` });
    registered = await register({ withRepo: undefined });
  }
  if (registered !== EXIT_OK && !rowCarriesAnchor({ dir, draft })) {
    logger.error({
      msg:
        `talk relay: registering ${draft.slug} exited ${String(registered)} and no row carrying ` +
        `${draft.anchor} is on the board — nothing was relayed, and relaying again will retry this turn`,
    });
    // Back to `intended`: this run wrote no row, so one that appears before the retry is not this turn's.
    const restaged = setTurnRegistering({ home, record: registering.value, registering: false });
    if (restaged.isErr()) {
      logger.error({ msg: `talk relay: ${restaged.error.message}` });
    }
    return undefined;
  }
  return registering.value;
}

/**
 * The row's `repo:`, saying in one line why it is held when this build's own checkout did not resolve.
 *
 * @returns the checkout, or `undefined` for an answer relay or one held for want of a checkout
 */
function relayRowRepository({
  about,
  disposition,
  home,
  slug,
}: {
  about: string;
  disposition: RelayCardDisposition;
  home: string;
  slug: string;
}): string | undefined {
  const resolved = resolveRelayRepository({ about, disposition, home });
  if (resolved.isErr()) {
    logger.error({ msg: `talk relay: ${slug} is held rather than ready — ${resolved.error.message}` });
    return undefined;
  }
  return resolved.value;
}

/**
 * Whether the board already holds this turn's row — by the turn's own slug AND its anchor.
 *
 * The anchor is what makes this safe. A slug check alone would adopt any row that happened to carry the
 * name, which on `handover register`'s eight-word slug is a collision two different asks really do produce.
 */
function rowCarriesAnchor({ dir, draft }: { dir: string; draft: RelayDraft }): boolean {
  const path = join(dir, `${draft.slug}.md`);
  if (!existsSync(path)) {
    return false;
  }
  try {
    // The `anchor:` line itself, never the anchor quoted anywhere in a stranger's text.
    return readFileSync(path, "utf8").split("\n").includes(`anchor: ${draft.anchor}`);
  } catch {
    return false;
  }
}
