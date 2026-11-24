/**
 * Seed a throwaway home with one waiting private-terms proposal (`../hygiene/privateTermsStore.ts`), decided over the
 * terms file exactly as it stands, through the store's own writer. The row it would land is synthetic.
 */
import { PRIVATE_TERMS_HEADER_V2 } from "../hygiene/privateTerms.js";
import { type PrivateTermsProposalAction, privateTermsBaseSha256 } from "../hygiene/privateTermsProposal.js";
import { readCurrentPrivateTerms, writePrivateTermsProposal } from "../hygiene/privateTermsStore.js";
import { unwrap } from "../lib/result.js";

/** The synthetic pattern every seeded proposal's text carries, so a test can assert it is never printed. */
export const SEEDED_PATTERN = "quillfeather";

/** The synthetic meaning every seeded proposal's text carries. */
export const SEEDED_MEANING = "a colleague at acme";

/**
 * The whole new file a seeded proposal would land: the seven-cell header and one synthetic row.
 *
 * @param termId the row's id
 * @returns the file text
 */
function seededProposalText({ termId }: { termId: string }): string {
  return `${PRIVATE_TERMS_HEADER_V2}\n${termId}\tperson\ti\t${SEEDED_PATTERN}\t${SEEDED_MEANING}\tnowhere\trelay:acme-row\n`;
}

/**
 * Keep one proposal under a home, its base the digest of the terms file as it stands now (null when absent).
 *
 * @param home the throwaway state home
 * @param proposalId the `pp-` id to keep it under
 * @param termId the row the proposal changes
 * @param action what it does; `add` when omitted
 * @param createdAtIso when it was made, which orders `list`; a fixed instant when omitted
 * @returns the path the proposal is kept at
 */
export function seedPrivateTermsProposal({
  home,
  proposalId,
  termId,
  action = "add",
  createdAtIso = "2026-11-22T00:00:00.000Z",
}: {
  home: string;
  proposalId: string;
  termId: string;
  action?: PrivateTermsProposalAction;
  createdAtIso?: string;
}): string {
  const state = unwrap(readCurrentPrivateTerms({ home }));
  return unwrap(
    writePrivateTermsProposal({
      home,
      proposal: {
        action,
        baseSha256: privateTermsBaseSha256({ state }),
        createdAtIso,
        proposalId,
        schemaVersion: 1,
        termId,
        text: seededProposalText({ termId }),
      },
    }),
  );
}
