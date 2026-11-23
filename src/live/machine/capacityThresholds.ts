/**
 * The two memory-pressure HOLD thresholds `machine capacity` grades on, in a module that imports nothing, so the
 * console's mirror test (`site/__tests__/unit/liveMachineMirror.test.ts`) can bind its copies to them without
 * dragging `capacity.ts`'s whole import graph into the site's type check. `capacity.ts` re-exports both.
 */

/*
 * The two HOLD thresholds below are sized to one kernel panic, not to a preference. In the panic
 * (`/Library/Logs/DiagnosticReports/panic-full-<timestamp>.panic`), the watchdog killed the machine
 * after WindowServer missed 153 s of check-ins, and the panic log's own gauge line read:
 *
 *   Compressor Info: 39% of compressed pages limit (OK) and 100% of segments limit (BAD) with 49 swapfiles and OK swap space
 *
 * `segments limit` is `vm.compressor.segment.limit` — `vm.compressor_pool_size / vm.compressor_segment_alloc_size`
 * (101166841856 / 81920 = 1234946 on this machine) — and the percentage is `vm.compressor.segment.total`
 * against it. A segment holds 64 KiB of compressed pages IN MEMORY OR ON SWAP, so the limit is a ceiling on
 * compressed data wherever it sits (~75 GiB here), and it is the ceiling that was hit: the stackshot's three
 * largest footprints were a fleet-spawned `Python` at 47.1 GiB, `fseventsd` at 27.7 GiB and `mds` at 20.2 GiB on
 * a 48 GiB machine. `memory_pressure -Q`'s free percentage read ~50% that shift and the ~21 GB of swap was
 * called "stale allocation, not a hold" — that gauge sees free pages, never how close the compressor is to
 * refusing to compress, which is why it is not the one this verb grades on.
 *
 * Reproduce the live readings: `sysctl vm.compressor.segment.total vm.compressor.segment.limit` and
 * `ls "$(dirname "$(sysctl -n vm.swapfileprefix)")"`. Measured 5 h 46 m after the
 * reboot with 21 live sessions: 182761 / 1234946 segments (15%) and 3 swapfiles. 40% is under where the
 * ~21 GB reading already sat (21 GiB / 64 KiB = 344k segments = 28% swapped out, before the in-memory
 * compressor, 24.4 GiB of it at the panic); 12 swapfiles is 3× the swap alert and well under the 21 that
 * reading implied. Both are first measurements to ratchet, never to argue past: raise one only with a tick
 * observed stable above it.
 */

/** Compressor segments in use above this percentage of `vm.compressor.segment.limit` HOLD spawns. */
export const DEFAULT_SEGMENTS_HOLD_PCT = 40;

/** Swapfiles on disk at or above this count HOLD spawns. */
export const DEFAULT_SWAPFILE_HOLD_COUNT = 12;
