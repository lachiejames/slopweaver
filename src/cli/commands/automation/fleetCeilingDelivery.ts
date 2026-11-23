/**
 * The fleet-ceiling morning's effects, in the one order that leaves nothing half-placed: withdraw a card under today's
 * slug this reading no longer earns, publish the page, place the Queue card once (read before create), attach the
 * page to a card placed NOW, then withdraw yesterday's card if it still waits unanswered. The plan is pure and decided upstream (`../../../live/automation/fleetCeilingReport.ts`);
 * this is the effectful edge only.
 *
 * Idempotent per slot: the page republishes the same bytes under the same slug, a card already standing under the
 * slug is reported rather than stacked, and a card the owner settled or archived is never placed again. A retry whose
 * reading no longer earns the card — a broken one above all — withdraws the card an earlier attempt left open under
 * the same slug, so a broken reading never leaves a card asking the owner.
 *
 * What that holds over, and what it does not: re-runs in SEQUENCE, which is every re-run run-due produces, because
 * the slot ledger serialises two dispatchers taking one firing (`skills/automation/reference/exactly-once.md`). It
 * does not hold across a holder that died mid-delivery, whose expired lease a successor takes, if that successor's
 * read-before-create straddles the owner settling AND archiving the dead holder's card. Closing that needs `handover
 * register` to claim the slug atomically against the archive, which no caller has today.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readFleetWhyReport } from "../../../capacity/fleetWhyRead.js";
import { type ExactDoc, readExactDoc, scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type FleetCeilingWhy, fleetCeilingAskArgv } from "../../../live/automation/fleetCeilingAsk.js";
import type { FleetCeilingDelivery } from "../../../live/automation/fleetCeilingReport.js";
import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";
import type { PagePublisher } from "../../../pages/publish.js";
import { EXIT_OK } from "../../exitCodes.js";
import { registerAskRow } from "../handover/askRowRun.js";
import { runHandoverArtifact } from "../handover/closeRun.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { runHandoverWithdraw } from "../handover/withdrawRun.js";
import { teeLeg } from "./collectLeg.js";
import {
  type FleetCeilingCardFailedError,
  type FleetCeilingCardNotWithdrawnError,
  type FleetCeilingCardReceipt,
  type FleetCeilingDelivered,
  type FleetCeilingDeliveryError,
  FleetCeilingDeliveryErrors,
  type FleetCeilingPreviousReceipt,
  withdrawReceipt,
} from "./fleetCeilingDeliveryErrors.js";

/** A card that stands: settled when archived or carrying a settlement, else still open on the Queue. */
function standingReceipt({ exact }: { exact: ExactDoc }): "existing" | "settled" {
  if (exact.archived || exact.doc.settlement !== undefined) {
    return "settled";
  }
  return "existing";
}

/**
 * Whether any doc, live or archived, claims `slug` under ANOTHER filename — the case `readExactDoc` cannot see and an
 * untagged `handover register` would re-place, because archived docs do carry slugs their filenames do not (the
 * register verb's own `archivedClaimant` measures it, `../handover/registerWrite.ts`). A board that does not read
 * whole cannot prove absence, so it refuses rather than placing.
 *
 * @param handoverDir the top-level handovers directory; its `archive/` is scanned too
 * @param slug today's card slug
 * @returns the claimant's standing, `undefined` when nothing claims it, or a card failure naming why the board could not say
 */
export function slugClaimant({
  handoverDir,
  slug,
}: {
  handoverDir: string;
  slug: string;
}): Result<"existing" | "settled" | undefined, FleetCeilingCardFailedError> {
  for (const archived of [false, true]) {
    const dir = archived ? join(handoverDir, "archive") : handoverDir;
    if (!existsSync(dir)) {
      continue;
    }
    const scan = scanBoard({ handoverDir: dir });
    if (scan.isErr()) {
      return err(
        FleetCeilingDeliveryErrors.cardFailed({
          slug,
          why: `the board at ${dir} would not scan: ${scan.error.message}`,
        }),
      );
    }
    if (scan.value.unreadable.length > 0) {
      const count = String(scan.value.unreadable.length);
      const why = `${count} doc(s) under ${dir} would not read, so no claimant is provable`;
      return err(FleetCeilingDeliveryErrors.cardFailed({ slug, why }));
    }
    const claimant = scan.value.docs.find((doc) => doc.slug === slug);
    if (claimant !== undefined) {
      return ok(standingReceipt({ exact: { archived, doc: claimant } }));
    }
  }
  return ok(undefined);
}

