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
- **Volumetric clouds**: raymarched through spherical cloud shells. The noise is tileable Perlin-Worley in 3D, lighting combines Beer-Powder with a multiple-scattering term and a two-lobe phase function, and clouds cast shadows on the terrain and the aircraft. A temporal reprojection pass accumulates samples across frames, so fewer raymarch steps are needed and the result is smoother. A high cirrus deck is drawn in the sky.
- **Mountain shadows and terrain ambient occlusion**: a height field around the camera is streamed in the background, and the GPU bakes a sun "shadow ceiling" and horizon-based AO from it. Valleys fall into shadow at low sun, and terrain, trees, buildings and the aircraft all receive these shadows per pixel.
- **God rays**: crepuscular rays are computed at quarter resolution from the sky, terrain and cloud occlusion.
- **Terrain**: an endless quadtree LOD system with skirts. Heights are domain-warped ridged fractal noise, giving mountain ranges, coasts, beaches, snowlines, rock strata, forests and farmland patchwork.
- **Procedural PBR textures**: at load time the GPU synthesises tileable albedo, height, normal, roughness and AO for grass, soil, rock, sand, snow, forest floor, asphalt, concrete and water ripples. Close to the camera these are height-blended into the terrain, with two-scale sampling to hide tiling and triplanar mapping on cliffs.
- **Ocean**: wave normals follow the deep-water dispersion relation, and the water has depth-based colour, shore foam, sky reflections and sun glints.
- **Airports**:
  - Runways are drawn procedurally to ICAO marking layout: threshold bars, designators, touchdown zone and aiming point, centreline, blast-pad chevrons, taxiways and hold-short lines.
  - Runway lighting includes edge, centreline and threshold/end lights, approach lights with sequenced flashers, and a **PAPI with real 2.5° to 3.5° transition angles**.
  - Each airport has terminals, a control tower, hangars, windsocks that respond to the wind, and parked aircraft.
- **Trees**: forests are instanced per 512 m cell so each cell can be frustum-culled. Nearby trees are 3D meshes with procedural leaf shading; distant trees switch to impostors baked from those same meshes.
- **Aircraft**: the skins are PBR, with panel seams, rivets and access hatches in the normal map, plus roughness variation, exhaust soot and stencils. The fuselages are lofted superellipse shapes, the wings use NACA 4-digit airfoils, and all control surfaces are hinged and animated. Also modelled: propeller blur disc, afterburner plume with shock diamonds, retracting gear, strobe, beacon and navigation lights, a landing light, cockpit and pilot.
- **Post-processing**: rendering is in HDR with MSAA and a reversed-Z float depth buffer, followed by bloom, ACES tone mapping with a filmic grade, eye adaptation, lens flare with occlusion testing, and chromatic aberration. G-forces cause grey-out and red-out.
- **Effects**: wingtip vortices, vapour, contrails above 7.8 km, tyre smoke on touchdown, explosions and water splashes.
- **Time of day**: the sun position is computed for a mid-latitude location. Nights have stars, a moon and runway lights.

### Avionics and HUD
- Conformal pitch ladder, flight-path vector with energy caret, and slip indicator.
- Speed tape with V-speed bands and a trend vector, altitude tape with radar altitude, and a vertical speed indicator.
- ILS localizer and glideslope deviation for every runway, with a DME readout.
- Moving map, plus engine and configuration readouts.
- GPWS-style warnings: PULL UP, TERRAIN, GEAR, BANK ANGLE and STALL, with voice callouts. Radio-altitude callouts are spoken on approach.
- Landing rating based on touchdown vertical speed.

### Game modes
- **Free flight**: fly anywhere from any start position.
- **Landing challenge**: you start on a crooked final approach, off the centre line and the glide path, with Calm, Crosswind or Gusty storm wind. Each touchdown is scored out of 1000 for sink rate, touchdown point (aim 300 m past the threshold), centre line, crab angle, speed against Vref and wings level. Bounces and runway excursions cost points. You get a grade from S to D. Autoland is not scored.
- **Ring course**: race through 14 glowing gates near the chosen airport. Each aircraft has its own seeded track: gate size, spacing and turns are sized for that aircraft, and the gates keep clear of terrain with a flyable climb gradient. The HUD brackets the next gate, or shows an edge arrow when it is off-screen, and the map shows the gates ahead. A missed gate adds 5 s.
- **Personal bests** are saved in the browser for each aircraft, airport and difficulty, and shown in the menu and on the results card.

