/**
 * Lazy manifest for the `write` noun — the mutations Slopweaver performs at a provider.
 *
 * A noun of its own, and the reason is the atlas contract rather than tidiness. `kit/contract.ts` states
 * that an atlas only ever READS, and lists mutations among what it excludes; a generation records what was
 * observed, never what this machine changed. So a verb that changes state at a provider cannot sit under
 * `atlas <platform>` without contradicting the thing the atlas says about itself.
 *
 * The platform is still the second word here, for the same reason it is the third under `atlas`: the
 * platform is what the verb addresses. `write <platform> <verb>` reads the same way round.
 *
 * Every verb here is `external-write`, door-routed, and declares `requiresApproval` — so the door HOLDS
 * each one unless `--approve` carries the digest of that exact request
 * (`src/atlas/vanta/deactivateApproval.ts` and `reactivateApproval.ts` for the two vulnerability batches,
 * `documentApproval.ts` for the three document writes). That gap used to be real and was registered on the board: the row said `requiresApproval: true`
 * while the verb passed the door's empty default gate list, so nothing asked anyone anything. The row is
 * gone and the gate is real;
 * `src/admit/approval.ts` carries the whole finding.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const writeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  vanta: lazy({
    load: () => import("../commands/write/vantaRun.js").then((m) => m.writeVantaCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      // No-args-safe: a bare `write vanta deactivate` names no finding, so the pure parser refuses it having
      // read no file, consumed no stdin and resolved no credential.
      dryParseSafe: true,
      effect: "external-write",
      example: 'slopweaver write vanta deactivate --ids v_123 --reason "not reachable in our usage" --dry-run',
      parseRejectIsIoFree: true,
      summary:
        "Change state at Vanta: stop or resume monitoring findings, move people into and out of a group, create, " +
        "attach evidence to and submit an evidence document, apply one exact substitution to a policy " +
        "draft in the owner's own Chrome, or upload a policy's markdown as a DRAFT version. Kept out " +
        "of the atlas because an atlas only ever reads",
      usage:
        "usage: slopweaver write vanta <create-document | deactivate | edit-policy-draft | group-people |\n" +
        "       reactivate | submit-document | upload-evidence | upload-policy-version>\n" +
        "  group-people --group <group-id> [--add <person-id>]... [--remove <person-id>]...\n" +
        "       [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
        "       [--client-id-file <path>] [--client-secret-file <path>]\n" +
        "  deactivate (--ids <id[,id...]> --reason <text> | --form <path|->) [--until <iso-date>]\n" +
        "       [--reactivate-when-fixable] [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
        "       [--client-id-file <path>] [--client-secret-file <path>]\n" +
        "  reactivate --ids <id[,id...]> [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
        "       [--client-id-file <path>] [--client-secret-file <path>]\n" +
        "  create-document --title <text> --description <text> [--cadence <iso-duration>]\n" +
        "       [--reminder-window <iso-duration>] [--time-sensitivity MOST_RECENT|DURING_AUDIT_WINDOW]\n" +
        "       [--sensitive] [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
        "       [--client-id-file <path>] [--client-secret-file <path>]\n" +
        "  upload-evidence --document <id> --file <path> [--description <text>] [--effective-at <iso-date>]\n" +
        "       [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
        "       [--client-id-file <path>] [--client-secret-file <path>]\n" +
        "  submit-document --document <id> [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
        "       [--client-id-file <path>] [--client-secret-file <path>]\n" +
        "  edit-policy-draft --policy <id> --find <text> --replace <text> [--tenant <slug>]\n" +
        "       [--approve <digest>] [--dry-run] [--shot <path>] [--json] [--home <dir>]\n" +
        "  upload-policy-version --policy <id> --file <path.md> [--source-commit <sha>] [--tenant <slug>]\n" +
        "       [--approve <digest>] [--dry-run] [--json] [--home <dir>]",
    },
  }),
};