/**
 * Whether a card an earlier attempt at this slot placed still waits open under `slug` — the one a reading that earns
 * no card must withdraw. Reads the exact path only: this run's own register writes there, and a scan of the whole
 * board would let one unreadable doc anywhere fail every morning that earns no card.
 *
 * Its stated blind spot: an open doc claiming the slug under ANOTHER filename is not withdrawn. This
 * recipe never writes one — `handover register` writes `<slug>.md`, and placement refuses while any other doc
 * claims the slug ({@link slugClaimant}) — so only a hand-written doc could stand there.
 *
 * @param handoverDir the top-level handovers directory
 * @param slug today's card slug
 * @returns true when an open, unsettled card stands there, or a not-withdrawn failure when it would not read
 */
export function openCardAt({
  handoverDir,
  slug,
}: {
  handoverDir: string;
  slug: string;
}): Result<boolean, FleetCeilingCardNotWithdrawnError> {
  const standing = readExactDoc({ handoverDir, slug });
  if (standing.isErr()) {
    return err(FleetCeilingDeliveryErrors.cardNotWithdrawn({ slug, why: standing.error.message }));
  }
  return ok(standing.value !== undefined && standingReceipt({ exact: standing.value }) === "existing");
}

/** Withdraw the card under `slug` that this slot's reading no longer earns, when one still waits open. */
async function withdrawUnearned({
  handoverDir,
  home,
  slug,
}: {
  handoverDir: string;
  home: string;
  slug: string;
}): Promise<Result<FleetCeilingCardReceipt, FleetCeilingDeliveryError>> {
  const open = openCardAt({ handoverDir, slug });
  if (open.isErr()) {
    return err(open.error);
  }
  if (!open.value) {
    return ok("none");
  }
  const why = "a retry of this morning read it again and it no longer earns a card";
  const code = await runHandoverWithdraw([
    "node",
    "slopweaver",
    "handover",
    "withdraw",
    slug,
    "--why",
    why,
    "--home",
    home,
  ]);
  if (code !== EXIT_OK) {
    return err(FleetCeilingDeliveryErrors.cardNotWithdrawn({ slug, why: `handover withdraw exited ${String(code)}` }));
  }
  return ok("withdrawn");
}

/**
 * Withdraw the card an earlier attempt at this slot left open, for a retry that could not read its report at all —
 * so a firing that fails before any delivery leaves nothing asking the owner either.
 *
 * @param home the state home this tick is running over
 * @param slug the slot's card slug
 * @returns `none` when no open card stood there, `withdrawn` when one was taken down, or why it could not be
 */
export async function withdrawFleetCeilingCard({
  home,
  slug,
}: {
  home: string;
  slug: string;
}): Promise<Result<FleetCeilingCardReceipt, FleetCeilingDeliveryError>> {
  return withdrawUnearned({ handoverDir: resolveHandoverDir({ dir: undefined, home }), home, slug });
}

/** Place today's card once, attaching the page to a card placed now. An unearned card was withdrawn before the page. */
async function ensureCard({
  delivery,
  handoverDir,
  home,
  pageUrl,
}: {
  delivery: FleetCeilingDelivery;
  handoverDir: string;
  home: string;
  pageUrl: string;
}): Promise<Result<FleetCeilingCardReceipt, FleetCeilingDeliveryError>> {
  const { ask, slug } = delivery;
  if (ask === null) {
    return ok("none");
  }
  const standing = readExactDoc({ handoverDir, slug });
  if (standing.isErr()) {
    return err(FleetCeilingDeliveryErrors.cardFailed({ slug, why: standing.error.message }));
  }
  if (standing.value !== undefined) {
    return ok(standingReceipt({ exact: standing.value }));
  }
  const claimed = slugClaimant({ handoverDir, slug });
  if (claimed.isErr()) {
    return err(claimed.error);
  }
  if (claimed.value !== undefined) {
    return ok(claimed.value);
  }
  // Both legs run in process, so each one's reason is this process's stderr: teed, it rides the error onto the
  // firing's record rather than leaving only an exit code (`./collectLeg.ts`).
  const registered = await teeLeg({
    run: () => registerAskRow({ argv: fleetCeilingAskArgv({ ask, home }), origin: "automation", out: logger.out }),
  });
  if (registered.value !== EXIT_OK) {
    const why = appendVerbFailureWhy({
      diagnostics: registered.text,
      line: `handover register exited ${String(registered.value)}`,
    });
    return err(FleetCeilingDeliveryErrors.cardFailed({ slug, why }));
  }
  const attached = await teeLeg({
    run: () =>
      runHandoverArtifact(["node", "slopweaver", "handover", "artifact", slug, "--url", pageUrl, "--home", home]),
  });
  if (attached.value !== EXIT_OK) {
    return err(FleetCeilingDeliveryErrors.artifactFailed({ code: attached.value, diagnostics: attached.text, slug }));
  }
  return ok("placed");
}

