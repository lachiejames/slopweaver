/**
 * The filesystem tail of the intake record: one JSON file per proposal under `$SLOPWEAVER_HOME/proposals`.
 *
 * Thin by design. Every decision lives in `intake.ts`, which is pure; this file only reads, writes and
 * narrows. A malformed file is reported as a parse failure rather than repaired, because an intake that
 * silently loses its answers would let a draft proceed past questions nobody answered.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { notionPageAddress, type ProposalAddress, parseProposalAddress } from "./address.js";
import { type IntakeParseError, type ProposalIntakeError, ProposalIntakeErrors } from "./errors.js";
import type { IntakeQuestion, IntakeStatus, ProposalIntake } from "./intake.js";

/** An intake id is interpolated into a FILENAME, so anything that could escape the home is refused. */
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Whether a string is safe to use as an intake id.
 *
 * @param id the candidate id
 * @returns true iff it is lowercase alphanumeric with dashes, and cannot traverse a path
 */
export function isValidIntakeId({ id }: { id: string }): boolean {
  return SAFE_ID.test(id);
}

function intakeDir({ home }: { home: string }): string {
  return stateHomePaths({ home }).proposals;
}

/**
 * Where one intake is stored.
 *
 * @param home the state home
 * @param id the intake id
 * @returns the absolute path to its record
 */
export function intakePath({ home, id }: { home: string; id: string }): string {
  return join(intakeDir({ home }), `${id}.json`);
}

/**
 * Whether a record is already on disk for this id.
 *
 * `loadIntake` answers "no such file" (`INTAKE_NOT_FOUND`) and "the file is malformed" with different codes,
 * and those two demand opposite acts from a caller that is about to write: seed a fresh record over the
 * first, refuse to touch the second. Asking the filesystem lets that caller decide before it reads at all.
 *
 * @param home the state home
 * @param id the intake id
 * @returns true iff a file exists at this id's path; false for an id that could never have one
 */
export function intakeExists({ home, id }: { home: string; id: string }): boolean {
  if (!isValidIntakeId({ id })) {
    return false;
  }
  return existsSync(intakePath({ home, id }));
}

/** Narrow one persisted question. */
function parseQuestion({ raw }: { raw: unknown }): IntakeQuestion | undefined {
  if (!isRecord(raw) || typeof raw["key"] !== "string" || typeof raw["question"] !== "string") {
    return undefined;
  }
  const answer = raw["answer"];
  return {
    blocking: raw["blocking"] !== false,
    key: raw["key"],
    question: raw["question"],
    ...(typeof answer === "string" ? { answer } : {}),
  };
}

/** Whether a string is one of the four intake statuses. */
function isStatus(value: unknown): value is IntakeStatus {
  return value === "intake" || value === "ready-to-draft" || value === "drafted" || value === "published";
}

/**
 * Narrow parsed JSON into an intake, or say why it is not one.
 *
 * @param raw the parsed JSON
 * @returns the record, or the reason it could not be read
 */
export function parseIntake({ raw }: { raw: unknown }): Result<ProposalIntake, IntakeParseError> {
  if (!isRecord(raw) || typeof raw["id"] !== "string" || typeof raw["brief"] !== "string") {
    return err(ProposalIntakeErrors.missingIdOrBrief());
  }
  const questions = Array.isArray(raw["questions"]) ? raw["questions"] : undefined;
  if (questions === undefined) {
    return err(ProposalIntakeErrors.noQuestions({ id: raw["id"] }));
  }
  const parsed = questions.map((question) => parseQuestion({ raw: question }));
  if (parsed.some((question) => question === undefined)) {
    return err(ProposalIntakeErrors.malformedQuestion({ id: raw["id"] }));
  }
  const id: string = raw["id"];
  const brief: string = raw["brief"];
  return parseIntakeAddress({ id, raw }).map((published) => ({
    brief,
    createdIso: typeof raw["createdIso"] === "string" ? raw["createdIso"] : new Date(0).toISOString(),
    id,
    questions: parsed.filter((question) => question !== undefined),
    status: isStatus(raw["status"]) ? raw["status"] : "intake",
    ...published,
  }));
}

