/**
 * What a call the desktop test instance placed (`talk offer --test-instance e2e`) is minted with: the base instructions,
 * its mode's own opener, and nothing of the owner's.
 *
 * The cut is made BEFORE any owner state is read, never as a list of halves a shared read opts out of. A test call may
 * run beside the owner's typed conversation at rest (`site/lib/talkArbiter.ts`), and its context, its transcript and a
 * proof's capture are all places a line of the owner's would be repeated. So `../cli/commands/talk/offerRun.ts` picks
 * this arm first and then reads nothing the owner's arm reads: no continuity (steers, relays, typed turns, rulings, call
 * records, lessons), no supervisor window, no stored pack, no voice brief, no desktop update record. This arm is built
 * from the mode and the mint's instant alone, so a half added to the owner's read later can never reach it.
 *
 * Pure.
 */
import { type MintMode, testInstanceOpener } from "./mintOpener.js";

/** Why a test call carries none of what an owner's call carries, said in its report. */
export const TEST_INSTANCE_LEFT_OUT = "a desktop test instance's call carries no owner state";

/** A desktop test instance's mint. */
export interface TestInstanceMint {
  readonly kind: "test-instance";
  /** The mint's instant, which the armed `call-reopen` window is judged at. */
  readonly builtIso: string;
  /** Nothing rides the delegated model's instructions past the base ones. */
  readonly context: undefined;
  readonly opener: string | undefined;
  readonly pack: { readonly kind: "left-out"; readonly why: string };
  readonly voiceBrief: { readonly kind: "left-out"; readonly bytes: 0; readonly why: string };
}

/**
 * The test instance's mint, from its mode and instant alone.
 *
 * @param mode whether the test pressed start, or the console is re-opening a dropped call or rolling one over
 * @param builtIso the mint's instant
 * @returns the mint, every owner-derived part left out with the reason its report says
 */
export function testInstanceMint({ mode, builtIso }: { mode: MintMode; builtIso: string }): TestInstanceMint {
  return {
    builtIso,
    context: undefined,
    kind: "test-instance",
    opener: testInstanceOpener({ mode }),
    pack: { kind: "left-out", why: TEST_INSTANCE_LEFT_OUT },
    voiceBrief: { bytes: 0, kind: "left-out", why: TEST_INSTANCE_LEFT_OUT },
  };
}
