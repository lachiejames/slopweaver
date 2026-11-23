/**
 * The help-truth tables' rows for `store`'s backup, import and restore verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  parseAuthoredListArgs,
  parseAuthoredRestoreArgs,
  parseAuthoredShowArgs,
} from "../../../../cli/commands/store/authoredCore.js";
import {
  parseStoreBackupArgs,
  parseStoreBackupRegisterArgs,
  parseStoreRestoreArgs,
  STORE_BACKUP_FLAG_NAMES,
  STORE_BACKUP_REGISTER_FLAG_NAMES,
  STORE_RESTORE_FLAG_NAMES,
} from "../../../../cli/commands/store/backupCore.js";
import { parseStoreIngestArgs, STORE_INGEST_FLAG_NAMES } from "../../../../cli/commands/store/core.js";
import { storeCommandErrorLines } from "../../../../cli/commands/store/errors.js";
import {
  parseStoreImportQuestionsArgs,
  parseStoreImportResolveArgs,
  STORE_IMPORT_QUESTIONS_FLAGS,
  STORE_IMPORT_RESOLVE_FLAGS,
} from "../../../../cli/commands/store/importArgs.js";
import { parseBaselineArgs, parsePushArgs, parseResetArgs } from "../../../../cli/commands/store/lifecycleArgs.js";
import { parseStoreLoadArgs, STORE_LOAD_FLAG_NAMES } from "../../../../cli/commands/store/loadCore.js";
import { parseLockArgs } from "../../../../cli/commands/store/lockCore.js";
import {
  MEASUREMENT_LIST_FLAG_SPEC,
  MEASUREMENT_RESTORE_FLAG_SPEC,
  MEASUREMENT_SHOW_FLAG_SPEC,
  parseMeasurementListArgs,
  parseMeasurementRestoreArgs,
  parseMeasurementShowArgs,
} from "../../../../cli/commands/store/measurementCore.js";
import { parseStoreRecoverArgs, STORE_RECOVER_FLAG_NAMES } from "../../../../cli/commands/store/recoverCore.js";
import { parseStoreRehearseArgs, STORE_REHEARSE_FLAG_NAMES } from "../../../../cli/commands/store/rehearseCore.js";
import { parseStoreShareArgs } from "../../../../cli/commands/store/shareRun.js";
import {
  parseStoreExportArgs,
  parseStoreImportArgs,
  STORE_EXPORT_FLAGS,
  STORE_IMPORT_FLAGS,
} from "../../../../cli/commands/store/transferArgs.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags, flagNamesOf, parseFlagsNamesOf } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "store ingest": STORE_INGEST_FLAG_NAMES,
  "store load": STORE_LOAD_FLAG_NAMES,
  "store backup": STORE_BACKUP_FLAG_NAMES,
  "store backup-register": STORE_BACKUP_REGISTER_FLAG_NAMES,
  // The owned-state export and its check. Each closed flag set is its parser's own spec.
  "store export": parseFlagsNamesOf({ spec: STORE_EXPORT_FLAGS }),
  "store import": parseFlagsNamesOf({ spec: STORE_IMPORT_FLAGS }),
  "store import-resolve": parseFlagsNamesOf({ spec: STORE_IMPORT_RESOLVE_FLAGS }),
  "store import-questions": parseFlagsNamesOf({ spec: STORE_IMPORT_QUESTIONS_FLAGS }),
  "store restore": STORE_RESTORE_FLAG_NAMES,
  "store rehearse": STORE_REHEARSE_FLAG_NAMES,
  "store recover": STORE_RECOVER_FLAG_NAMES,
  "store share": ["--home", "--json"],
  // The authored working state read back. Closed flag sets off pure parsers in
  // `src/cli/commands/store/authoredCore.ts`.
  "store authored-list": ["--directory", "--home", "--json"],
  "store authored-show": ["--ref", "--out", "--home"],
  "store authored-restore": ["--directory", "--dry-run", "--home", "--json"],
  // The measurement readers. Each closed flag set is its core's own spec, so help and parser cannot drift.
  "store measurement-list": flagNamesOf({ spec: MEASUREMENT_LIST_FLAG_SPEC }),
  "store measurement-restore": flagNamesOf({ spec: MEASUREMENT_RESTORE_FLAG_SPEC }),
  "store measurement-show": flagNamesOf({ spec: MEASUREMENT_SHOW_FLAG_SPEC }),
  // The lifecycle. Closed flag sets off pure parsers in `src/cli/commands/store/lifecycleArgs.ts`.
  "store push": ["--no-generate", "--home", "--json"],
  "store baseline": ["--through", "--home", "--json"],
  "store reset": ["--acknowledge", "--home", "--json"],
  "store lock": ["--rotate", "--workdir", "--home", "--json"],
  "store start": ["--rotate", "--workdir", "--home", "--json"],
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "store share": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "store authored-list": {
    "--directory": ["--directory", "briefs"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "store authored-show": {
    "--home": ["--home", "/tmp"],
    "--out": ["--out", "/tmp/brief.md"],
    "--ref": ["--ref", "briefs/x.md"],
  },
  "store authored-restore": {
    "--directory": ["--directory", "briefs"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "store measurement-list": {
    "--class": ["--class", "proof"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--prefix": ["--prefix", "proof/1263"],
  },
  "store measurement-restore": {
    "--class": ["--class", "evidence"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--into": ["--into", "/tmp/restored"],
    "--json": ["--json"],
    "--prefix": ["--prefix", "evidence/cli"],
  },
  "store measurement-show": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--out": ["--out", "/tmp/shot.png"],
    "--ref": ["--ref", "proof/1263/gold.md"],
  },
  "store push": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--no-generate": ["--no-generate"],
  },
  "store baseline": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--through": ["--through", "0000_polite_lady_mastermind"],
  },
  "store reset": {
    "--acknowledge": ["--acknowledge", "lifecycle_proof"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "store lock": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--rotate": ["--rotate"],
    "--workdir": ["--workdir", "/tmp"],
  },
  "store start": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--rotate": ["--rotate"],
    "--workdir": ["--workdir", "/tmp"],
  },
  "store backup": {
    "--add-destination": ["--add-destination", "/Volumes/Backup/slopweaver"],
    "--check": ["--check"],
    "--copy-master-password": ["--copy-master-password"],
    "--create-key": ["--create-key"],
    "--create-master-password": ["--create-master-password"],
    "--destination": ["--destination", "/Volumes/Backup/slopweaver"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--keep-local": ["--keep-local", "2"],
    "--local-only": ["--local-only"],
    "--remove-destination": ["--remove-destination", "/Volumes/Backup/slopweaver"],
    "--set-destination": ["--set-destination", "/Volumes/Backup/slopweaver"],
    "--status": ["--status"],
    "--sweep-only": ["--sweep-only"],
  },
  "store export": {
    "--home": ["--out", "/x", "--home", "/tmp"],
    "--json": ["--out", "/x", "--json"],
    "--out": ["--out", "/x"],
  },
  "store import": {
    "--apply": ["--apply", "00000000-0000-4000-8000-0000000000d4"],
    "--approve": ["--from", "/x", "--approve", `sha256:${"a".repeat(64)}`],
    "--from": ["--from", "/x"],
    "--home": ["--from", "/x", "--home", "/h"],
    "--json": ["--from", "/x", "--json"],
    "--stop-on-conflict": ["--apply", "00000000-0000-4000-8000-0000000000d4", "--stop-on-conflict"],
    "--unmanifested": ["--from", "/x", "--unmanifested"],
  },
  "store import-resolve": {
    "--action": ["--question", "import-q-0123456789abcdef", "--action", "activate"],
    "--home": ["--question", "import-q-0123456789abcdef", "--action", "activate", "--home", "/h"],
    "--json": ["--question", "import-q-0123456789abcdef", "--action", "activate", "--json"],
    "--question": ["--question", "import-q-0123456789abcdef", "--action", "activate"],
  },
  "store import-questions": {
    "--home": ["--home", "/h"],
    "--json": ["--json"],
  },
  "store backup-register": {
    "--cadence": ["--cadence", "0 3 * * *"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "store restore": {
    "--compare": ["--from", "/x", "--into", "proof", "--compare"],
    "--drop-after": ["--from", "/x", "--into", "proof", "--drop-after"],
    "--files-into": [
      "--from",
      "/Volumes/Backup/slopweaver/slopweaver/2026-09-27T18-32-20-978Z",
      "--into",
      "proof",
      "--files-into",
      "/tmp/rebuilt",
    ],
    "--from": ["--from", "/x", "--into", "proof"],
    "--home": ["--from", "/x", "--into", "proof", "--home", "/tmp"],
    "--into": ["--from", "/x", "--into", "proof"],
    "--json": ["--from", "/x", "--into", "proof", "--json"],
    "--overwrite-storage": ["--from", "/x", "--into", "proof", "--storage", "--overwrite-storage"],
    "--secrets-into": ["--from", "/x", "--into", "proof", "--secrets-into", "/tmp/credentials"],
    "--storage": ["--from", "/x", "--into", "proof", "--storage", "--overwrite-storage"],
  },
  "store rehearse": {
    "--container": ["--container", "rehearsal_two"],
    "--destination": ["--destination", "/Volumes/Backup/slopweaver"],
    "--from": ["--from", "slopweaver/2026-09-27T18-32-20-978Z/"],
    "--home": ["--home", "/tmp"],
    "--into": ["--into", "rehearsal_two"],
    "--json": ["--json"],
    "--keep": ["--keep"],
    "--no-record": ["--no-record"],
    "--port": ["--port", "55433"],
    "--sample-size": ["--sample-size", "10"],
  },
  "store recover": {
    "--destination": ["--destination", "/Volumes/Backup/slopweaver"],
    "--dry-run": ["--dry-run"],
    "--from": ["--from", "slopweaver/2026-09-27T18-32-20-978Z/"],
    "--home": ["--home", "/tmp"],
    "--into": ["--into", "store_recovered_two"],
  },
  "store load": {
    "--cap": ["--cap", "100"],
    "--days": ["--days", "7"],
    "--github-org": ["--github-org", "an-org"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--source": ["--source", "slack"],
  },
  "store ingest": {
    "--all": ["--all"],
    // `--from` and `--from-file` are mode-specific and REFUSED in the other mode, so each probe carries
    // the target it belongs with rather than leaning on the other probe's default.
    "--from": ["--from", "0", "--file", "a.jsonl"],
    "--from-file": ["--from-file", "compact.jsonl", "--source", "slack"],
    // Both resume probes carry their own target, because displacing the base's `--file` leaves the
    // invocation with nothing naming what to read.
    "--file": ["--file", "a.jsonl"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--source": ["--source", "slack"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "store share": ({ fragment }) => parseStoreShareArgs({ rest: fragment }),
  "store ingest": ({ fragment }) =>
    parseStoreIngestArgs({
      rest: [...dedupeFlags({ base: ["--file", "a.jsonl", "--limit", "10"], fragment })],
    }).mapErr((error) => storeCommandErrorLines({ error })),
  "store load": ({ fragment }) =>
    parseStoreLoadArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store backup": ({ fragment }) => parseStoreBackupArgs({ rest: [...fragment] }),
  "store export": ({ fragment }) =>
    parseStoreExportArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store import": ({ fragment }) =>
    parseStoreImportArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store import-resolve": ({ fragment }) => parseStoreImportResolveArgs({ rest: [...fragment] }),
  "store import-questions": ({ fragment }) => parseStoreImportQuestionsArgs({ rest: [...fragment] }),
  "store backup-register": ({ fragment }) =>
    parseStoreBackupRegisterArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store restore": ({ fragment }) => parseStoreRestoreArgs({ rest: [...fragment] }),
  "store rehearse": ({ fragment }) =>
    parseStoreRehearseArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store recover": ({ fragment }) =>
    parseStoreRecoverArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store authored-list": ({ fragment }) => parseAuthoredListArgs({ rest: [...fragment] }),
  "store authored-show": ({ fragment }) => parseAuthoredShowArgs({ rest: [...fragment] }),
  "store authored-restore": ({ fragment }) => parseAuthoredRestoreArgs({ rest: [...fragment] }),
  // --ref and --into are required by the shell, not the parser, so every probe is the fragment alone.
  "store measurement-list": ({ fragment }) => parseMeasurementListArgs({ rest: [...fragment] }),
  "store measurement-restore": ({ fragment }) => parseMeasurementRestoreArgs({ rest: [...fragment] }),
  "store measurement-show": ({ fragment }) => parseMeasurementShowArgs({ rest: [...fragment] }),
  "store push": ({ fragment }) => parsePushArgs({ rest: [...fragment] }),
  "store baseline": ({ fragment }) =>
    parseBaselineArgs({
      rest: [...dedupeFlags({ base: ["--through", "0000_polite_lady_mastermind"], fragment })],
    }).mapErr((error) => storeCommandErrorLines({ error })),
  "store reset": ({ fragment }) => parseResetArgs({ rest: [...fragment] }),
  "store lock": ({ fragment }) => parseLockArgs({ rest: [...fragment] }),
  "store start": ({ fragment }) => parseLockArgs({ rest: [...fragment] }),
};

/** The rows for `store`'s backup, import and restore verbs. */
export const storeBackupSlice: HelpTruthSlice = { guarded, probes, parsers };
