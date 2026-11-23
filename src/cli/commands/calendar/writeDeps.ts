/**
 * The seams the `calendar` write shells (`./writeRun.ts`) perform their effects through, and their production
 * wiring. Kept apart from the shells so the shells read as the decision they make, and a test swaps every seam
 * for a plain fake.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { HisWordsError } from "../../../handover/hisWordsErrors.js";
import { type RawWords, resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, type Result } from "../../../lib/result.js";
import type { CalendarError } from "../../../live/calendar/errors.js";
import { PRIMARY_CALENDAR } from "../../../live/calendar/read.js";
import {
  applyCalendarWrite,
  type CalendarWriteOutcome,
  prepareCalendarCommit,
  prepareCalendarWrite,
} from "../../../live/calendar/write.js";
import type { CalendarWritePlan } from "../../../live/calendar/writePlan.js";
import type { CalendarWriteForm } from "../../../outbound/calendar/form.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { resolveHome } from "../../optionParsers.js";
import { boundCalendarWriter } from "./writeBinding.js";

/** The seams the write shells perform their effects through. */
export interface CalendarWriteDeps {
  readonly prepare: (args: {
    home: string | undefined;
    form: CalendarWriteForm;
    eventId: string | undefined;
    intentId: string;
  }) => Promise<Result<CalendarWritePlan, CalendarError>>;
  readonly prepareCommit: (args: {
    home: string | undefined;
    intentId: string;
  }) => Promise<Result<CalendarWritePlan, CalendarError>>;
  readonly apply: (args: {
    home: string | undefined;
    plan: CalendarWritePlan;
  }) => Promise<Result<CalendarWriteOutcome, CalendarError>>;
  readonly newIntentId: () => string;
  /** The owner's words at a `commit --anchor`, read by the one resolver every owner-words anchor goes through. */
  readonly readOwnerWords: (args: { anchor: string; home: string }) => Result<RawWords, HisWordsError>;
  readonly readStdin: () => Promise<string>;
  readonly home: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The door ledger every write attempt's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** The account, both APIs and the zone a write is bound to, once its grant has been read. */
type BoundWriter =
  Awaited<ReturnType<typeof boundCalendarWriter>> extends Result<infer Writer, CalendarError> ? Writer : never;

/** The two fields every write takes off the bound writer unchanged. */
function accountAndApi({ writer }: { writer: BoundWriter }): Pick<BoundWriter, "account" | "api"> {
  return { account: writer.account, api: writer.api };
}

/** Resolve the home, bind the writer from its grant, and act through it — the steps every write seam shares. */
async function throughWriter<T>({
  act,
  home,
}: {
  act: (bound: { resolved: string; writer: BoundWriter }) => Promise<Result<T, CalendarError>>;
  home: string | undefined;
}): Promise<Result<T, CalendarError>> {
  const resolved = resolveHome({ named: home });
  const writer = await boundCalendarWriter({ home: resolved });
  if (writer.isErr()) {
    return err(writer.error);
  }
  return act({ resolved, writer: writer.value });
}

/**
 * The production write seams.
 *
 * Every write needs `events` (to read the target back) AND `ownedEvents` (to change it); the credential is
 * what stops a read-only install here, before any form is read. The calendar is always the owner's own.
 *
 * @returns the grant-aware prepare/apply edges, the id and stdin sources, and the output sinks
 */
export function productionCalendarWriteDeps(): CalendarWriteDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    apply: ({ home, plan }) =>
      throughWriter({
        act: ({ resolved, writer }) =>
          applyCalendarWrite({ ...accountAndApi({ writer }), home: resolved, plan, writeApi: writer.writeApi }),
        home,
      }),
    doorLedger: doorLedgerPort(),
    home: () => slopweaverHome(),
    newIntentId: () => randomUUID(),
    prepare: ({ home, form, eventId, intentId }) =>
      throughWriter({
        act: ({ resolved, writer }) =>
          prepareCalendarWrite({
            ...accountAndApi({ writer }),
            calendarId: PRIMARY_CALENDAR,
            eventId,
            form,
            home: resolved,
            intentId,
            nowIso,
            zone: writer.zone,
          }),
        home,
      }),
    prepareCommit: ({ home, intentId }) =>
      throughWriter({
        act: ({ resolved, writer }) =>
          prepareCalendarCommit({ ...accountAndApi({ writer }), home: resolved, intentId, zone: writer.zone }),
        home,
      }),
    readOwnerWords: ({ anchor, home }) =>
      resolveRawWords({ anchor, home, projectsDir: join(claudeHomeDir(), "projects") }),
    readStdin,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}
