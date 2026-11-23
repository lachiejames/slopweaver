/**
 * Every Claude fallback plan and review — the request a visible session was handed and the receipt it
 * recorded — in the store, which is their ONLY authority (`src/codex/fallbackPort.ts`).
 *
 * These rows are rule 9's evidence whenever Codex is capped: without them every branch
 * whose loop was taken as fallbacks reads as never planned and never reviewed, and the landing floor refuses
 * it. A legacy copy is a `$SLOPWEAVER_HOME/codex-fallback/<requestId>/` directory, which no backup holds.
 * The class rule is that fleet-authored state lives in the
 * store, and the home directory is removable — `store import-fleet --only codex-fallback` imports a legacy one
 * once.
 *
 * ## What is here, and the 230 MB that is not
 *
 * MEASURED (repro: `cd ~/.slopweaver/codex-fallback && find . -name receipt.json -print0 | xargs
 * -0 cat | wc -c`, and the same for `request.json`, `review-packet.md`, `plan-packet.md`): 2,396 requests
 * are 3.4 MB, 1,887 receipts 10.6 MB, and the packets 232 MB. A packet is the diff or the prompt a pass
 * READ — reproducible from git and read by no gate — so it stays out, exactly as `codex_pass` leaves each
 * pass's `.scratch` sibling behind (`./runs.ts`).
 *
 * ## Verbatim text, not a parsed document
 *
 * A receipt binds to its request by the digest of the request's EXACT bytes
 * (`src/codex/fallbackReview.ts`'s `receiptBindingFailure`). So both are stored as the text that was on
 * text the session wrote, never re-serialised, and the reader (`src/codex/fallbackDocuments.ts`) runs the
 * parsers and the binding check over each stored pair. The columns beside the text are for a person filtering
 * rows; no reader decides anything from them.
 *
 * ## Two tables, both append-only
 *
 * A request is written by `prepare` and a receipt, exactly once, by `record` — two moments, often minutes
 * apart, and 509 requests on this install were never answered at all. Every write is `DO NOTHING` on the
 * key, so nothing here can overwrite anything: a lost insert is a typed refusal to the writer, never retried,
 * and a legacy file that disagrees with its row is reported by the import rather than silently replaced.
 *
 * The bot is denied both tables outright: a property statement names private code, and a receipt quotes it.
 *
 * ## The reader epoch, and why it is a migration
 *
 * The store is shared by every checkout on a machine, so a request is written by the newest build and read
 * by the oldest. A build that has no parser for a request's mode counts it FOREIGN and skips it
 * (`src/codex/fallbackDocuments.ts`), so a newer BLOCKED plan or BROKEN review in a mode it cannot read
 * would be invisible to it while an older READY or CLEAN row stood. Epoch 2 is the build that closes that
 * class: it refuses a branch carrying an ANSWERED foreign receipt (`src/codex/scanReasons.ts`'s
 * `foreignReceiptScanReason`) rather than judging the survivors. The builds before it cannot be changed, so
 * the column's migration is the fence: once applied, an epoch-1 build reads the database as `foreign` and
 * `connectStore` (`../client.ts`) refuses every verb that connects through it — every reader of this register
 * among them — until that checkout is updated, while an epoch-2 build cannot write a row at all before the
 * migration is applied. So no row in a mode epoch 1 cannot read (`plan-codex-provider-unregistered`,
 * `review-codex-provider-unregistered`) can reach an epoch-1 reader. `store backup` copies the table as
 * `pg_dump` bytes without `connectStore`, and judges nothing in it. `SLOPWEAVER_ALLOW_STALE_STORE=1` opens
 * the fence on purpose, and with it this residue; so does `SLOPWEAVER_ALLOW_STALE_BUILD=1` running an
 * epoch-1 compiled CLI inside a checkout whose journal already carries 0041.
 *
 * One more residue, which no change here can close: the fence is judged when an epoch-1 PROCESS connects,
 * against the journal at its tree's path and the database at that instant, and never again. So an epoch-1
 * process already running when 0041 was APPLIED to the database (whenever it started, if its probe read the
 * database first), or when its own checkout was updated beneath it (it reads the updated journal with old
 * code loaded), can finish the scan it is in. A row an epoch-2 build writes inside that window can reach that one scan. The fence holds from
 * that verb's next invocation on, and the builds that would need an atomic, per-query or load-time check are
 * the ones that cannot be changed.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** The fallback reader epoch this build writes — § "The reader epoch". Raise it with the next fenced mode. */