### Autopilot and autothrottle
- **Flight control panel** at the bottom of the screen: set SPD, HDG, ALT and V/S with the arrows or the mouse wheel (hold `Shift` for big steps), and switch AP, A/THR and APP on or off. Values you preselect before engaging are used when you engage.
- **Lateral modes**: HDG (heading select) and LOC. LOC flies a ground-track loop, so it corrects for crosswind.
- **Vertical modes**: ALT hold, V/S climb or descent to the selected altitude, and G/S. A stall guard stops the autopilot from trading away too much speed.
- **Autothrottle**: a PI speed controller. It retards to idle in the flare.
- **Autoland**: press `O` near an airport to arm APP. The autopilot captures the localizer and glideslope, then flies FLARE, de-crabs, RETARDs and runs ROLLOUT with centreline tracking and autobrake. It switches off at taxi speed.
- **Flight-mode annunciator** above the panel and on the airliner PFD.
- **Disconnects**: a firm stick input disconnects the autopilot, and moving the thrust levers disconnects the autothrottle.

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
| Autopilot / autothrottle | `U` / `Shift`+`U` |
| Approach / autoland | `O` |
| Autopilot panel show/hide | `L` |
| Flight assist on/off | `K` |
| Time of day | `T` / `Shift`+`T` |
| HUD | `I` |
| Pause | `Esc` / `P` |
| Restart | `Backspace` |
| Help | `H` |

**Gamepad**: the left stick flies the aircraft, the right stick works the rudder, and RT/LT move the throttle. A toggles the gear, B changes the camera, and X/Y move the flaps. LB applies the brakes, RB holds the speed brake, and the D-pad trims.

## Flight hardware: joysticks, sidesticks, yokes, throttles, pedals
Any controller the browser exposes through the Gamepad API works, and you can use several at once. Each device gets its own profile, saved in the browser. Your stick, throttle quadrant and rudder pedals can all be plugged in together.

1. Plug the device in and **press any button on it**. Browsers only reveal controllers after a button press.
2. The game recognises the device type from its name and applies a starting layout:
   - **Joystick / sidestick**: roll and pitch, twist for rudder, throttle lever, hat switch for looking around.
   - **Yoke**: roll and pitch, throttle lever.
   - **Throttle quadrant**: throttle.
   - **Rudder pedals**: rudder, plus left and right toe brakes.
   - **Gamepad**: standard layout.
3. Open **Flight controllers** (main menu or pause menu) and run the **Setup wizard**. For each control it tells you which way to move it, then detects which axis you moved and whether it needs inverting. Skip any control you don't have.

On the same panel:
- Rebind any action to any axis, button or hat, and invert or remove bindings.
- Watch live axis and button monitors for every device.
- Set the deadzone and response curve, and switch rumble on or off.

How the controls behave:
- **Toe brakes** brake the left and right main wheels separately, so you can steer while taxiing with differential braking.
- **Hardware levers** (throttle, flaps, trim wheel, speed brake) take effect only when you move them. The keyboard and spawn settings keep control until you touch the lever, so a lever resting at idle won't cut power on an approach start.
- **Hat switch / POV** lets you look around in the cockpit and pan the chase and orbit cameras.
- **Rumble**: gamepads with rumble motors shake on stall buffet, ground roll, touchdowns and crashes.
**Touch**: drag anywhere on the screen to fly.

## Performance
The game picks a graphics preset from the GPU on first run: Low, Medium, High or Ultra. While you fly, it also scales the rendering resolution to keep the frame rate playable. Choose **Low** on Chromebooks and older laptops.

What keeps it fast:
- **Reversed-Z float depth** keeps early-Z rejection; a logarithmic depth buffer is used only when `EXT_clip_control` is missing. You can force log depth with `?logdepth`.
- **Clouds** render at reduced resolution and are temporally accumulated, with empty-space skipping and a shorter light march.
- **Trees** are frustum-culled per cell and use impostors beyond about 1 km, so the shadow pass only draws trees near the aircraft.
- **Detail texturing** on terrain is limited to about 3 km from the camera. Texture lookups use explicit gradients, so branches stay cheap.
- **Physics** skips per-contact terrain queries when the aircraft is airborne, and the hot paths reuse vector temporaries.
- **The HUD** draws cheap offset text shadows instead of blurred canvas shadows.
- **Shaders** are compiled up front when a flight starts, to avoid first-use hitches.

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
| `src/texgen.js` | GPU procedural PBR texture arrays |
| `src/worldlight.js` | Cloud and terrain shadows, terrain AO bake, material patching |
| `src/clouds.js` | Cloud noise textures and the raymarcher |
| `src/postfx.js` | Composite, bloom, tone mapping and lens effects |
| `src/airport.js` | Buildings and runway lighting |
| `src/hud.js` | HUD and instruments |
| `src/audio.js` | Synthesised sound |
| `src/controls.js` | Keyboard, mouse, touch and hardware input merging |
| `src/devices.js` | Flight hardware detection, profiles, binding capture and rumble |
| `src/devices-ui.js` | Flight controllers panel and setup wizard |
| `src/effects.js` | Particles and trails |
| `src/main.js` | Game loop and UI |