/**
 * Withdraw yesterday's card when it still waits on the owner — today's page supersedes it. A failure here is reported,
 * never fatal: today's page and card already stand, and a stale card is what tomorrow's run tries again.
 */
async function withdrawPrevious({
  delivery,
  handoverDir,
  home,
}: {
  delivery: FleetCeilingDelivery;
  handoverDir: string;
  home: string;
}): Promise<FleetCeilingPreviousReceipt> {
  const previous = readExactDoc({ handoverDir, slug: delivery.previousSlug });
  if (previous.isErr()) {
    return { kind: "withdraw-failed", why: previous.error.message };
  }
  if (previous.value === undefined || standingReceipt({ exact: previous.value }) === "settled") {
    return { kind: "none" };
  }
  const why = `${delivery.slug}'s reading supersedes it`;
  // In process, like the card's legs: teed, its closing stderr says why the outcome line reads NOT withdrawn.
  const withdrawn = await teeLeg({
    run: () =>
      runHandoverWithdraw([
        "node",
        "slopweaver",
        "handover",
        "withdraw",
        delivery.previousSlug,
        "--why",
        why,
        "--home",
        home,
      ]),
  });
  return withdrawReceipt({ code: withdrawn.value, diagnostics: withdrawn.text });
}

/** The window `fleet why` reads before the slot: the last hour, the span its own default reads. */
const WHY_WINDOW_MINUTES = 60;

/**
 * What held the fleet back over the hour before the slot, from `fleet why`'s own reader.
 *
 * @param home the state home whose readings ledger is read
 * @param nowIso the slot, the window's end
 * @returns its sentences, or why the ledger could not say
 */
export function readFleetWhyForCeiling({ home, nowIso }: { home: string; nowIso: string }): FleetCeilingWhy {
  const read = readFleetWhyReport({ home, minutes: WHY_WINDOW_MINUTES, nowIso });
  if (read.isErr()) {
    return { kind: "unreadable", reason: read.error.message };
  }
  return { kind: "read", sentences: read.value.sentences };
}

/**
 * Deliver one fleet-ceiling morning: the page, the card when earned, and yesterday's card withdrawn.
 *
 * @param delivery the pure plan for this slot
 * @param home the state home this tick is running over
 * @param nowIso the instant the page's frozen bytes are stamped with
 * @param publish writes the page to its folder, its freeze and the store
 * @returns what was placed, or the first effect that stopped short
 */
export async function deliverFleetCeiling({
  delivery,
  home,
  nowIso,
  publish,
}: {
  delivery: FleetCeilingDelivery;
  home: string;
  nowIso: string;
  publish: PagePublisher;
}): Promise<Result<FleetCeilingDelivered, FleetCeilingDeliveryError>> {
  const handoverDir = resolveHandoverDir({ dir: undefined, home });
  // A card this reading does not earn comes down FIRST, so no later failure — the page's included — leaves it
  // asking the owner.
  const unearned = delivery.ask === null ? await withdrawUnearned({ handoverDir, home, slug: delivery.slug }) : null;
  if (unearned?.isErr()) {
    return err(unearned.error);
  }
  const published = await publish({ fragment: delivery.fragment, home, nowIso, slug: delivery.slug });
  if (published.isErr()) {
    return err(FleetCeilingDeliveryErrors.pagePublishFailed({ slug: delivery.slug, why: published.error.join("; ") }));
  }
  const pageUrl = published.value.url;
  // A withdrawn card IS this reading's card outcome; only an earned reading places (or keeps) one.
  let card: Result<FleetCeilingCardReceipt, FleetCeilingDeliveryError>;
  if (unearned === null) {
    card = await ensureCard({ delivery, handoverDir, home, pageUrl });
  } else {
    card = unearned;
  }
  if (card.isErr()) {
    return err(card.error);
  }
  const previous = await withdrawPrevious({ delivery, handoverDir, home });
  return ok({ card: card.value, pageUrl, previous });
}
