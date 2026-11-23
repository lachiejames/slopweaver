# Notion connector throughput — what made it slow, and what the fix actually changed

Measured against the real workspace, before and after, through the real `slopweaver
refresh` door rather than a bench script. Numbers only; no page title, database name, teamspace name or
person appears below.

The reason this file exists: **a connector nobody can afford to run is a connector that does not work.**
Three chunked ingests of a newly-granted workspace took 2.5h, 5.9h and 4.3h — and the third was killed
having written zero bytes. "It is fast" is not a claim anyone can check, so the before and after numbers live
here, next to the contract each fix chose.

- [The pages lane reads a body in one request](./notion-connector-throughput/pages-lane-and-ceilings.md)
  - [What was actually slow — four ceilings, measured not guessed](./notion-connector-throughput/pages-lane-and-ceilings.md#what-was-actually-slow--four-ceilings-measured-not-guessed)
  - [Before and after, same window, same door](./notion-connector-throughput/pages-lane-and-ceilings.md#before-and-after-same-window-same-door)
- [The three fixes, and the contract each one chose](./notion-connector-throughput/three-fixes-and-reports.md)
  - [1 · Skip what bronze already holds, unchanged — before the expensive call](./notion-connector-throughput/three-fixes-and-reports.md#1--skip-what-bronze-already-holds-unchanged--before-the-expensive-call)
  - [2 · Make the incremental write real in BOTH lanes](./notion-connector-throughput/three-fixes-and-reports.md#2--make-the-incremental-write-real-in-both-lanes)
  - [3 · Fill the rate cap instead of waiting on latency](./notion-connector-throughput/three-fixes-and-reports.md#3--fill-the-rate-cap-instead-of-waiting-on-latency)
  - [Pathological items, and what is left](./notion-connector-throughput/three-fixes-and-reports.md#pathological-items-and-what-is-left)
  - [What a run reports, every time](./notion-connector-throughput/three-fixes-and-reports.md#what-a-run-reports-every-time)
- [The full-history expansion](./notion-connector-throughput/full-history-expansion.md)
  - [Corpus after](./notion-connector-throughput/full-history-expansion.md#corpus-after)
  - [The two spot-checks](./notion-connector-throughput/full-history-expansion.md#the-two-spot-checks)
  - [What it still could not read, stated rather than hidden](./notion-connector-throughput/full-history-expansion.md#what-it-still-could-not-read-stated-rather-than-hidden)
- [Lifting the caps, and why a lifted run needs a THIRD bound](./notion-connector-throughput/lifted-caps-and-repull.md)
  - [Proved live — and it sizes the time bound](./notion-connector-throughput/lifted-caps-and-repull.md#proved-live--and-it-sizes-the-time-bound)
  - [The re-pull is IN PLACE, not move-aside — and the reason is a read-time rule](./notion-connector-throughput/lifted-caps-and-repull.md#the-re-pull-is-in-place-not-move-aside--and-the-reason-is-a-read-time-rule)
