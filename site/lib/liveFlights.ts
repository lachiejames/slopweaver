/**
 * One child process per verb in flight, however many readers ask for it — pure bookkeeping, so the rule is a test.
 *
 * Every `/api/live` read is a child process (`spawnVerb.ts`), and every console tab, the desktop app and the Queue
 * badge on each of them poll the same slugs. Two readers asking for the same verb while one read of it is already
 * running get that read's answer: it is as fresh as anything a second process would print, and the second process is
 * what the machine — already running the fleet — pays for (`slopweaver perf console` § verbs).
 *
 * Joining is never allowed to answer a write with a reading from before it. A press re-reads with `fresh`
 * (`site/components/live/useLive.ts`), and a fresh read never rides: it starts its own flight, which every later
 * plain read then joins. Comparing start times instead would let two reads in the same clock millisecond pass for
 * one before and one after a write. Nothing is kept once a flight lands: this is
 * coalescing, not a cache, so no reader is ever handed an answer older than the read it asked for.
 *
 * A press through this server's act route forgets every flight once it has written ({@link forgetFlights}), so no tab
 * — one opened after the pressing tab closed included — rides a read from before it.
 *
 * What neither covers, on purpose (refused): a write this server did not make. A fleet session
 * writing the register from the CLI reaches a tab only through that tab's next poll — on main as here, since a verb process that started a millisecond before a write prints the state before it.
 * Riding stretches that window by at most one flight, because every flight that left after the write is a reading
 * of it, and the answer carries its own flight's stamp rather than the rider's instant.
 */

/** One verb read under way. */
export interface Flight<T> {
  readonly answer: Promise<T>;
}

/** Every flight under way, by verb. */
export type Flights<T> = Map<string, Flight<T>>;

/**
 * Let no later reader ride a flight under way now: called once an act has written, so a read that left before the write
 * answers only the readers already riding it, and every read asked for after starts its own. A tab that never pressed
 * — a console window opened after the one that settled an act has closed — would otherwise ride a pre-write read and
 * draw the act as open. Each flight still lands and removes only its own entry.
 *
 * @param flights the server's flights
 */
export function forgetFlights<T>({ flights }: { flights: Flights<T> }): void {
  flights.clear();
}

/**
 * Ride the read of `key` already under way, or start one.
 *
 * @param flights the server's flights
 * @param key the verb's slug
 * @param fresh the reader knows the register just moved, so no flight already under way will do
 * @param run starts the read
 * @returns the answer, and whether this reader rode another's flight
 */
export function rideOrRun<T>({
  flights,
  key,
  fresh,
  run,
}: {
  flights: Flights<T>;
  key: string;
  fresh: boolean;
  run: () => Promise<T>;
}): { answer: Promise<T>; rode: boolean } {
  const under = flights.get(key);
  if (under !== undefined && !fresh) {
    return { answer: under.answer, rode: true };
  }
  const answer = run();
  const flight: Flight<T> = { answer };
  flights.set(key, flight);
  const land = (): void => {
    // Only this flight's own entry is removed: a fresh read may already have replaced it.
    if (flights.get(key) === flight) {
      flights.delete(key);
    }
  };
  answer.then(land, land);
  return { answer, rode: false };
}
