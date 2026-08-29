# Sonic openness and closedness: research-to-synthesis mapping

Observed: 29 August 2026. This note turns music-cognition, timbre-semantics,
room-acoustics, and acoustic-phonetics findings into an explicitly testable
Breath Mirror design. The mapping is a creative hypothesis, not a universal
law of musical meaning.

## Direct mapping

Breath Mirror treats lung expansion as a multi-dimensional sonic opening and
lung contraction as the exact reverse:

| Perceptual dimension | Inhale / expansion | Exhale / contraction | Runtime control |
| --- | --- | --- | --- |
| Apparent breadth | increasingly wide and decorrelated | increasingly centered | stereo independent-noise width |
| Envelopment | more subtle late lateral energy | drier and nearer | 83/109 ms cross-fed diffuse field |
| Mouth aperture | first resonance rises toward an open tract | resonance lowers toward a constricted tract | noise-excited 360–860 Hz resonance |
| Spectral access | broader bandwidth and higher spectral center | narrower, more filtered bandwidth | cutoff and band-spread multipliers |
| Surface quality | smoother and freer | slightly rougher and restricted | turbulence-depth multiplier |
| Acoustic energy | follows airflow only | follows airflow only | nonlinear `flow01` envelope |

The last row is an important separation of concerns. Rising intensity is a
strong cue for an approaching or looming source, so using chest expansion as a
gain control could make “opening” sound like “something moving toward me.” The
generator instead uses width, lateral ambience, resonance, and bandwidth for
openness while retaining physiologically plausible flow-driven loudness.

## Evidence ledger

### Open, broad, free, and resonant form a semantic family

A study built from expert violinists' language included the opposing pairs
closed/open, restricted/free, narrow/broad, dry/resonant, and coarse/smooth.
Listeners rated closed/open reliably, and closed/open correlated with
restricted/free, narrow/broad, and dry/resonant. The authors also report that
some listeners related open/closed and broad/narrow to vibrato. This does not
prove one universal acoustic recipe, but supports treating openness as a bundle
of breadth, freedom, resonance, and temporal variation rather than brightness
alone ([Gómez et al., 2019](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.00334/full)).

### Width and lateral energy create spatial opening

Concert-hall research separates apparent source width from listener
envelopment. Early lateral energy broadens the apparent source; later lateral
energy and its angular distribution are strong predictors of being surrounded
by sound. One controlled study identifies lateral reflections arriving 80 ms or
more after the direct sound as important for envelopment
([Bradley & Soulodre, 1995](https://nrc-publications.canada.ca/eng/view/object/?id=be12bb70-20ce-4d9e-ab16-99b48af4ef6c),
[Griesinger, 1997](https://www.researchgate.net/publication/233610015_The_Psychoacoustics_of_Apparent_Source_Width_Spaciousness_and_Envelopment_in_Performance_Spaces)).
Breath Mirror therefore increases stereo decorrelation and a very quiet
83/109-ms lateral field as the lung opens. The mix remains subtle because this
is a close-mouth sound, not a concert hall.

### Mouth opening has a useful acoustic correlate

Acoustic phonetics models the vocal tract as a source filtered by resonances.
A wide-open mouth and low pharyngeal constriction raise the first formant;
reducing the lip opening or increasing mouth constriction lowers it. Turbulent,
unvoiced airflow is aperiodic but is still shaped by the tract. This supports a
quiet noise-excited first-resonance trajectory as a physically interpretable
mouth-aperture cue
([Harrington, *Vowels and vowel-like sounds*](https://www.phonetik.uni-muenchen.de/~jmh/research/papers/acoustics.pdf)).

### Musical change suggests motion, but mappings are not one-to-one

Experiments show that changes in dynamics, pitch contour, attack rate, and
articulation affect imagined spatial and bodily motion, often asymmetrically.
Intensifications are more consistently associated with increasing speed than
with a single spatial direction
([Eitan & Granot, 2008](https://www.researchgate.net/publication/238660101_MUSICAL_PARAMETERS_AND_SPATIO-KINETIC_IMAGERY)).
Another study using real music found regular widening/narrowing associations but
explicitly rejected a one-to-one mapping between a sound property and a spatial
concept
([Mikalonytė & Dranseika, 2018](https://www.journals.vu.lt/psichologija/en/article/view/11910)).

The implementation therefore changes several mutually reinforcing features and
keeps every transition reversible: inhale moves the same parameter vector from
closed to open; exhale traverses it from open to closed.

### Why gain is excluded from sonic aperture

Rising-level sounds are perceived as looming or approaching and receive faster,
privileged processing relative to receding sounds. In one experiment the loom
rose from 35 to 80 dB SPL and was identified about 100 ms faster than its
receding counterpart
([Bidelman & Myers, 2020](https://pubmed.ncbi.nlm.nih.gov/31606413/)).
This is useful motion evidence but the wrong metaphor for calm spatial opening.
Breath Mirror therefore never multiplies amplitude by `openness01`; amplitude
continues to follow the absolute breath-flow surrogate.

## Implementation contract

`breath-sonic-space.ts` exposes the reference mapping used by tests and the UI.
The allocation-free equivalent in `breath-processor.js` runs for every audio
sample. At closed/open endpoints it maps:

- cutoff multiplier: `0.72 → 1.28`;
- mouth resonance: `360 → 860 Hz`;
- spectral spread: `0.72 → 1.16`;
- stereo independent-component width: `0.055 → 0.34 + variation × 0.28`;
- diffuse-field mix: `0.008 → 0.085 + variation × 0.075`;
- constriction roughness: `1.12 → 0.82`.

The control variable is a smoothstep of the normalized lung-volume surrogate.
Consequently, it opens continuously across inhale, remains open during a full
hold, closes continuously across exhale, and remains closed during an empty
hold. Polar readiness and freshness gating remain authoritative; this mapping
cannot synthesize around a stale or rejected physiological phase.

## Validation requirement

Spatial and timbral metaphors are shaped by context, language, culture,
reproduction system, and individual listening history. The current mapping
must be treated as a preregistered prototype for listening tests, not as a fact
about all listeners. A useful A/B study should independently compare:

1. width only;
2. resonance/bandwidth only;
3. diffuse lateral field only;
4. the combined mapping;
5. an intentionally reversed mapping.

Listeners should rate open/closed, expanding/contracting, self/other,
naturalness, fatigue, and phase legibility on both headphones and speakers.
