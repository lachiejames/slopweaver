/**
 * What this install is costing the DISK — the volume's own numbers, and how many worktrees are registered
 * against each declared main checkout.
 *
 * ## Why this is in the capacity report at all
 *
 * `slopweaver machine capacity` is the reading the briefing's "machine" fold is parsed from
 * (`supervisor/tickDraftSources.ts`), so a fact that is not in this report cannot reach the page. And the
 * page needed one: the fold rendered `disk N% used` off `compressor.segmentsPct` — the memory compressor's
 * SEGMENT usage, which is not a disk number at all and does not become one by being labelled. That sentence
 * was false every time it was written.
 *
 * Worktree registrations sit beside it because they are what a reader can act on. A volume at 93% is a
 * problem with no next step; 766 registrations against a repository whose every worktree carries its own
 * `node_modules` names `slopweaver worktree prune` as the step, and 17 of them says nothing is owed.
 *
 * ## Below the floor it HOLDS discretionary seating, and never seats an investigation
 *
 * The volume's free space below `diskFloorFor` (`./capacityHolds.ts`) is the `disk` HOLD
 * subject. Like `boots`, it stops discretionary seating — the idle-capacity seats, a tick's supervisor spawns, the seat
 * ceiling's headroom — and is never a standing machine hold: it seats no investigation (which would itself
 * cut a worktree onto the full volume), refuses no load dispatch, and blocks no `--wait`, because nothing
 * frees disk while a spawn waits. The remedy is `slopweaver worktree prune --apply`, which imports nothing
 * from capacity, so the hold can never block its own cure: the hourly `worktree-prune` row runs it, and the
 * sweep brings it forward on a tick that sees the hold (`skills/supervisor/reference/sweep-contract.md`).
 * The close-done reclaim does not read this number: it removes its own one tree on the routine brakes.
 *
 * ## REGISTRATIONS, not directories
 *
 * `git worktree list` is what the count reads, because a registration is what `worktree prune` can clear —
 * including the `gone` class, a record git carries for a directory that no longer exists. The two genuinely
 * differ: acme-admin held 104 registrations against 89 directories, and a count of directories
 * would report fifteen trees as already dealt with while git still carried them.
 *
 * Pure: text in, a reading out. The subprocesses are `./read.ts`.
 */

/** One volume's own numbers, as `df -k` reports them. */
export interface VolumeReading {
  /** Total 1 KiB blocks on the volume. */
  readonly totalKib: number;
  /** Blocks available to this user. */
  readonly availableKib: number;
  /**
   * `df`'s own Capacity column — the percent the owner sees in Finder and in `df -h`.
   *
   * Read rather than derived, because `used / total` is NOT it: this volume reported 878244236 used of
   * 971298980 blocks with 71239176 available, which is 90% by division and 93% by capacity.
   * `df` divides by used-plus-available, excluding the reserved blocks nothing can allocate. A number three
   * points below what the owner can read off the machine is the same class of quietly-wrong this module
   * replaced (repro: `df -k "$SLOPWEAVER_HOME"; df -h "$SLOPWEAVER_HOME"`).
   */
  readonly usedPct: number;
}

/** One declared main checkout's registration count, or the fact that it could not be read. */
export interface RepoWorktreeCount {
  readonly repoRoot: string;
  /** Registrations `git worktree list` reported, or `null` when the repository could not be read. */
  readonly registered: number | null;
}

/** The whole disk reading. */
export interface DiskReading {
  /** The volume the state home sits on, or `undefined` when `df` could not be read. */
  readonly volume: VolumeReading | undefined;
  /** One entry per declared main checkout, in the order the profile declares them. */
  readonly repos: readonly RepoWorktreeCount[];
  /**
   * Registrations across every repository that ANSWERED, or `undefined` when none did.
   *
   * `undefined` rather than `0`, because a zero here would say this install has no worktrees when what
   * happened is that nothing could be counted — the same rule every `null` fact in `worktree/pruneClassify.ts`
   * keeps, for the same reason.
   */
  readonly registeredTotal: number | undefined;
}

