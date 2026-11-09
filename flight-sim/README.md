# Skyward: 3D flight simulator for the browser

Skyward is a flight simulator that runs from one self-contained `index.html` (about 700 KB, with Three.js bundled in).
It needs no server, no install and no network access, so it works offline, from a USB stick, or on any static host such as GitHub Pages.

**Play:** open [`index.html`](index.html) in Chrome, Edge, Firefox or Safari. The browser must support WebGL 2.

## Features

### Flight dynamics (6-DOF)
- **Rigid-body simulation** running at a fixed 240 Hz. It uses quaternion attitude and Euler's rotation equations with a per-aircraft inertia tensor.
- **ISA standard atmosphere**: air density, temperature and speed of sound change with altitude. Indicated airspeed (IAS) is computed from dynamic pressure; the HUD also shows TAS, ground speed and Mach.
- **Aerodynamics across the whole envelope**:
  - Lift curve with a soft stall, blending into flat-plate behaviour past the stall. Flaps add lift.
  - Drag: induced, parasitic, gear, speed brake and transonic wave drag.
  - Ground effect.
  - Stability and control derivatives in standard notation (Cmα, Cmq, Clβ, Clp, Cnβ, Cnr, control-surface power, adverse yaw).
  - Post-stall autorotation and wing drop, so spins and incipient spins are possible.
- **Propeller effects**: P-factor, engine torque and slipstream over the tail.
- **Engines**: the piston engine has an RPM model and propeller thrust that falls with airspeed. The turbofan has spool-up lag, thrust that drops with altitude and rises with Mach, and an afterburner above 92 % throttle.
- **Landing gear**: spring and damper struts tuned from each aircraft's static weight distribution. Tyres have rolling resistance and lateral friction, there are differential brakes, and the nose wheel steers with speed-dependent authority.
- **Wind**: logarithmic boundary-layer wind profile plus Ornstein-Uhlenbeck turbulence (gusts and rolling moments).
- **Crashes**: over-G structural failure, gear collapse on hard landings, tail strikes, belly landings and ditching are all detected.
- **Fly-by-wire (jet)**: a C*-style load-factor command law. It includes a model-based AoA limiter, G limiter, yaw damper and turn coordination. With the stick neutral, the jet holds its flight path and bank angle.
- **Flight assist (trainer)**: the same control law, available as an option. Turn it off (`K`) for raw, unaugmented handling.

### Graphics
- **Physically based sky**: Rayleigh, Mie and ozone single scattering are rendered into a sky-view lookup table every frame. Aerial perspective uses height-dependent extinction.
- **Volumetric clouds**: raymarched through spherical cloud shells. The noise is tileable Perlin-Worley in 3D, lighting combines Beer-Powder with a multiple-scattering term and a two-lobe phase function, and clouds cast shadows on the terrain and the aircraft.
- **Terrain**: an endless quadtree LOD system with skirts. Heights are domain-warped ridged fractal noise, giving mountain ranges, coasts, beaches, snowlines, rock strata, forests and farmland patchwork.
- **Ocean**: wave normals follow the deep-water dispersion relation, and the water has depth-based colour, shore foam, sky reflections and sun glints.
- **Airports**:
  - Runways are drawn procedurally to ICAO marking layout: threshold bars, designators, touchdown zone and aiming point, centreline, blast-pad chevrons, taxiways and hold-short lines.
  - Runway lighting includes edge, centreline and threshold/end lights, approach lights with sequenced flashers, and a **PAPI with real 2.5° to 3.5° transition angles**.
  - Each airport has terminals, a control tower, hangars, windsocks that respond to the wind, and parked aircraft.
- **Trees**: instanced forests with shadows.
- **Aircraft**: the fuselages are lofted superellipse shapes, the wings use NACA 4-digit airfoils, and all control surfaces are hinged and animated. Also modelled: propeller blur disc, afterburner plume with shock diamonds, retracting gear, strobe, beacon and navigation lights, a landing light, cockpit and pilot.
- **Post-processing**: rendering is in HDR with MSAA, followed by bloom, ACES tone mapping, eye adaptation, lens flare with occlusion testing, and chromatic aberration. G-forces cause grey-out and red-out.
- **Effects**: wingtip vortices, vapour, contrails above 7.8 km, tyre smoke on touchdown, explosions and water splashes.
- **Time of day**: the sun position is computed for a mid-latitude location. Nights have stars, a moon and runway lights.

