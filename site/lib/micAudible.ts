/**
 * Whether the owner's microphone carries them talking: the ONE answer every decision about their sound reads — the orb's
 * talking phases (`./voiceTalking.ts`), the barge-in fold's stretch of them (`./voiceTurnTaking.ts`), the page asking
 * the voice to take its turn (`resumeDueOf`, `./voiceResumeDecision.ts`) and the page's own press over a promise
 * (`promiseDueOf`, `./voiceOwed.ts`).
 *
 * One answer because two disagreed: the orb read the silence as nobody talking and drew ZZZ, while the resume read the
 * same silence through the spectral level alone, which a quiet room clears, and so never asked the voice to take its
 * turn, leaving the orb on ZZZ until the owner spoke. Repro, from the home — every sample the cue trace logged on such
 * a call, a quiet room's reading spectral 0.07 to 0.47 with an RMS near 0.005, and no `resume` line between
 * <window-start> and <window-end>:
 * `grep -o '(mic [0-9.]* rms [0-9.]*' talk/calls/<call-id>-*.jsonl | sort | uniq -c` and
 * `grep -c '"name":"resume"' talk/calls/<call-id>-*.jsonl`.
 */

/** At or above this microphone level the owner counts as talking, before any transcript arrives — with {@link HEARING_RMS}. */
export const HEARING_LEVEL = 0.04;

/**
 * At or above this microphone RMS (`./voiceMeter.ts`'s `waveformLevel`, where one 8-bit step is 0.0078) the owner counts
 * as talking, and below it the spectral {@link HEARING_LEVEL} alone never says so. That level sits in the analyser's
 * -100..-30 dB window, so a quiet room reads 0.05 to 0.49 on it: across four measured calls, 101 of the 113 cues held
 * for the owner's microphone read an RMS under 0.02 — they heard almost no cue — while the samples that look like
 * speech read 0.03 to 0.14. Provisional: no held sample is ground-truthed as speech. Repro, from the home:
 * `grep -ho 'held: .* microphone was loud (mic [0-9.]* rms [0-9.]*' talk/calls/{<call-a>,<call-b>,<call-c>,<call-d>}-*.jsonl | sed 's/.*rms //' | cut -c1-4 | sort | uniq -c`
 */
export const HEARING_RMS = 0.02;

/**
 * Whether one sample of the owner's microphone is the owner talking: open, and clear of BOTH bars, so a quiet room whose
 * spectrum reads loud is never them.
 *
 * @param micLevel the microphone's spectral level, 0 to 1
 * @param micRms the microphone's waveform RMS on the same sample
 * @param muted whether the session acknowledged the owner's mute, so the microphone counts for nothing
 * @returns true when the sample is the owner audibly talking
 */
export function micAudible({ micLevel, micRms, muted }: { micLevel: number; micRms: number; muted: boolean }): boolean {
  return !muted && micLevel >= HEARING_LEVEL && micRms >= HEARING_RMS;
}
