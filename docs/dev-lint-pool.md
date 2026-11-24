# The dev lint gate pool

How `dev lint` runs its gates side by side, and how to read a lap. The parent is
[toolchain.md](toolchain.md).

**Gates run as many at once as the machine holds, and the lap says so.** Run one after another, the gates
cost 467.2s on a developer machine, of which four gates were half. `dev lint` runs them on worker threads,
each blocked on its own `spawnSync` (`src/devLint/gateRunner.ts` — `devLint.ts` decides WHICH gates run, that
module decides HOW), in a pool as wide as `src/devLint/gateCapacity.ts` derives from the machine's CPUs and
memory: four at the 12,288 MiB floor `ci.yml` asserts, never more than eight, which is what the larger runner
(16 CPUs, 64,297 MiB) gets. Eight is the knee three sweep laps on that runner found, medians 4 → 163s, 8 → 144s, 16 → 138s,
because past it every gate slows as the pool widens. Every lap ends with the witness that says whether that engaged:

```text
dev lint: 505.7s of gate time in 215.0s of wall time — 2.35x, against 1.00x for a serial lap (ceiling 4x).
```

That ratio is the falsifiable half: a faster lap on a quiet machine reads the same as a slow one, while the
sum of gate times against wall time cannot. Three consequences worth knowing before you read a lap:

- **Output is BUFFERED, not streamed.** Each gate's stdout and stderr are captured whole and replayed under
  its `dev lint: <name>` header in PLAN order, never completion order, and never interleaved. A gate is
  replayed as soon as every gate before it in plan order has been, so output still flows during the lap.
  The whole section, the gate's stderr included, goes out as ONE write to stdout: across two pipes a
  failing gate's stderr overtook its own header on the hosted runner and printed under an earlier gate
  (`gateSection`, `src/devLint/gateRunner.ts`). Each gate that ran and failed is repeated directly above
  the verdict line, so a tail read of the log shows the finding as well as the `✗`.
- **The two whole-Program gates run alone**, each declaring `exclusive: true`. `named-object-params`, because
  what its heap (`HEAP_BUDGET_MIB`, over 6 GiB) costs beside a full pool is unmeasured. `oxlint`, because its
  type-aware pass (`tsgolint`, Go) measured 7.30 GB resident alone with a worker per core, and beside five other
  gates in a lap on a 16 GB machine that process read 10 GB with the machine deep in swap. It also caps that
  binary at four workers (`GOMAXPROCS=4`, the gate's own `env`), which measured 5.71 GB and faster; the figures
  are on its row in `src/devLint/gateGroups.ts`. The criterion for another is a measured peak, never a hunch, and it costs that
  gate's whole runtime in serialisation.
- **`prettier` runs its own four-worker pool** (`--experimental-cli`, in the pinned package). Single-threaded
  it was the floor, 132.9s of a 239.9s CI lap, and more gate concurrency could not help: N=6 gave the same
  lap as N=4. Measurement and parity checks: the `prettier` row in `src/devLint/gateGroups.ts`.
