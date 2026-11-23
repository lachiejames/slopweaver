# Main checkouts: current, installed, and honest about drift

A **main checkout** is a repository's own main worktree — the one every linked worktree, every probe and
every bare `slopweaver` invocation reads. This document says what "correct" means for one, what enforces it,
and what deliberately does not. The LINKED worktrees around it, and what may be reclaimed when their work has
landed, are [docs/worktree-prune.md](worktree-prune.md)'s subject — a main checkout is the one entry
`worktree prune` will never touch.

- [The two failures this exists for](./main-checkouts/declarations-and-freshness.md)
  - [The owner's ruling, and the line it draws](./main-checkouts/declarations-and-freshness.md#the-owners-ruling-and-the-line-it-draws)
  - [Declaring your main checkouts](./main-checkouts/declarations-and-freshness.md#declaring-your-main-checkouts)
  - [The verbs](./main-checkouts/declarations-and-freshness.md#the-verbs)
  - [Three rungs, and why they exist](./main-checkouts/declarations-and-freshness.md#three-rungs-and-why-they-exist)
  - [What `doctor` adds](./main-checkouts/declarations-and-freshness.md#what-doctor-adds)
  - [How the install check actually works, and what it cannot see](./main-checkouts/declarations-and-freshness.md#how-the-install-check-actually-works-and-what-it-cannot-see)
  - [The second upstream: a long-lived branch that keeps drifting from its trunk](./main-checkouts/declarations-and-freshness.md#the-second-upstream-a-long-lived-branch-that-keeps-drifting-from-its-trunk)
  - [Base freshness at spawn](./main-checkouts/declarations-and-freshness.md#base-freshness-at-spawn)
- [What a cwd may stand for](./main-checkouts/cwd-safety-and-scope.md)
  - [So a scheduled pass READS the declaration rather than standing anywhere](./main-checkouts/cwd-safety-and-scope.md#so-a-scheduled-pass-reads-the-declaration-rather-than-standing-anywhere)
  - [A child must never work in the shared main checkout](./main-checkouts/cwd-safety-and-scope.md#a-child-must-never-work-in-the-shared-main-checkout)
  - [The incident, anchored](./main-checkouts/cwd-safety-and-scope.md#the-incident-anchored)
  - [The four layers, and why no single one is enough](./main-checkouts/cwd-safety-and-scope.md#the-four-layers-and-why-no-single-one-is-enough)
  - [The doc is the fourth layer, and it is where the incident actually started](./main-checkouts/cwd-safety-and-scope.md#the-doc-is-the-fourth-layer-and-it-is-where-the-incident-actually-started)
  - [What `cmux spawn` does, and what it deliberately does not](./main-checkouts/cwd-safety-and-scope.md#what-cmux-spawn-does-and-what-it-deliberately-does-not)
  - [Explicitly out of scope](./main-checkouts/cwd-safety-and-scope.md#explicitly-out-of-scope)
  - [Where the pieces live](./main-checkouts/cwd-safety-and-scope.md#where-the-pieces-live)
