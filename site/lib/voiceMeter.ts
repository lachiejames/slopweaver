/**
 * How loud the floating voice orb is: a ten-bar level meter, carried over from the widget the owner authored in
 * `slopweaver-archive`. Which STATE the orb shows is `./voiceActivity.ts`, a fold over what the session
 * reports. Pure, so what the owner sees is a unit test rather than a guess about timers.
 */

/** How many bars the meter draws — the archive widget's ten. */
export const LEVEL_BARS = 10;

/** Below this output level the voice counts as quiet: the floor a silent WebRTC track sits at. */
export const SPEAKING_LEVEL = 0.04;

/**
 * Fold an analyser's frequency bins into the meter's bars, each 0 to 1.
 *
 * Only the lower half of the spectrum is used: speech energy sits there, and bars over the empty upper
 * half would sit flat and read as a broken meter.
 *
 * @param bins `AnalyserNode.getByteFrequencyData` output, each 0 to 255
 * @param bars how many bars to fold into
 * @returns the bar heights, always `bars` long
 */
export function levelBars({ bins, bars }: { bins: ArrayLike<number>; bars: number }): readonly number[] {
  const used = Math.floor(bins.length / 2);
  const values = Array.from(bins);
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor((bar * used) / bars);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * used) / bars));
    const window = values.slice(from, to);
    const sum = window.reduce((total, value) => total + value, 0);
    out.push(window.length === 0 ? 0 : sum / window.length / 255);
  }
  return out;
}

/**
 * One number for "is it making sound": the mean of the bars.
 *
 * @param bars the meter's bar heights
 * @returns the level, 0 to 1
 */
export function overallLevel({ bars }: { bars: readonly number[] }): number {
  if (bars.length === 0) {
    return 0;
  }
  return bars.reduce((sum, bar) => sum + bar, 0) / bars.length;
}

/**
 * The signal's own loudness: the root mean square of a time-domain read, 0 for silence and 1 for a full-scale square
 * wave. Unlike {@link overallLevel}, which says where a spectrum sits inside the analyser's decibel window (by default
 * -100 to -30 dB, so 0.04 is about -97 dB and a quiet hiss reads as talk), this does not move with that window — the
 * number the cue trace records beside it, so a call measures which one a quiet room trips.
 *
 * @param samples `AnalyserNode.getByteTimeDomainData` output, each 0 to 255 with silence at 128
 * @returns the RMS level, 0 to 1; 0 for no samples
 */
export function waveformLevel({ samples }: { samples: ArrayLike<number> }): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of Array.from(samples)) {
    const centred = (sample - 128) / 128;
    sum += centred * centred;
  }
  return Math.sqrt(sum / samples.length);
}
