# Cardiac flight

The default Ventricle Glider and the optional Aorta Swift are original Blender
aircraft. They have a heart-shaped hull, atrial canopy, arterial tubes,
capillary-patterned wings, a valve propeller and emissive conduction details.

## Controls and interactions

- A/D, arrow keys, thumbstick, or drag-and-hold steer across a wider valley.
  Acceleration and braking are smoothed in world units, with mild bank and yaw.
  Releasing the control stops lateral drift rather than returning to center.
- The existing **Excite-O-Meter score** (`excitement_score`) remains the default
  altitude input. It is distinct from the separately available Activation
  composite (`excitometer`). Both remain selectable in Ground Control.
- Polar RR counter increments drive contraction, wing flex, vessel illumination,
  heartbeat sound, and one clustered smoke puff. They do not add altitude impulses.
- Flight options → **Explode on mountain impact** enables an optional challenge.
  It defaults off, persists locally, checks body/wing samples against the visible
  mountain slopes, and ends the run on contact. Fly again resets the run. Signal
  loss still holds the flight and disables restart until the signal recovers.

RR timing is notification-based, not a claim of exact R-peak timing. The beacon
contains a cumulative RR counter and the latest interval, not the full interval
batch. Up to four received beats are replayed at the reported interval; duplicates,
old sessions, implausible jumps and stale/paused backlog are dropped. A single
new notification triggers promptly; no beats are synthesized after input stops.
Simulation is explicitly labeled in the mobile view and asset preview.

## Remote pilot

In the Ground Control menu, select **Remote pilot**. It starts the existing
Direct Polar broadcast and displays a locally generated QR code. Scan it on a
phone, press **Connect to tower**, and start the flight once the physical signal
is ready. The selected aircraft travels in the link. The phone renders the game
and owns lateral steering. Ground Control owns the input metrics and broadcasts
new mappings while the flight remains connected. The desktop remains the tower;
this is not a mirrored desktop cockpit or video stream.

The QR selects a specific source and session in the existing public
`ecgflightv1` / `ecgsignalv1` VDO.Ninja room. It is a routing convenience, not
private authenticated pairing or BRSP/1 conformance. It grants no phone-side
settings/shell/input authority over the tower. Restarting the broadcast creates
a new source/session and requires a new QR. Stop remote pilot stops the broadcast;
closing the dialog leaves it running. The phone can also disconnect explicitly.
Internet signaling is required; same Wi-Fi is not an offline-LAN guarantee.

## Blender source and reproduction

- `assets/blender/cardiac-ventricle.blend`
- `assets/blender/cardiac-aorta.blend`
- Runtime GLBs and preview PNGs: `public/assets/aircraft/cardiac-*`
- Original tissue texture: `public/assets/flight/capillary-tissue.png`
- Rebuild: `blender --background --factory-startup --python-exit-code 1 --python scripts/build_cardiac_aircraft.py`

The delivered sources, runtime models and renders were regenerated with
**Blender 5.2.1 LTS**. The script also supports 3.6. Packed texture pixels and
geometry are generated locally; there are no external model dependencies.
Named `VentricleCore`, wing, `CardiacPulse` material and `CardiacRotor` nodes
support runtime heartbeat timing. The models intentionally contain no looping
heartbeat animation, which would drift away from the sensor. Using a newer
Blender renderer improves authoring/preview options; browser performance still
depends on the exported geometry, materials and Three.js renderer.

## Critical next improvements

1. **Make the next ring readable.** Show a restrained alignment marker and a
   clear approach/depth cue. Random vertical goals can demand physiology changes
   faster than the metric responds. Favor gently moving targets or wider vertical
   gates, and measure attainable paths at the existing smoothing time constants.
2. **Score precision and consistency.** Keep neutral misses in practice mode.
   Add a center-pass bonus and a short clean-flight streak in challenge mode.
   Do not reward elevated heart rate itself. Compare skill within a session;
   raw physiological ranges vary between players.
3. **Give the world a coherent identity.** The new aircraft and vessel ground
   textures read as cardiac, but the remaining town buildings and generic gold
   rings do not. Replace buildings with subtle tissue/island forms and rings
   with valve gates while retaining strong obstacle/target contrast.
4. **Reduce HUD competition.** Keep score, next target and signal state visible.
   Move diagnostics and logging into an expandable panel. A persistent but small
   RR indicator would help players connect sensation with the plane's motion.
5. **Measure GPU cost before adding effects.** Instance repeated clouds/peaks,
   merge static scenery, add distance LOD, and adapt pixel ratio/shadow quality
   using measured frame time. Track frame-time percentiles on a physical phone,
   not just average desktop FPS. Smoke is already pooled (96 sprites), expired
   rings are disposed, and no particles are created every frame.
6. **Offer a gentler embodiment mode.** Let players adjust contraction and sound
   strength, with an optional short introductory sequence that asks them to feel
   the heartbeat before watching the plane. Keep exaggerated motion optional.

## Evidence boundary

Automated checks cover steering cadence/braking, real browser GLB loading and
named animation parts, RR deduplication/batching/rollover/recovery, mountain
contact and restart, QR routing/session checks, live mapping delivery, and phone
viewport controls. Blender source exports and preview images are inspected.
Physical Polar-on-body timing, real smartphone touch/lifecycle, actual VDO
direct/TURN routes and headset comfort require hardware testing. Responsive
browser tests do not establish those results.
