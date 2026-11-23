/**
 * Reading and writing the candidates, and reading the append-only ledgers beside them — the effectful half of
 * `./candidates.ts`. Every verb reads the one catalog (`./candidateCatalog.ts`): the stated candidates
 * (`stated-candidates.json`) and the mined file.
 *
 * `candidates.json` is one bounded document (about a hundred rows), written whole and atomically. Each ledger
 * (`reactions.jsonl`, definitions, titles, proposals, who-first) is append-only, read through `readJsonlLines` with
 * every row validated, and written by `./ledgerAppend.ts`'s `appendLedgerRows`, the one writer they all go through.
 * Recording the owner's reactions, the one critical section that also writes the register, is `./reactionStore.ts`.
 */
import { readFileSync, statSync } from "node:fs";

import type { z } from "zod";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { resolveHome } from "../cli/optionParsers.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";

import { type CandidateCatalog, candidateCatalog } from "./candidateCatalog.js";
import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import {
  answeredIdConflicts,
  type Candidate,
  type CandidatesFile,
  parseCandidatesFile,
  type ReactionRow,
  reactionRowSchema,
} from "./candidates.js";
import { type DefinitionRow, definitionRowSchema } from "./definitions.js";
import { type ProposalRow, proposalRowSchema } from "./proposals.js";
import { type CandidateState, latestReactions, standingState } from "./reactionFold.js";
import { NONE_STATED, parseStatedCandidatesFile, type StatedCandidates } from "./statedCandidatesFile.js";
import type { WorkstreamStore } from "./store/port.js";
import type { WorkstreamRegisterSnapshot } from "./store/types.js";
import { type TitleRow, titleRowSchema } from "./titles.js";
import { type WhoFirstRow, whoFirstRowSchema } from "./whoFirst.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Read one whole JSON document of the candidates area.
 *
 * @param label what the document is, for a parse refusal
 * @returns the parsed value, `{ absent: true }` when no file is there, or why it could not be read
 */
function readJsonDocument({
  label,
  path,
}: {
  label: string;
  path: string;
}): Result<{ absent: true } | { absent: false; value: unknown }, CandidatesError> {
  try {
    statSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok({ absent: true });
    }
    return err(CandidatesErrors.unreadable({ cause: error, path }));
  }
  try {
    return ok({ absent: false, value: safeJsonParse({ label, text: readFileSync(path, "utf8") }) });
  } catch (error: unknown) {
    return err(CandidatesErrors.unreadable({ cause: errorMessage({ error }), path }));
  }
}

/**
 * Read and validate the mined candidates file. Private to persistence: every verb reads the catalog instead
 * ({@link readCandidateCatalog}).
 *
 * @param home the state home, the resolved one when absent
 * @returns the file, `null` when none has been mined yet, or why it could not be read — unreadable or invalid
 */
function readMinedFile({ home }: { home?: string }): Result<CandidatesFile | null, CandidatesError> {
  const path = stateHomePaths({ home: resolveHome({ named: home }) }).workstreamsCandidatesJson;
  return readJsonDocument({ label: "the workstream candidates", path }).andThen((read) => {
    if (read.absent) {
      return ok(null);
    }
    return parseCandidatesFile({ value: read.value });
  });
}

/**
 * Read and validate the outcomes the owner stated (`workstreams/stated-candidates.json`). No file is no outcome stated,
 * by design; a file that will not read or validate is a refusal naming the problem, never read as none.
 *
 * @param home the state home, the resolved one when absent
 * @returns the stated candidates and their exact former titles, or why they could not be read
 */
export function readStatedCandidates({ home }: { home?: string } = {}): Result<StatedCandidates, CandidatesError> {
  const path = stateHomePaths({ home: resolveHome({ named: home }) }).workstreamsStatedCandidatesJson;
  return readJsonDocument({ label: "the stated workstream candidates", path }).andThen((read) => {
    if (read.absent) {
      return ok(NONE_STATED);
    }
    return parseStatedCandidatesFile({ path, value: read.value });
  });
}