/** What a record says about where it published: an address, a legacy URL alone, or nothing yet. */
type IntakePublished =
  { readonly address: ProposalAddress } | { readonly linkOnlyPageUrl: string } | Record<string, never>;

/**
 * Read where an intake published, choosing the wire version by which keys are present.
 *
 * A record carrying `address` is read strictly from it, and carrying a legacy page key BESIDE it is
 * ambiguous and refused. A record with no `address` predates the provider-tagged shape, when every publish
 * was a Notion page: a `pageId` (with or without a `pageUrl`) is that Notion address, and a `pageUrl` alone
 * is kept for teasers only. Neither is an intake that has not published.
 */
function parseIntakeAddress({
  id,
  raw,
}: {
  id: string;
  raw: Readonly<Record<string, unknown>>;
}): Result<IntakePublished, IntakeParseError> {
  const pageId = raw["pageId"];
  const pageUrl = raw["pageUrl"];
  if (Object.hasOwn(raw, "address")) {
    if (pageId !== undefined || pageUrl !== undefined) {
      return err(ProposalIntakeErrors.addressInvalid({ id, why: "it carries both address and a legacy page field" }));
    }
    const address = parseProposalAddress({ raw: raw["address"] });
    if (address.isErr()) {
      return err(ProposalIntakeErrors.addressInvalid({ id, why: address.error.join("; ") }));
    }
    return ok({ address: address.value });
  }
  const storedUrl = typeof pageUrl === "string" ? pageUrl : undefined;
  // An EMPTY legacy `pageId` names no page, so it counts as absent: with a URL beside it the record is
  // URL-only, which a re-publish refuses rather than treating "" as a page to update.
  if (typeof pageId === "string" && pageId.length > 0) {
    // Read through the same strict schema an `address` key is, so a legacy id is held to the same bar.
    const address = parseProposalAddress({ raw: notionPageAddress({ pageId, pageUrl: storedUrl }) });
    if (address.isErr()) {
      return err(ProposalIntakeErrors.addressInvalid({ id, why: `legacy pageId: ${address.error.join("; ")}` }));
    }
    return ok({ address: address.value });
  }
  if (storedUrl !== undefined) {
    return ok({ linkOnlyPageUrl: storedUrl });
  }
  return ok({});
}

/**
 * Write one intake, creating the directory if it is not there.
 *
 * A legacy URL-only record is written back under its ON-DISK key, `pageUrl`, never the in-memory name
 * `linkOnlyPageUrl`: the reader recognises only the former, so writing the latter would turn a published
 * intake into one that looks unpublished, and the next publish would create a second page.
 *
 * @param home the state home
 * @param intake the record to persist
 */
export function saveIntake({ home, intake }: { home: string; intake: ProposalIntake }): void {
  const { linkOnlyPageUrl, ...rest } = intake;
  const onDisk = linkOnlyPageUrl === undefined ? rest : { ...rest, pageUrl: linkOnlyPageUrl };
  writeFileAtomic({ contents: `${JSON.stringify(onDisk, null, 2)}\n`, path: intakePath({ home, id: intake.id }) });
}

/**
 * Read one intake.
 *
 * @param home the state home
 * @param id the intake id
 * @returns the record, or the reason it could not be read
 */
export function loadIntake({ home, id }: { home: string; id: string }): Result<ProposalIntake, ProposalIntakeError> {
  if (!isValidIntakeId({ id })) {
    return err(ProposalIntakeErrors.idInvalid({ id }));
  }
  const path = intakePath({ home, id });
  if (!existsSync(path)) {
    return err(ProposalIntakeErrors.notFound({ id, path }));
  }
  try {
    return parseIntake({ raw: JSON.parse(readFileSync(path, "utf8")) as unknown });
  } catch (error: unknown) {
    return err(ProposalIntakeErrors.unreadable({ cause: error, id }));
  }
}
