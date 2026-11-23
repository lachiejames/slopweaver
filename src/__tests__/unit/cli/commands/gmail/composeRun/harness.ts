/*
 * What the two outbound shells' test files share. Every edge is a plain function — no vi.fn anywhere — and both
 * shells route through `throughDoor`, which records its decision through an in-memory door ledger
 * (`doorLedgerFixture.ts`). `home` stays a real `mkdtempSync` directory, minted and removed per case by
 * `withHome`, because the board cases read the run journal under it. It moved here when `composeRun.test.ts` was
 * split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GmailComposeDeps } from "../../../../../../cli/commands/gmail/composeRun.js";
import { err, ok } from "../../../../../../lib/result.js";
import { GmailErrors } from "../../../../../../live/gmail/errors.js";
import type { GmailDraftPlan, GmailSendPlan } from "../../../../../../live/gmail/outbox.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";

export const DIGEST = "3f9a2c7e1b4d5006";

/**
 * The plan the fake `planDraft` seam hands back.
 *
 * @returns a draft plan from owner@example.test to one recipient, carrying no reply target
 */
export function draftPlanFixture(): GmailDraftPlan {
  return {
    account: "owner@example.test",
    form: { bcc: [], body: "the body", cc: [], subject: "a subject", to: ["someone@example.com"] },
    from: "owner@example.test",
    message: "From: owner@example.test\r\n\r\ndGhlIGJvZHk=\r\n",
    raw: "RnJvbTogb3duZXJAZXhhbXBsZS50ZXN0",
    reply: undefined,
  };
}

/** The plan the fake `planSend` seam hands back. */
function sendPlanFixture(): GmailSendPlan {
  return {
    account: "owner@example.test",
    bcc: [],
    body: "the body",
    cc: [],
    digest: DIGEST,
    draftId: "d-1",
    from: "owner@example.test",
    residue: ["nothing here is a delivery guarantee"],
    subject: "a subject",
    threadId: "t-1",
    to: ["someone@example.com"],
  };
}

/** Everything the fake seams recorded, so a test can assert what did and did not happen. */
interface Recorded {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly stored: GmailDraftPlan[];
  readonly sent: GmailSendPlan[];
  readonly stdinReads: number[];
  /** The home each plan or apply seam was handed, in call order, so a test can see none re-resolves its own. */
  readonly homes: (string | undefined)[];
}

/**
 * A fresh record.
 *
 * @returns empty output, diagnostic, stored, sent, stdin-read and seam-home lists for the fake seams to push into
 */
export function recorder(): Recorded {
  return { diagnostics: [], homes: [], out: [], sent: [], stdinReads: [], stored: [] };
}

/**
 * The compose shells' injected deps: fake Gmail plan and apply seams that record into `recorded`, an in-memory door
 * ledger, and a live pid check, each failure switchable by flag.
 *
 * @returns deps bound to this home whose seams succeed unless their `…Fails` flag is set
 */
export function depsFor({
  home,
  recorded,
  stdin = "{}",
  planDraftFails = false,
  planSendFails = false,
  sendFails = false,
}: {
  home: string;
  recorded: Recorded;
  stdin?: string;
  planDraftFails?: boolean;
  planSendFails?: boolean;
  sendFails?: boolean;
}): GmailComposeDeps {
  return {
    applyDraft: async ({ home: seamHome, plan }) => {
      recorded.homes.push(seamHome);
      recorded.stored.push(plan);
      return ok({ draftId: "d-created", plan, residue: ["nothing has been sent"], threadId: "t-1" });
    },
    applySend: async ({ home: seamHome, plan }) => {
      recorded.homes.push(seamHome);
      recorded.sent.push(plan);
      return sendFails
        ? err(GmailErrors.apiFailed({ message: "the send was refused" }))
        : ok({
            labelIds: ["SENT"],
            messageId: "m-sent",
            plan,
            residue: ["delivery is not confirmed"],
            threadId: "t-1",
          });
    },
    doorLedger: memoryDoorLedger().port,
    home: () => home,
    pidAlive: () => true,
    planDraft: async ({ home: seamHome }) => {
      recorded.homes.push(seamHome);
      return planDraftFails
        ? err(GmailErrors.invalidAddress({ message: "the compose form was refused" }))
        : ok(draftPlanFixture());
    },
    planSend: async ({ home: seamHome }) => {
      recorded.homes.push(seamHome);
      return planSendFails ? err(GmailErrors.apiFailed({ message: "no such draft" })) : ok(sendPlanFixture());
    },
    readStdin: async () => {
      recorded.stdinReads.push(1);
      return stdin;
    },
    writeDiagnostic: (line) => recorded.diagnostics.push(line),
    writeOut: (line) => recorded.out.push(line),
  };
}

/** Run one case against a throwaway home, and clean it up afterwards. */
export async function withHome({ run }: { run: (args: { home: string }) => Promise<void> }): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-gmail-compose-"));
  try {
    await run({ home });
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
}
