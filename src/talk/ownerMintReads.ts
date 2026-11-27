/**
 * The order an owner's mint reads its state in, held in one place so it can be pinned. The stored pack and the
 * supervisor window are read FIRST, and only then is the mint's instant stamped and the continuity read made at it, so
 * the continuity window ends where that read starts rather than before two slower reads ahead of it. The mint's
 * instant is the continuity read's own, never a clock read of the caller's.
 *
 * Every read is passed in, so `../cli/commands/talk/offerRun.ts` hands the live ones and a test hands plain fakes that
 * record when each ran. Owns no I/O itself.
 */

/**
 * Read an owner's mint state in its one order: the pack, the supervisor window, the clock, then the continuity read at
 * that instant.
 *
 * @param readPack the stored context pack's read
 * @param readSupervisor the supervisor window's read
 * @param now the clock, read once, after both reads above
 * @param readContinuityAt the continuity read, given the instant and the supervisor window it composes with
 * @returns what each read returned, and the mint's instant taken from the continuity read
 */
export async function readOwnerMintState<Pack, Supervisor, Continuity extends { readonly builtIso: string }>({
  now,
  readContinuityAt,
  readPack,
  readSupervisor,
}: {
  now: () => string;
  readContinuityAt: (at: { nowIso: string; supervisor: Supervisor }) => Promise<Continuity>;
  readPack: () => Pack;
  readSupervisor: () => Supervisor;
}): Promise<{ builtIso: string; continuity: Continuity; pack: Pack; supervisor: Supervisor }> {
  const pack = readPack();
  const supervisor = readSupervisor();
  const continuity = await readContinuityAt({ nowIso: now(), supervisor });
  return { builtIso: continuity.builtIso, continuity, pack, supervisor };
}