### Avionics and HUD
- Conformal pitch ladder, flight-path vector with energy caret, and slip indicator.
- Speed tape with V-speed bands and a trend vector, altitude tape with radar altitude, and a vertical speed indicator.
- ILS localizer and glideslope deviation for every runway, with a DME readout.
- Moving map, plus engine and configuration readouts.
- GPWS-style warnings: PULL UP, TERRAIN, GEAR, BANK ANGLE and STALL, with voice callouts. Radio-altitude callouts are spoken on approach.
- Landing rating based on touchdown vertical speed.

### Audio
Sound is synthesised live with WebAudio:
- Piston-engine firing pulses and the propeller.
- Turbine whine, jet roar and afterburner rumble.
- Wind, tyre roll and touchdown chirp.
- Stall horn and explosions.
- In the cockpit view, outside sound is muffled.

## Aircraft
| | Sparrow S-2 | Kestrel X-9 |
|---|---|---|
| Type | Aerobatic piston trainer | Supersonic multirole jet |
| Mass | 1,050 kg | 11,500 kg |
| Power | 200 hp, fixed-pitch prop | 56 kN dry / 86 kN afterburner |
| Stall / rotate | 55 kt / 58 kt | 125 kt / 150 kt |
| Controls | Mechanical (optional assist) | Fly-by-wire, 9 G / 26° AoA limits |

## Airports
- **SKW Skyward International**: 3,200 m runway 10/28 on a coastal plain. It has full lighting and ILS.
- **RDG Ridgeback Valley**: an airstrip in the mountains.
- **CVE Cove Harbour**: a coastal field.

## Controls
| Action | Keys |
|---|---|
| Pitch / roll | Arrow keys or `W` `S` `A` `D` (pull back = `S` / `↓`) |
| Rudder | `Q` `E` |
| Throttle | `Shift` / `R` up, `F` / `PgDn` down, `1` to `0` presets |
| Flaps | `[` `]` (or `Z` `X`) |
| Gear | `G` |
| Brakes / parking brake | `Space` or `B` / `Shift`+`B` |
| Speed brake | `Y` |
| Trim | `,` `.` |
| Camera | `C` cycle, `V` cockpit, `F1` to `F5`; drag the mouse to look, scroll to zoom |
| Mouse yoke | `M` |
| Flight assist on/off | `K` |
| Time of day | `T` / `Shift`+`T` |
| HUD | `I` |
| Pause | `Esc` / `P` |
| Restart | `Backspace` |
| Help | `H` |

**Gamepad**: the left stick flies the aircraft, the right stick works the rudder, and RT/LT move the throttle. The A, B, X and Y buttons toggle gear, change the camera and move the flaps; LB and RB apply the brakes.
**Touch**: drag anywhere on the screen to fly.

## Performance
The game picks a graphics preset from the GPU on first run: Low, Medium, High or Ultra. While you fly, it also scales the rendering resolution to keep the frame rate playable. Choose **Low** on Chromebooks and older laptops.

## Development
```bash
npm install
npm run build    # bundles src/ into index.html
npm run watch    # rebuild on change
```

| Module | Purpose |
|---|---|
| `src/physics.js` | Flight dynamics, engines, gear and control laws |
| `src/aircraft-configs.js` | Mass, inertia and aerodynamic derivatives |
| `src/aircraft-model.js` | Procedural aircraft geometry |
| `src/world.js` | Terrain height field and airport placement |
| `src/terrain.js` | LOD tiles, terrain/ocean/runway shader and forests |
| `src/atmosphere.js` | Sky scattering LUT, sun and moon, environment maps |
| `src/clouds.js` | Cloud noise textures and the raymarcher |
| `src/postfx.js` | Composite, bloom, tone mapping and lens effects |
| `src/airport.js` | Buildings and runway lighting |
| `src/hud.js` | HUD and instruments |
| `src/audio.js` | Synthesised sound |
| `src/controls.js` | Keyboard, mouse, gamepad and touch input |
| `src/effects.js` | Particles and trails |
| `src/main.js` | Game loop and UI |