/**
 * The volume's free space in GB, to one decimal — the unit the rest of this report states sizes in.
 *
 * GB rather than GiB, and the blocks are KiB, so the conversion is `× 1024 / 10^9` and not `/ 10^6`. The
 * difference is 2.4%, which is small enough to look right and be wrong: this volume's 71239176 available
 * blocks are 73.0 GB, and `/ 10^6` calls them 71.2 (repro: `df -k "$SLOPWEAVER_HOME"`). GB is the unit
 * because it is the one Finder reports, and this whole module exists because a number on the page did not
 * mean what it was labelled.
 *
 * @param volume the parsed reading, or `undefined` when `df` could not be read
 * @returns the free space, or `undefined` when there is no reading to convert
 */
export function volumeFreeGb({ volume }: { readonly volume: VolumeReading | undefined }): number | undefined {
  if (volume === undefined) {
    return undefined;
  }
  return Math.round((volume.availableKib * 1024) / 100_000_000) / 10;
}

/**
 * Parse one `df -k <path>` report.
 *
 * The LAST row is the one read: `df` prints a header, and a path on a mounted volume can print a
 * continuation row when the device name is long enough to wrap. Columns are positional — blocks, used,
 * available, capacity — and a row that does not yield those numbers is refused rather than partially
 * believed.
 *
 * @param text `df -k`'s stdout, or `undefined` when the read failed
 * @returns the volume's numbers, or `undefined` when nothing could be read from them
 */
export function parseDfKib({ text }: { readonly text: string | undefined }): VolumeReading | undefined {
  if (text === undefined) {
    return undefined;
  }
  const rows = text
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  const last = rows.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const columns = last.split(/\s+/u);
  const totalKib = Number(columns[1]);
  const availableKib = Number(columns[3]);
  const usedPct = Number(String(columns[4]).replace("%", ""));
  if (!Number.isFinite(totalKib) || !Number.isFinite(availableKib) || !Number.isFinite(usedPct) || totalKib <= 0) {
    return undefined;
  }
  return { availableKib, totalKib, usedPct };
}

/**
 * Fold the volume and the per-repository counts into one reading.
 *
 * @param volume the parsed `df` reading, or `undefined` when it could not be read
 * @param repos each declared checkout's registration count, in profile order
 * @returns the reading the report carries
 */
export function diskReadingOf({
  volume,
  repos,
}: {
  readonly volume: VolumeReading | undefined;
  readonly repos: readonly RepoWorktreeCount[];
}): DiskReading {
  const answered = repos.filter((repo): repo is RepoWorktreeCount & { registered: number } => repo.registered !== null);
  if (answered.length === 0) {
    return { registeredTotal: undefined, repos, volume };
  }
  return {
    registeredTotal: answered.reduce((total, repo) => total + repo.registered, 0),
    repos,
    volume,
  };
}

/**
 * The disk reading as the sentence the capacity report prints.
 *
 * Every unreadable half says so rather than rendering a zero, because this whole module exists because a
 * number on the page was confidently wrong about what it was measuring.
 *
 * @param reading the folded reading
 * @returns the line, or `undefined` when nothing at all could be read
 */
export function diskLine({ reading }: { readonly reading: DiskReading }): string | undefined {
  const parts: string[] = [];
  const freeGb = volumeFreeGb({ volume: reading.volume });
  if (reading.volume !== undefined && freeGb !== undefined) {
    parts.push(`${String(reading.volume.usedPct)}% used, ${String(freeGb)} GB free`);
  }
  if (reading.registeredTotal !== undefined) {
    const perRepo = reading.repos
      .map((repo) => `${repo.repoRoot} ${repo.registered === null ? "UNREADABLE" : String(repo.registered)}`)
      .join(", ");
    parts.push(`${String(reading.registeredTotal)} registered worktree(s) — ${perRepo}`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return `disk: ${parts.join("; ")}`;
}
