/**
 * JumpCloud's re-export of the kit's withholding summary.
 *
 * This file used to hold the implementation. It moved to `kit/withheld.ts` when the Datadog atlas landed a
 * byte-for-byte second copy and the clone ratchet refused it: nothing in counting what a projection removed
 * was ever JumpCloud's, and the two denial reasons are kit vocabulary. The re-export is what keeps
 * `coverage.ts` reading in its own platform's names.
 */
export {
  summariseWithholding as summariseJumpcloudWithholding,
  withholdingIsTruncated,
  withholdingSentence,
} from "../kit/withheld.js";