/**
 * The one catalog of candidates the owner can answer: the stated ones, then the mined file. Neither file yet is an
 * empty catalog; either file that will not read or validate is a refusal, never the other drawn as if it were not
 * there.
 *
 * @param home the state home, the resolved one when absent
 * @returns the catalog, or why it could not be had
 */
export function readCandidateCatalog({ home }: { home?: string } = {}): Result<CandidateCatalog, CandidatesError> {
  const scope = home === undefined ? {} : { home };
  return readStatedCandidates(scope).andThen((stated) =>
    readMinedFile(scope).andThen((mined) => candidateCatalog({ mined, stated: stated.candidates })),
  );
}

/**
 * Validate a mined candidates document and, only when it passes, write it whole and atomically. It must also join the
 * stated candidates as one catalog — no id, number or name of a stated candidate reused — so a clash is refused here,
 * before any file exists, rather than at the next read.
 *
 * @param home the state home, the resolved one when absent
 * @param value the parsed document, validated here so no caller can skip a rule
 * @returns the path and the document as stored, or why nothing was written
 */
export function writeCandidates({
  home,
  value,
}: {
  home?: string;
  value: unknown;
}): Result<{ path: string; file: CandidatesFile }, CandidatesError> {
  const parsed = parseCandidatesFile({ value });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const scope = home === undefined ? {} : { home };
  const stated = readStatedCandidates(scope);
  if (stated.isErr()) {
    return err(stated.error);
  }
  const catalog = candidateCatalog({ mined: parsed.value, stated: stated.value.candidates });
  if (catalog.isErr()) {
    return err(catalog.error);
  }
  const rows = readReactionRows(scope);
  if (rows.isErr()) {
    return err(rows.error);
  }
  const definitions = readDefinitionRows(scope);
  if (definitions.isErr()) {
    return err(definitions.error);
  }
  const titles = readTitleRows(scope);
  if (titles.isErr()) {
    return err(titles.error);
  }
  const answeredWho = readWhoFirstRows(scope);
  if (answeredWho.isErr()) {
    return err(answeredWho.error);
  }
  const conflicts = answeredIdConflicts({
    file: catalog.value,
    formerNames: stated.value.formerNames,
    rows: [...rows.value, ...definitions.value, ...titles.value, ...answeredWho.value],
  });
  if (conflicts.length > 0) {
    return err(CandidatesErrors.invalid({ problems: conflicts }));
  }
  const path = stateHomePaths({ home: resolveHome({ named: home }) }).workstreamsCandidatesJson;
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "the workstream candidates", space: 2, value: parsed.value })}\n`,
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path,
    });
  } catch (error: unknown) {
    return err(CandidatesErrors.writeFailed({ cause: errorMessage({ error }), path }));
  }
  return ok({ file: parsed.value, path });
}

/**
 * Every reaction row, in file order; an absent ledger is no reactions yet, a malformed row a refusal.
 *
 * @param home the state home, the resolved one when absent
 * @returns the rows, or why they could not be read
 */
export function readReactionRows({ home }: { home?: string } = {}): Result<readonly ReactionRow[], CandidatesError> {
  const path = stateHomePaths({ home: resolveHome({ named: home }) }).workstreamsReactionsJsonl;
  return readLedger({ label: "a reaction row", path, schema: reactionRowSchema });
}

/**
 * Every definition row, in file order; an absent ledger is no definitions yet, a malformed row a refusal.
 *
 * @param home the state home, the resolved one when absent
 * @returns the rows, or why they could not be read
 */
export function readDefinitionRows({ home }: { home?: string } = {}): Result<
  readonly DefinitionRow[],
  CandidatesError
> {
  const path = stateHomePaths({ home: resolveHome({ named: home }) }).workstreamsDefinitionsJsonl;
  return readLedger({ label: "a definition row", path, schema: definitionRowSchema });
}

/**
 * Every title row, in file order; an absent ledger is no titles yet, a malformed row a refusal.
 *
 * @param home the state home, the resolved one when absent
 * @returns the rows, or why they could not be read
 */
export function readTitleRows({ home }: { home?: string } = {}): Result<readonly TitleRow[], CandidatesError> {
  const path = stateHomePaths({ home: resolveHome({ named: home }) }).workstreamsTitlesJsonl;
  return readLedger({ label: "a title row", path, schema: titleRowSchema });
}

/**
 * Every proposal row, in file order; an absent ledger is no proposals yet, a malformed row a refusal.
 *
 * @param home the state home, the resolved one when absent
 * @returns the rows, or why they could not be read
 */
export function readProposalRows({ home }: { home?: string } = {}): Result<readonly ProposalRow[], CandidatesError> {
  const path = stateHomePaths({ home: resolveHome({ named: home }) }).workstreamsProposalsJsonl;
  return readLedger({ label: "a proposal row", path, schema: proposalRowSchema });
}

/**
 * Every who-first row, in file order; an absent ledger is none answered yet, a malformed row a refusal.
 *
 * @param home the state home, the resolved one when absent
 * @returns the rows, or why they could not be read
 */
export function readWhoFirstRows({ home }: { home?: string } = {}): Result<readonly WhoFirstRow[], CandidatesError> {
  const path = stateHomePaths({ home: resolveHome({ named: home }) }).workstreamsWhoFirstJsonl;
  return readLedger({ label: "a who-first row", path, schema: whoFirstRowSchema });
}

/**
 * Every row of one append-only ledger, each validated; an absent file is none yet, a malformed row a refusal naming its
 * line, never a row skipped.
 *
 * @param label what one row is, for a parse refusal
 * @param schema what each row must be
 * @returns the rows, or why they could not be read
 */
function readLedger<T>({
  label,
  path,
  schema,
}: {
  label: string;
  path: string;
  schema: z.ZodType<T>;
}): Result<readonly T[], CandidatesError> {
  try {
    statSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok([]);
    }
    return err(CandidatesErrors.unreadable({ cause: error, path }));
  }
  const rows: T[] = [];
  const problems: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = schema.safeParse(safeJsonParse({ label, text: line }));
        if (parsed.success) {
          rows.push(parsed.data);
        } else {
          problems.push(`line ${String(index + 1)}: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
        }
      },
      path,
    });
  } catch (error: unknown) {
    return err(CandidatesErrors.unreadable({ cause: errorMessage({ error }), path }));
  }
  if (problems.length > 0) {
    return err(CandidatesErrors.unreadable({ cause: problems.join("; "), path }));
  }
  return ok(rows);
}

