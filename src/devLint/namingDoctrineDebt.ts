/*
 * The naming-doctrine gate's standing DEBT: every divergence its criterion found on the tree it was written
 * against, each with the one name the concept carries once its rename lands. A REGISTER, so nothing here is
 * logic — `./namingDoctrine.ts` carries the criterion.
 *
 * It only shrinks. A divergence absent from this list fails `naming-doctrine`, and an entry that no longer
 * fires fails it too, so a rename that lands has to delete its row in the same pull request.
 */

/** One measured divergence, keyed exactly as `divergenceIdentity` prints it. */
export interface NamingDoctrineDebt {
  readonly identity: string;
  /** The one name the concept carries once renamed. Never "we will get to it". */
  readonly canonical: string;
}

/**
 * Today's DEBT, measured by `yarn tsx src/devLint/namingDoctrine.entry.ts` over the working tree.
 */
export const NAMING_DOCTRINE_DEBT: readonly NamingDoctrineDebt[] = [];