export const FALLBACK_READER_EPOCH = 2;

/** One fallback request, as `prepare` froze it. */
export const codexFallbackRequestTable = pgTable(
  "codex_fallback_request",
  {
    /** The request's directory name. Text rather than uuid: the key is whatever the directory is called. */
    requestId: text("request_id").primaryKey(),
    /** `request.json`, verbatim — the bytes a receipt's digest binds to. */
    requestText: text("request_text").notNull(),
    /** Lower-case hex sha-256 of `request_text`'s UTF-8 bytes. */
    requestSha256: text("request_sha256").notNull(),
    /**
     * The request's declared `mode` — `plan`, `plan-codex-provider-unregistered`, `review-policy-refusal`,
     * `review-codex-provider-unregistered`, or NULL for a cap-grounded review.
     */
    mode: text("mode"),
    /** The pass slot, `p1`…`r3`, when the request names one. */
    pass: text("pass"),
    repoRoot: text("repo_root"),
    branch: text("branch"),
    /**
     * The fallback reader epoch of the build that wrote the row — § "The reader epoch" above. `1` is every row
     * written before the column existed; {@link FALLBACK_READER_EPOCH} is every row written since.
     */
    readerEpoch: integer("reader_epoch").notNull().default(1),
    /** The request's own `createdAtIso`, when it carries a readable one. */
    createdAt: timestamp("created_at", { mode: "date", precision: 3, withTimezone: true }),
    firstImportedAt: timestamp("first_imported_at", { mode: "date", precision: 3, withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("codex_fallback_request_sha_shape", sql`request_sha256 ~ '^[0-9a-f]{64}$'`),
    // "every fallback on this branch", which is what a person reading the floor asks.
    index("idx_codex_fallback_request_branch_time").on(table.branch, table.createdAt.desc()),
    ...storeTablePolicies({ botRead: sql`false`, table: "codex_fallback_request" }),
  ],
);

/** One fallback receipt, as `record` wrote it — at most one per request. */
export const codexFallbackReceiptTable = pgTable(
  "codex_fallback_receipt",
  {
    requestId: text("request_id")
      .primaryKey()
      .references(() => codexFallbackRequestTable.requestId, { onDelete: "cascade" }),
    /** `receipt.json`, verbatim. */
    receiptText: text("receipt_text").notNull(),
    /** Lower-case hex sha-256 of `receipt_text`'s UTF-8 bytes. */
    receiptSha256: text("receipt_sha256").notNull(),
    firstImportedAt: timestamp("first_imported_at", { mode: "date", precision: 3, withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  () => [
    check("codex_fallback_receipt_sha_shape", sql`receipt_sha256 ~ '^[0-9a-f]{64}$'`),
    ...storeTablePolicies({ botRead: sql`false`, table: "codex_fallback_receipt" }),
  ],
);

/** A request as the database returns it. */
export type CodexFallbackRequestRecord = typeof codexFallbackRequestTable.$inferSelect;

/** A request as an insert takes it. */
export type NewCodexFallbackRequestRecord = typeof codexFallbackRequestTable.$inferInsert;

/** A receipt as the database returns it. */
export type CodexFallbackReceiptRecord = typeof codexFallbackReceiptTable.$inferSelect;

/** A receipt as an insert takes it. */
export type NewCodexFallbackReceiptRecord = typeof codexFallbackReceiptTable.$inferInsert;
