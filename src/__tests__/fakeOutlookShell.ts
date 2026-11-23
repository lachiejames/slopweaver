/**
 * The `outlook` verb shells' effects over a fake mailbox: plain recording functions, no mock. A shell test hands
 * these to `runOutlook*`; every write verb routes through the door, which records its decision into the in-memory
 * door ledger the shell returns beside the record, so a test reads the decision back from it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DoorLedgerPort } from "../admit/doorLedgerPort.js";
import type { OutlookShellDeps } from "../cli/commands/outlook/shell.js";
import { err, ok } from "../lib/result.js";
import type { OutlookError } from "../live/outlook/errors.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "./doorLedgerFixture.js";
import { FAKE_OUTLOOK_ACCOUNT, type FakeMailbox, fakeOutlookApi } from "./fakeOutlookMailbox.js";

/** Everything a shell did through its effects. */
export interface OutlookShellRecord {
  readonly out: string[];
  readonly warn: string[];
  readonly sessions: { home: string; verb: string }[];
  readonly saved: { path: string; size: number }[];
  readonly stdinReads: number[];
}

/**
 * Effects over `mailbox`, recording every line, session and write.
 *
 * @param stdin what a `--form -` read answers
 * @param sessionError a refusal every session bind answers instead of the mailbox
 * @param ledger a door ledger port to hand the shell instead of the in-memory one, for a store outage
 * @returns the effects, their record, and the in-memory door ledger the shell records its decisions into
 */
export function fakeOutlookShell({
  mailbox,
  home,
  stdin = "",
  sessionError,
  ledger,
}: {
  mailbox: FakeMailbox;
  home: string;
  stdin?: string;
  sessionError?: OutlookError;
  ledger?: DoorLedgerPort;
}): { deps: OutlookShellDeps; record: OutlookShellRecord; door: MemoryDoorLedger } {
  const record: OutlookShellRecord = { out: [], saved: [], sessions: [], stdinReads: [], warn: [] };
  const api = fakeOutlookApi({ mailbox });
  const door = memoryDoorLedger();
  let doorLedger: DoorLedgerPort = door.port;
  if (ledger !== undefined) {
    doorLedger = ledger;
  }
  const deps: OutlookShellDeps = {
    doorLedger,
    home: () => home,
    out: (line) => {
      record.out.push(line);
    },
    readStdin: async () => {
      record.stdinReads.push(1);
      return stdin;
    },
    session: async ({ home: bound, verb }) => {
      record.sessions.push({ home: bound, verb });
      if (sessionError !== undefined) {
        return err(sessionError);
      }
      return ok({ account: FAKE_OUTLOOK_ACCOUNT, api });
    },
    warn: (line) => {
      record.warn.push(line);
    },
    writeBytes: ({ path, bytes }) => {
      record.saved.push({ path, size: bytes.length });
    },
  };
  return { deps, door, record };
}

/**
 * Run one case against a throwaway home, removed afterwards whatever the case did.
 *
 * @param run the case, handed its home
 */
export async function withOutlookHome({ run }: { run: (args: { home: string }) => Promise<void> }): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "sw-outlook-"));
  try {
    await run({ home });
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
}
