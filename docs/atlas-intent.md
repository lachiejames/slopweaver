# What an atlas must be — the owner's definition, consolidated

The definition of an atlas, assembled from what the owner has actually said, so it stops being
re-derived. The owner has explained what an atlas should be many times, and each re-explanation has come
back changed. **This page is the answer to that. Read it before
proposing an atlas design; amend it here rather than re-litigating it in a pull request.**

[atlases.md](./atlases.md) is the companion page: what the atlases in this repo currently ARE. This one
is what they must BE — and its
**[Definition of done](./atlases/definition-of-done.md#definition-of-done-an-atlas-is-not-done-until-it-answers)** is when one
is allowed to be called either: an atlas that answers nothing is decorative, so `slopweaver atlas doctor`
plus one real question asked through a verb gate every atlas pull request (the owner's steer).

## How this was assembled

|                      |                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Source               | `~/Documents/superwhisper/recordings/<unix-ts>/meta.json` → `result` — the owner's voice-to-text archive                          |
| Window swept         | every recording carrying a transcript                                                                                             |
| Matched on `atlas`   | **80** recordings                                                                                                                 |
| Read in full         | the 14 densest plus the most recent; the rest were checked by phrase-in-context for claims 1-5 below                              |
| Prior harvest reused | [corpus-intent.md](./corpus-intent.md), whose [§2](./corpus-intent/02-retrieval-vs-live-search.md) already carries atlas material |

Each claim states the owner's requirement in plain prose rather than quoting it; the recording archive
above is where a paraphrase is checked against what was said.

**Four passages are sourced differently, and say so rather than borrowing the sweep's authority** — claims
6, 7 and 8, plus the permission ceiling inside claim 1, which is a spoken ruling and carries its own
provenance where it sits.
Claims 6 and 7 come from a single spoken ruling relayed through the supervisor chat with its screenshots,
and are anchored in `supervisor-state-21aug.md`; claim 8 comes from one owner turn archived verbatim under
`$SLOPWEAVER_HOME/handovers/archive/`. None of the three is in the recording archive above. Claims 6 and 7
settle scope; claim 8 changes what a CONSUMER may do rather than what an atlas must hold. In all three
cases a ruling recorded only in a chat is a ruling the next session re-derives.

## The definition, in nine claims

- [1 · An atlas is the set of all places information can be found in one platform](./atlas-intent/01-information-places.md)
- [2 · BOTH surfaces are mandatory, because they diverge](./atlas-intent/02-both-surfaces.md)
- [3 · Provenance — every record says where it came from](./atlas-intent/03-provenance.md)
- [4 · Corroboration between the two surfaces is itself an output](./atlas-intent/04-corroboration.md)
- [5 · The exact browser URL for every thing, because proof is a screenshot](./atlas-intent/05-browser-proof.md)
- [6 · What an atlas HOLDS is per-platform, and the criterion is who else holds it](./atlas-intent/06-holdings.md)
- [7 · The browser is the FALLBACK, not the first reach](./atlas-intent/07-browser-fallback.md)
- [8 · The atlas is DISTINCT from the corpus, and a SESSION routes between them](./atlas-intent/08-corpus-and-session.md)
- [9 · An exclusion is only ever a VOLUME measurement, and a gate refuses the rest](./atlas-intent/09-volume.md)

## Around the definition

- [The goal the definition serves](./atlas-intent/settled-decisions.md)
- [Properties the owner has ruled on, that a kit must not un-decide](./atlas-intent/settled-decisions.md#properties-the-owner-has-ruled-on-that-a-kit-must-not-un-decide)
- [Where the code lives, and where the data lives](./atlas-intent/settled-decisions.md#where-the-code-lives-and-where-the-data-lives)
- [What this page does NOT settle](./atlas-intent/settled-decisions.md#what-this-page-does-not-settle)
