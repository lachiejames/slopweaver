/**
 * Datadog's re-export of the kit's withholding summary.
 *
 * There is nothing Datadog-specific about counting what a projection removed, and there was nothing
 * JumpCloud-specific about it either — which is exactly why the clone ratchet caught the second copy. The
 * summary, the truncation predicate and the coverage sentence all live in `kit/withheld.ts`; this file is
 * the seam that keeps `coverage.ts` reading in its own platform's vocabulary rather than importing three
 * kit symbols by their generic names.
 */
export {
  summariseWithholding as summariseDatadogWithholding,
  withholdingIsTruncated,
  withholdingSentence,
} from "../kit/withheld.js";