/**
 * The candidate one ledger write is about, read from the catalog — refused, in the caller's own domain words, when no
 * candidate carries that id.
 *
 * @param candidateId the id the call named
 * @param refusal the caller's refusal factory, so the message says what was not recorded
 * @returns the candidate, or why there is none
 */
export function candidateById({
  home,
  candidateId,
  refusal,
}: {
  home: string;
  candidateId: string;
  refusal: (args: { problems: readonly string[] }) => CandidatesError;
}): Result<Candidate, CandidatesError> {
  return readCandidateCatalog({ home }).andThen((catalog) => {
    const candidate = catalog.candidates.find((one) => one.id === candidateId);
    if (candidate === undefined) {
      return err(refusal({ problems: [`no candidate has the id ${candidateId}`] }));
    }
    return ok(candidate);
  });
}

/**
 * What a ledger write that may carry onto the register needs to know first: the candidate's latest word and the
 * register as it stands. Read BEFORE the row is appended, so an unreadable reactions ledger or register refuses with
 * nothing recorded rather than after the row is already down.
 *
 * @param candidateId the candidate the write is about
 * @param store the store-backed register
 * @returns its latest word (`undefined` before any) and the register as the store holds it (empty before the first
 *   yes), or the refusal
 */
export async function standingOf({
  candidateId,
  home,
  store,
}: {
  candidateId: string;
  home: string;
  store: WorkstreamStore;
}): Promise<Result<{ state: CandidateState | undefined; register: WorkstreamRegisterSnapshot }, CandidatesError>> {
  const reactions = readReactionRows({ home });
  if (reactions.isErr()) {
    return err(reactions.error);
  }
  const state = standingState({
    candidateId,
    held: reactions.value,
    states: latestReactions({ rows: reactions.value }),
  });
  const register = await store.read({ home });
  if (register.isErr()) {
    return err(CandidatesErrors.registerRefused({ cause: register.error }));
  }
  return ok({ register: register.value, state });
}
