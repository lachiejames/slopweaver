/**
 * A console call's two audio ends on the page: the meter on a stream the orb reads its level from, and the voice's
 * incoming track played through the shell's hidden speaker. Split out of `VoiceProvider.tsx`, which owns the context,
 * the speaker and the refs; these only wire one stream each.
 */

/** The bins a meter reads — few, since the orb wants a level, not a spectrum. */
const METER_FFT_SIZE = 64;

/**
 * A meter on one stream.
 *
 * @param context the call's audio context
 * @param stream the stream to read the level of — the owner's microphone, or the voice's track
 * @returns the analyser the orb reads
 */
export function meterOf({ context, stream }: { context: AudioContext; stream: MediaStream }): AnalyserNode {
  const meter = context.createAnalyser();
  meter.fftSize = METER_FFT_SIZE;
  context.createMediaStreamSource(stream).connect(meter);
  return meter;
}

/**
 * Play the voice's incoming track through the speaker, and meter it.
 *
 * @param event the peer's track event
 * @param speaker the shell's hidden audio element, `null` before it mounts
 * @param context the call's audio context, `undefined` once the call released it
 * @returns the voice's meter, or `undefined` when there was nothing to play or no context to meter it on
 */
export function playVoiceTrack({
  event,
  speaker,
  context,
}: {
  event: RTCTrackEvent;
  speaker: HTMLAudioElement | null;
  context: AudioContext | undefined;
}): AnalyserNode | undefined {
  const stream = event.streams[0];
  // `streams` is typed non-empty and is not: a renegotiation's track event carries none.
  // oxlint-disable-next-line no-unnecessary-condition
  if (speaker === null || stream === undefined) {
    return undefined;
  }
  speaker.srcObject = stream;
  void speaker.play().catch(() => {
    // Autoplay refused; the widget's own click is a gesture, so this is rare and not a session failure.
  });
  if (context === undefined) {
    return undefined;
  }
  return meterOf({ context, stream });
}
