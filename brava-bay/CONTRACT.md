# Brava Bay: engineering contract

Brava Bay is an **original** open-world crime sandbox that runs in the browser: a sunny coastal city with driving, on-foot play, traffic, pedestrians, police chases, weapons, missions and a radio. It ships as **one self-contained `index.html`** (Three.js r180 is bundled by esbuild, there are no external assets, and it works offline). Everything (geometry, textures, sounds, music) is **procedural**.

This file is the shared contract between modules. Read the sections for the module you own **and** every API you call.

## 0. Ground rules

- **Original IP only.** Use no real-world brands, logos, car makes or models, song lyrics, or names, characters, logos, HUD art, fonts or wording from any existing game franchise. In particular, nothing may reference Grand Theft Auto or Rockstar (e.g. "Vice City", "Leonida", "Lucia", "Jason", "WASTED", "BUSTED", "Pricedown" font style). Character, place, shop and station names are invented. Use "ARRESTED" and "HOSPITALIZED".
- **Edit only the files you own** (see §14). If you need something from another module, code against this contract and use a defensive fallback (`if (game.effects && game.effects.spawn)`). If you think the contract itself must change, explain why in your final report. Don't edit someone else's file.
- **No new npm dependencies, no network fetches, no external assets** (no CDN, fonts, images or audio files). Three.js addons from `three/examples/jsm/...` are allowed.
- **Quality bar: premium and realistic.** That means physically based materials, believable proportions, careful lighting and colour, smooth animation and responsive controls. It must still run well on a mid-range laptop. Use instancing, merged geometry, chunked frustum culling, LOD and quality presets.
- Keep your module self-contained and **robust**: never throw in `update()`. Guard against `null` entities and missing optional systems.
- Code style: ES modules, tabs, no TypeScript. Comments only where they explain *why* or a non-obvious contract.

## 1. Build, run, test

```bash
cd brava-bay
npm install            # esbuild + three (already in package.json)
npm run build          # bundles src/ into ./index.html
node tools/shot.cjs --query "autostart&quality=low&hour=17" --wait 6000 --out /abs/path/shot.png
node tools/shot.cjs --query "autostart&quality=medium" --steps steps.json --width 1280 --height 720
```
`tools/shot.cjs` runs headless Chromium with SwiftShader (software WebGL2, so a slow 5–15 fps is normal). It prints console errors, page errors, FPS, draw calls and triangles. Steps JSON: `{"wait":ms}`, `{"eval":"js"}`, `{"log":"expr"}`, `{"key":"KeyW","ms":1500}`, `{"keys":["KeyW","KeyD"],"ms":800}`, `{"press":"KeyF"}`, `{"click":[x,y]}`, `{"shot":"/abs/file.png"}`. Look at your screenshots with the Read tool: judge the visuals, don't just check for errors. `window.game` is the live Game object, so you can call any API from `eval`.

**Debug URL parameters** (handled in `main.js` / `settings.js`):
`autostart` (skip the menu), `quality=low|medium|high|ultra`, `hour=17.5`, `freezetime`, `spawn=x,z[,yaw]`, `vehicle=sports` (start driving that type), `cam=x,y,z,lookX,lookY,lookZ` (fixed debug camera, overrides the rig), `seed=n`, `notraffic`, `nopeds`, `noaudio`, `wanted=3`, `mission=<id>`, `fps`.

## 2. Conventions

- Units are **metres, seconds, kilograms, radians**. Axes: **+X east, +Z south (north = −Z), +Y up**.
- **Yaw** (heading) for every entity: `forward = (sin yaw, 0, cos yaw)`, `right = (−cos yaw, 0, sin yaw)`. So `yaw = 0` faces south (+Z), `π/2` east, `π` north, `−π/2` west. `object3d.rotation.y = yaw` (or `quaternion` from axis Y). Helpers are in `src/core/math.js`: `yawFromDir`, `forwardX/Z`, `rightX/Z`, `wrapAngle`, `angleDiff`, `damp`, `dampAngle`, `RNG`, `hash2`, `fbm2`, `smoothstep` and others.
- **Model local frames** (vehicles, characters, props): **+Z forward, +Y up, −X right** (+X is the left/driver side). Origin at ground level: under the wheelbase centre for vehicles, at the feet for characters.
- Road surface `y = 0`. Blocks, sidewalks and walkways are at `y = WORLD.curb` (0.15). Sea level is `y = WORLD.waterY` (−0.6). Bridges arch up to 9 m. The pier deck is at 2.5 m.
- Traffic drives on the **right**. Lane 0 is the innermost lane, next to the centre line or median. Lane `lanes−1` is the curb lane.
- Colours: renderer `outputColorSpace = SRGB`. Hex colours in data are sRGB. HDR rendering goes through PostFX tone mapping. Use `MeshStandardMaterial` / `MeshPhysicalMaterial` (PBR) and avoid `MeshBasicMaterial` except for emissive or unlit things. `scene.environment` (a PMREM sky) is set by Sky, so reflections come for free.
- Shadows: set `castShadow` / `receiveShadow` sensibly. Buildings, vehicles, characters, palms and props cast. Ground, roads and buildings receive.
- Time: `game.clock.time` is simulation seconds and stops while paused. `game.clock.real` is real seconds. `game.clock.hour` is the time of day (0–24), advancing at `clock.timeScale` (60×: one game hour per real minute). `update(dt)` receives the right dt.

## 3. The Game hub (`window.game`, built in `src/main.js`)

```
game.THREE, game.WORLD, game.renderer, game.scene, game.camera (PerspectiveCamera)
game.settings (persisted; see core/settings.js), game.quality (preset object + .key), game.params (URL)
game.clock { time, real, dt, hour, timeScale, frozen, day }
game.weather { cloud 0..1, rain 0..1, wetness 0..1, wind m/s, fog 0..1 }   // written by Sky, read by others
game.state  'boot' | 'menu' | 'playing' | 'paused' | 'dead' | 'arrested'
game.timeScale  simulation speed multiplier (slow motion on death)
game.events  (Events bus: on/once/off/emit; see §12)
game.input   (see §13)
game.city, game.collision, game.nav, game.dyn (DynamicGrid), game.gps
game.sky, game.lighting, game.post, game.water, game.nature, game.streets, game.buildings
game.effects, game.vehicles, game.player, game.cameraRig, game.traffic, game.peds
game.wanted, game.police, game.weapons, game.missions, game.audio, game.radio, game.hud, game.menu
game.stats { fps, frameMs, frames }
game.startGame(opts), game.pause(tab), game.resume()
```

**System lifecycle.** Every system is a class `constructor(game)` (cheap, no scene work) plus `async init(progress)`, which builds meshes and may `await` to yield. Each also has `update(dt)`. Init runs in this order: sky, lighting, post, water, nature, streets, buildings, effects, vehicles, player, cameraRig, traffic, peds, wanted, police, weapons, missions, audio, radio, hud, menu.

**Per-frame order** (`main.js frame()`): `input.update` → pause/map keys → clock → (if simulating) `dyn` rebuild → `player.update` → `traffic.update` → `police.update` → `peds.update` → `vehicles.update` (physics) → `player.postUpdate` → `weapons.update` → `wanted.update` → `missions.update` → `gps.update` → `cameraRig.update(realDt)` → `sky`, `lighting`, `water`, `nature`, `streets`, `buildings` `.update(realDt)` → `effects.update(simDt)` → `audio`, `radio`, `hud`, `menu` `.update(realDt)` → `post.render(realDt)`.

In the `menu` state the world keeps simulating (traffic, peds, vehicles) but the player is inactive and the camera is cinematic. `simDt` is 0 while paused.

**Death and arrest** are handled in `main.js`. When `playerDied` or `playerArrested` fires, the state becomes `dead`/`arrested` and `timeScale` drops to 0.3 or 0.6. A `bigMessage` event is emitted. After about 5–6 s, main calls `wanted.clear()`, `player.respawn(x,z,yaw)` at the nearest hospital or police POI, and `player.addMoney(-fee)`, then emits `respawn`.

## 4. City data (`src/world/citygen.js`, owned by the integrator, read-only for everyone)

`WORLD = { half: 1400, waterY: -0.6, curb: 0.15, laneW: 3.5, shoulder: 0.5, crosswalkW: 3.2, stopGap: 0.8 }`

`game.city` fields:
- `roads[]`: `{ id, axis:'ns'|'ew', c (x for ns, z for ew), name, lanes (per direction), median, kind:'street'|'boulevard'|'bridge', width, speed (m/s), land, s0, s1, edges[] }`. `ns` roads run along Z and `ew` roads along X.
- `nodes[]` (intersections): `{ id, x, z, land, edges:{n,s,e,w} (edge id or -1), wNS, wEW (widths of the crossing roads; the intersection box is x±wNS/2, z±wEW/2), kind:'cross'|'tee'|'corner'|'straight'|'end', degree, signal: null|{cycle, offset}, roadNS, roadEW }`
- `edges[]` (road segments between adjacent nodes): `{ id, road, a, b (node ids; a is at s0 and b at s1, s0<s1), axis, c, s0, s1, length, width, lanes, median, kind, speed, name, bridge (null|bridge id), heightAt?(x) (bridges only), rect {minX,maxX,minZ,maxZ} (drivable rect including the end intersection boxes; set by Collision) }`
- `bridges[]`: `{ id, name, z, x0, x1 (elevated span), h (peak height), width (road), walkW (2.5 each side), deckWidth, edge, heightAt(x), slopeAt(x) }`. The deck is the road surface at `heightAt(x)`. Walkways sit on both sides at `+curb`.
- `blocks[]`: `{ id, land, i0,i1,j0,j1, minX,maxX,minZ,maxZ (full block including sidewalk ring), sidewalk (ring width), inner {minX..} (lot area), district, kind:'buildings'|'park'|'plaza'|'parking'|'port', name, role, buildings[] }`
- `walkways[]`: sidewalk strips on the outer side of perimeter roads: `{ id, side:'n'|'s'|'e'|'w', land, minX,maxX,minZ,maxZ, promenade? }`. The east walkway on Coral Key is the 6 m beach promenade.
- `buildings[]`: `{ id, block, district, x, z (centre), w (x size), d (z size), h (height above curb), style, color (hex), front:'n'|'s'|'e'|'w' (street-facing side), roof:'flat'|'hip'|'gable'|'sawtooth', floors, floorH, seed, tower?: {x,z,w,d,h (top height above curb)}, podiumColor?, crown?: 'flat'|'setback'|'spire'|'helipad'|'slant'|'rooftop', spire?, landmark?, name?, role?, mural?, awning?, neon?, fin?, eyebrows?, balconies?, roofColor?, twoStory? }`
  - styles: `glass`, `office` (downtown towers; a `tower` sits on a podium of height `h`), `midrise`, `condo`, `deco` (pastel streamline-moderne beach hotels), `shop` (colourful 1–4 storey with awnings, murals, neon), `loft`, `house` (suburban, pitched roof, with yard/driveway/pool features), `warehouse`, `gasShop`, `hospital`, `police`, `garage`.
  - Collision boxes are exactly the base box `(x±w/2, z±d/2, curb..curb+h)` plus the tower box. A visual model may add details (balconies, cornices, rooftop units) but must stay within roughly 1 m outside that box, otherwise the player walks into invisible walls or through visible ones.
- `containers[]` (port): `{ id, x, z, w, d, yaw, levels, h, colors[] }`. These are stacks of 12.2 × 2.44 × 2.6 m boxes.
- `features[]` (lot dressing, purely visual unless noted): `yard`, `driveway {x,z,yaw,w,l}`, `pool`, `park`, `path`, `fountain {x,z,r}` (has a collider), `plaza`, `parkingLot`, `paving`, `yardPaving`, `gasCanopy {rect,h,pumps}` (pillars collide), `lifeguard {x,z,yaw}` (collides), `umbrella {x,z,color}`.
- `platforms[]`: the pier `{ kind:'pier', minX..maxZ, heightAt(x,z) }`.
- `landmarks[]`: `ferris` (Sunwheel on the pier end, `{x,z,y,radius,hubY,plane:'yz'}`), `lighthouse {x,z,y,radius,height}`, `crane` ×3 (port gantry cranes `{x,z,height,span,legW}`), and `tower` (Meridian Tower, building id). Each has colliders.
- `props`: arrays of `{ id, type, x, z, ... }`:
  - `streetlights {x,z,yaw (faces the road),h,arm,y? (bridges)}` (breakable)
  - `signals {x,z,yaw (= travel yaw of the controlled approach),node,axis,arm (mast-arm length over the lanes, extending to the LEFT of travel),from}`
  - `palms {x,z,h,lean,leanDir,species:'royal'|'coconut'|'sabal'}`
  - `trees {x,z,h,r,species:'oak'|'seagrape'|'banyan'}`
  - `benches {x,z,yaw}`, `bins`, `hydrants`, `busStops {x,z,yaw,w,d,h}`
  - `bushes {x,z,r,h,species}` (no collision)
  Each prop with a collider has `.collider` (collider id). Breakable props can be knocked down: see the `propBroken` event.
- `parking[]`: `{ x, z, yaw, kind:'lot'|'driveway', chance }` spots for parked cars.
- `pois[]`: `{ id, type, name, x, z, yaw, building?, block? }`. Types are `safehouse`, `hospital`, `police`, `garage`, `sprayshop`, `cafe`, `gas`, `landmark`, `marina`. Ids include `safehouse`, `hospital`, `police`, `police2`, `garage`, `sprayshop`, `cafe`, `gas0..3`, `meridian`, `pier`, `lighthouse`, `marina`, `terminal`, `beach`. Use `city.poi(id)`.
- `districts[]`: `{ id, name, minX..maxZ }`. Ids are `downtown`, `heights` (Calloway Heights), `bayside`, `pintura` (La Pintura arts district), `mangrove` (Mangrove Park suburbs), `port` (Port Cayo), `coralkey` (Coral Key beach island) and `bay`.
- Helpers: `city.blockAtPoint(x,z)`, `city.walkwayAt(x,z)`, `city.onSidewalk(x,z)`, `city.districtAt(x,z)`, `city.streetNameAt(x,z)`, `city.landDist(x,z)` (+ on land, − at sea), `city.naturalHeight(x,z)`, `city.naturalSurface(x,z,y)`, `city.poi(id)`.

Geography: the mainland spans x −1150..400. Downtown is around (80, −160). Coral Key is a barrier island at x 620..990 with a sandy beach on its east side (x > 890) and the ocean beyond. Three causeway bridges cross the bay at z = −600, 0 and 600. Port Cayo is in the south-west, where container cranes stand on the quay at z ≈ 975. The pier with the Sunwheel is at z = −200 on the beach.

## 5. Collision & surfaces (`src/world/collision.js`, owned by the integrator)

- `collision.surfaceAt(x, z, yRef=1e9)` → **shared** `{ y, type, edge, block, bridge, platform }`. Types are `road`, `bridge`, `sidewalk`, `lot`, `park`, `pier`, `sand`, `grass`, `concrete` and `water`. For water, `y` is the seabed. Elevated surfaces more than 2.5 m above `yRef` are ignored, so you can be under a bridge.
- `collision.groundHeight(x, z, yRef)` gives solid ground or seabed. `collision.waterDepth(x,z,yRef)`, `collision.isWater(x,z,yRef)`.
- `collision.resolveCircle(x, z, r, y0, y1)` → shared `{ x, z, hit, nx, nz, collider }`. Pushes a character out of static colliders. Pass `y0 = feet + 0.35` so curbs don't block.
- `collision.collideOBB(cx, cz, yaw, halfWidth, halfLength, y0, y1, contacts[])` fills the array with `{ nx, nz, depth, px, pz, collider }`. The normal points from the obstacle toward the vehicle.
- `collision.raycast(ox,oy,oz, dx,dy,dz, maxDist, opts)` → shared `{ dist, x,y,z, nx,ny,nz, collider, type:'box'|'cyl'|'ground'|'water', surface }` or null. `dir` must be normalised. opts: `{ ground: true, water: false, ignoreKinds: ['prop'], ignore: (collider)=>bool, groundStep: 1 }`.
- `collision.lineOfSight(ax,ay,az,bx,by,bz)`, `collision.isBlocked(x,z,r,y0,y1)`, `collision.queryRect(minX,minZ,maxX,maxZ,out)` (collider ids), `collision.colliders[id]`.
- A collider is `{ id, type:'box'|'cyl', minX..maxZ | x,z,r, y0, y1, kind:'building'|'container'|'prop'|'railing'|'landmark'|'pillar'|'fountain'|'shelter', ref (source data), breakable, broken }`. `collision.breakCollider(c)` makes a breakable collider stop colliding. The breaker then emits `propBroken`.
- **Dynamic entities**: `game.dyn.query(x, z, r, out, filter)` returns vehicles, peds and the player near a point. The grid is rebuilt each frame before AI and physics. Each entity needs `position`, `radius` and `kind`.

## 6. Navigation (`src/world/nav.js`, owned by the integrator)

- Lanes: `nav.travelYaw(e, dir)`, `nav.laneOffset(e, k)`, `nav.laneLine(e, dir, k)` → `{x0,z0,x1,z1,yaw,length}` (from just after the start intersection to the stop line), `nav.lanePoint(e, dir, k, t)` → `{x,y,z,yaw}`, `nav.toNode(e,dir)`, `nav.fromNode(e,dir)`, `nav.trim(e,node)`. `dir` is +1 for a→b (increasing s) and −1 for b→a.
- Intersections: `nav.exits(nodeId, inEdge, inDir)` → `[{edge, dir, turn:'left'|'right'|'straight'|'uturn'}]`, `nav.connector(eIn,dirIn,kIn,eOut,dirOut,kOut)` (quadratic Bézier `{p0,c,p2,length,turn}`), `nav.connectorPoint(con,t)` → `{x,z,yaw}`.
- Signals: `nav.signalState(node, axis, game.clock.time)` → `'green'|'yellow'|'red'|'none'`, `nav.signalRemaining(...)`, `nav.walkSignal(node, crossesAxis, t)` → `'walk'|'flash'|'dontwalk'|'none'`. The cycle is 36 s: NS green 14 s, yellow 3 s, all-red 1 s, then the same for EW.
- Routing: `nav.nearestEdge(x,z)`, `nav.findPath(ax,az,bx,bz)` → `{ points:[{x,z}], length, nodes }` along road centre lines.
- Pedestrian graph: `nav.walk = { nodes:[{id,x,z,owner}], edges:[{id,a,b,length,crosswalk,node,crossesAxis,signal}], adj:[[{to,edge}]], crosswalks }` and `nav.nearestWalkNode(x,z)`. It covers sidewalk rings around every block, outer walkways, and crosswalks at every intersection arm except on bridges.
- GPS: `game.gps.setTarget(x, z, {label, color, source})`, `game.gps.clear(source?)`, `game.gps.route` (`[{x,z}]` from the player), `game.gps.distance`, `game.gps.target`.

## 7. Rendering (owner: **render agent**, files `src/render/*`)

- `createRenderer(canvas, game)` → `THREE.WebGLRenderer`, configured for the quality preset.
- `PostFX`: `init()`, `setSize(w,h)` (also resizes the renderer), `render(dt)` (renders scene + post, owns dynamic resolution), and `setEffect(name, 0..1)`. Effects are `damage` (red vignette pulse), `death` (desaturate, blur, vignette), `arrest` (blue-tinted desaturation), `slowmo`, `speed` (radial speed blur and FOV feel when driving fast), `flash` (white flash, e.g. explosion), `underwater` and `wanted` (subtle red/blue edge pulse). Effects should decay smoothly. Others set them every frame or once, as documented.
- `Sky`: owns the time-of-day look, the sky dome/background, sun/moon/stars, clouds, fog, `scene.environment` (PMREM regenerated as the light changes) and **weather** (`game.weather`, a slow random cycle of mostly clear tropical weather with occasional rain showers). Exposes `sunDir` (Vector3 toward the sun), `moonDir`, `sunColor`, `sunIntensity`, `ambientColor`, `night` (0 day … 1 night), `dusk` (0..1 golden hour), `fogColor`, and `streetlightsOn` (bool, true from dusk to dawn). Others read these: for example, buildings light their windows when `night > 0.3`. **`sky.uniforms`** holds shared uniform objects `{ uSunDir, uSunColor, uNight, uTime (real seconds), uWetness, uRain, uFogColor, uWind }` that Sky updates every frame. Custom shaders in other modules may reference these objects directly, so they stay in sync without per-frame copying. The render agent may add more uniforms but must keep these.
- `Lighting`: sun/moon `DirectionalLight` with shadows (cascaded or a camera-following, texel-snapped map; quality decides). Ambient/hemisphere. **Light pool**: three.js recompiles shaders when the light count changes, so there is a fixed pool. `lighting.acquirePoint()` / `releasePoint(l)` and `acquireSpot()` / `releaseSpot(l)` return a pooled light (or null if none are free). Set position, colour and intensity on the returned light, and release it when done. Pool size depends on quality (low: 2 point, 0 spot; others at least 6 point and 2 spot). `lighting.sun` is the DirectionalLight.

## 8. World visuals

**Buildings** (owner: buildings agent, `src/world/buildings.js` plus any `src/world/bld-*.js`). `Buildings.init()` builds all `city.buildings`, `containers`, landmarks (`meridian`, `ferris`, `lighthouse`, `crane`), and lot dressing `features` (`yard`, `driveway`, `pool`, `parkingLot`, `paving`, `yardPaving`, `gasCanopy`, `plaza`). It doesn't build `park`, `path` or `fountain`: those belong to Nature. Expected: varied facades (window grids, mullions, ribbon windows, balconies, glass reflections or fake interiors, storefronts with awnings and original signage, murals, neon, rooftop clutter, helipads, spires, aircraft-warning lights). Night lighting: windows lit randomly when `sky.night > 0.3`, plus neon glow. Chunked meshes for culling, with LOD for distant buildings. `update(dt)` animates the ferris wheel, blinkers and so on.

**Streets** (owner: streets agent, `src/world/streets.js` plus `src/world/st-*.js`) builds road surfaces for all edges and intersections, bridge decks' **road surface and markings**, lane markings (dashed white, double yellow centre, solid edges, stop lines, crosswalk zebras, turn arrows), sidewalks with curbs (block rings plus `walkways`, including bridge walkways), and all `props` except `palms`, `trees` and `bushes`. That means streetlights, signals (showing live `nav.signalState` per approach), benches, bins, hydrants, bus stops and street-name signs. It hides broken props (listen for `propBroken`; the streets agent may spawn a falling debris mesh). Streetlights glow at night: emissive heads plus **light pools on the ground**, done cheaply, e.g. a shader contribution from a light grid, **not** hundreds of real lights. Asphalt is PBR with wear, cracks, patches and darker tyre tracks. Wet look when `weather.wetness > 0`.

**Nature** (owner: nature agent, `src/world/nature.js`, `src/world/water.js` plus `src/world/nat-*.js`) builds the terrain and seabed (from `city.naturalHeight`), beach sand (wet sand near the waterline), natural land (grass, rock, mangroves), seawalls along `seawall` coasts, `park` and `plaza` interiors (grass, paths, fountains), palms (3 species, wind sway), trees, bushes, umbrellas, lifeguard towers, **bridge structures** (deck underside, girders, piers, railings, arch details; the road surface on top is the streets agent's), the pier deck and pilings, and the marina. **Water** is the ocean and bay: animated waves, fresnel sky reflection, sun glitter, depth-based colour (seabed from `naturalHeight`), shoreline foam, and an underwater fog effect via `post.setEffect('underwater', v)` when the camera is below `waterY`.

## 9. Vehicles (owner: vehicles agent, `src/vehicles/*`)

- `VEHICLE_SPECS[type]`: `{ name, class, mass, power (kW), topSpeed (m/s), dims {length,width,height,wheelBase,wheelRadius}, colors[], police? }` plus whatever tuning physics needs. Types are `compact`, `sedan`, `taxi`, `suv`, `pickup`, `van`, `sports`, `super`, `muscle` and `police`. Names are original. `CIVILIAN_TYPES` is the weighted list traffic uses.
- `buildVehicleModel(type, {color, seed})` → `{ root, body, wheels:[{pivot, mesh}] (FL, FR, RL, RR; FL on +X = driver/left side), lights:{head[], tail[], brake[], reverse[], indicatorL[], indicatorR[], siren[]}, paintMaterials[], dims, seats:[Vector3 local] (0 = driver, on +X), doors:{left, right} (local points where a character stands to enter), steeringWheel (Object3D|null), setColor(hex), update(dt, vehicle) (lights, siren flashing, wheel spin/steer if not done by Vehicle), dispose() }`.
- `Vehicle` fields: `kind='vehicle'`, `id`, `type`, `spec`, `model`, `object3d`, `position` (Vector3, chassis reference at ground level under the wheelbase centre when resting), `quaternion`, `yaw` (heading), `velocity`, `angularVelocity`, `speed` (signed forward m/s), `radius`, `controls {throttle −1..1 (negative = brake, then reverse when nearly stopped), brake 0..1, steer −1..1 (+1 = right), handbrake bool, horn bool}`, `driver` (null | 'player' | Ped | 'ai'), `passengers[]`, `ai` (controller owned by traffic or police), `isPolice`, `sirenOn`, `lightsOn` (headlights), `indicator` (−1/0/1), `health` (0..1000), `maxHealth`, `onFire`, `destroyed`, `inWater`, `upsideDown`, `onGround`, `persistent` (never despawn), `engine {rpm, load, gear, running}`, `skid` (0..1 tyre squeal intensity), `wheels[{contact, slip, surface, worldPos}]`, `color`, `alive`.
- `Vehicle` methods: `place(x,z,yaw,y?)`, `damage(amount, info)`, `explode(source)` (emits `explosion`), `repair()`, `setColor(hex)`, `setLights(on)`, `setSiren(on)`, `getSeatWorld(i,out)`, `getDoorWorld('left'|'right', out)`, `dispose()`.
- `VehicleManager`: `list`, `types`, `spawn(type, x, z, yaw, {color, persistent, y})`, `remove(v)`, `nearest(x,z,maxDist,filter)`, `update(dt)`. **Physics**: a fixed-substep rigid body with raycast suspension per wheel against `collision.surfaceAt` (so it handles curbs, bridges, the pier, sand and water) and a tyre slip model (grip, drift, handbrake slides, surface friction). Engine torque curve, automatic gearbox, aero drag, speed-sensitive steering. Collisions against statics (`collideOBB`), vehicle vs vehicle (OBB impulses with angular response), and vehicle vs peds/player through `game.dyn`: call `ent.onVehicleHit(vehicle, impactSpeed, normal)` and emit `pedHit`. Breakable props snap on impact (emit `propBroken`) without stopping the car dead. Damage model: deformation or dents if feasible, smoke when health < 40 %, fire when < 15 %, then an explosion. Water: buoyancy and sinking, the engine dies, and the player is ejected (emit `vehicleInWater`). Flips and self-righting: none, but an upside-down car catches fire after a while. Emits `vehicleCollision`. Player headlights use a pooled spot light. Brake lights, reverse lights, indicators, siren lightbars and headlight glow are emissive and bloom at night.

## 10. Characters (owner: characters agent, `src/actors/*`)

- `buildCharacter(opts)` → `{ root, bones {hips, spine, chest, neck, head, shoulderL/R, upperArmL/R, forearmL/R, handL/R, thighL/R, shinL/R, footL/R}, height, materials, setOutfit?(opts), dispose() }`. opts: `{ seed, sex:'m'|'f', role:'civilian'|'cop'|'player', skin, hair, top, bottom, shoes, height, build }`. Varied, believable people with original outfits: beachwear, business, casual, and the police uniform. Shared materials and geometry so 50+ characters stay cheap.
- `CharacterAnimator(model).update(dt, state)`. `state` is `{ speed (m/s), sprint, grounded, vy, aim, aimPitch, weapon: null|'pistol'|'smg'|'shotgun', fire (this frame), punch (this frame), seated: null|'driver'|'passenger', steer, dead, knockedDown, fleeing, handsUp, phone, sit, swim, lookYaw, enter (0..1 door/enter progress) }`. Procedural gait (walk/jog/sprint with foot planting), idle breathing and fidgets, jump/fall, driving pose with hands on the wheel, aiming, recoil, punching, knockdown/fall-over, death pose, swimming.
- `Player` (`game.player`): `kind='player'`, `position` (feet), `velocity`, `yaw`, `radius` 0.35, `health`/`maxHealth` 100, `armor`/`maxArmor` 100, `money`, `alive`, `active`, `vehicle` (Vehicle|null), `inVehicle`, `state` ('foot'|'entering'|'driving'|'exiting'|'ragdoll'|'dead'|'swimming'), `grounded`, `aiming`, `sprinting`, `model`, `animator`, `object3d`. Methods: `spawn(x,z,yaw)`, `respawn(x,z,yaw)`, `teleport(x,z,yaw)`, `addMoney(delta, reason)` (emits `moneyChanged`), `damage(amount, info)` (armour absorbs first; emits `playerDamaged`; calls `die` at 0), `heal(n)`, `die(info)` (emits `playerDied`), `arrest()` (emits `playerArrested`), `onVehicleHit(vehicle, speed, normal)` (knockdown + damage), `enterVehicle(v, {instant})` (walk to the door, carjack AI drivers by pulling them out; emits `playerEnterVehicle {vehicle, carjack, previousDriver}`), `exitVehicle({instant})` (emits `playerExitVehicle`), `update(dt)` (input → movement or vehicle controls), `postUpdate(dt)` (sync model, animate). On foot: camera-relative movement, walk/jog/sprint (stamina optional), jump, step up curbs, collisions, swimming in deep water, fall damage. In a vehicle: controls from input (§13). `F` enters/exits. While carjacking, an AI driver is ejected: emit `carjack {vehicle, ped}` and also report the crime (`crime` event, type `carjack`). Footsteps emit `footstep {x,y,z,surface,run}`.
- `CameraRig` (`game.cameraRig`): `mode` ('foot'|'vehicle'|'aim'|'cinematic'|'death'), `yaw`, `pitch` (orbit; on-foot movement is relative to `yaw`), `snapBehind()`, `shake(intensity, duration)` (respects `settings.cameraShake`), and `aimRay(originOut, dirOut)` (screen-centre ray for shooting). On foot: smooth third-person orbit with an over-the-shoulder offset, collision with buildings via `collision.raycast`, and zoom-in while aiming (`input.down('aim')`). In a vehicle: a chase cam with lag, speed-based distance and FOV, auto-centring behind the car, look-back (`lookBack`), and `camera` cycling chase-near / chase-far / hood / bumper. Cinematic (menu): slow, beautiful fly-throughs of landmarks (Meridian Tower, beach, bridges, Sunwheel). Death: an orbit around the body. Uses `settings.fov`.

## 11. AI & gameplay

**Traffic** (owner: traffic/peds agent, `src/ai/traffic.js`). Spawns civilian vehicles (`CIVILIAN_TYPES`) on lanes in a ring around the player (out of view when possible) and despawns them when far. Target count is `quality.trafficCars`. Cars follow `nav` lanes and connectors, obey signals (`nav.signalState`), use car-following (IDM), yield at unsignalised junctions, use indicators, avoid the player and pedestrians, honk, and react to danger: flee from gunfire, or stop and get out after a big crash. They don't drive through each other. Parked cars come from `city.parking` (`quality.parkedCars`). Visible drivers in cars near the camera (seated `buildCharacter`). Handles carjack: when the player takes a traffic car, the AI driver becomes a fleeing ped. Taxi cars sometimes carry passengers. Exposes `traffic.cars` and `traffic.setDensity(mult)`.

**Peds** (owner: traffic/peds agent, `src/ai/peds.js`). `peds.list` (Ped entities), `peds.spawn({x,z,yaw, role:'civilian'|'cop', brain?, model opts}) → Ped`, `peds.remove(ped)`, `peds.panic(x,z,radius,severity)`. A Ped is `{ kind:'ped', position, yaw, velocity, radius 0.35, health 100, alive, isCop, role, model, animator, object3d, state ('walk'|'idle'|'cross'|'flee'|'cower'|'knockedDown'|'dead'|'driving'|'brain'), brain (optional external controller with update(ped, dt)), damage(amount, info), onVehicleHit(vehicle, speed, normal), moveToward(x, z, speed) (for brains), face(yaw), setWeapon(id|null) }`. Peds walk the `nav.walk` graph, wait for walk signals, idle (phone, chat, benches, sunbathe on the beach), and flee or cower on gunshots, explosions and carjacks. When hit by vehicles they fall over and may die. Bodies fade after a while. Dead peds may drop cash pickups (owned by weapons/pickups). Witnesses: when a ped sees a crime, emit a `crime` event with `witness: ped`. Density is `quality.pedestrians`, spawned around the player.

**Wanted** (owner: police agent, `src/gameplay/wanted.js`). `level` (0..5 stars), `heat`, `lastSeen {x,z}`, `searchRadius`, `seen` (cops can see the player now), `cooldown`, `report(type, x, z, opts)`, `setLevel(n)`, `clear()`. Listens for `crime` events and police witnessing. Crimes include `carjack`, `steal` (entering a parked car is minor), `hitPed`, `killPed`, `shoot` (discharge), `assault`, `hitCop`, `killCop`, `damageCop` (vehicle), `explosion` and `speedingPastCop`. Escape: break line of sight and leave the search area so it cools down; stars flash while searching. Emits `wantedChanged {level, prev}`.

**Police** (owner: police agent, `src/gameplay/police.js`). Dispatches `police` vehicles with sirens that scale with level (more units, aggression, ramming/PIT, roadblocks at 4+, a helicopter with a searchlight at 4+ is a bonus), cops on foot (via `peds.spawn({role:'cop', brain})`) who chase, arrest the player (`player.arrest()` when they hold a slow or stationary player on foot, or box in a stopped car) and shoot at level 3+ via `weapons.fire`. They patrol when level is 0. Exposes `police.units`.

**Weapons** (owner: police agent, `src/gameplay/weapons.js`). `WEAPONS` table (fist, pistol, smg, shotgun, rifle?), `weapons.inventory {id: {ammo, clip}}`, `weapons.current`, `give(id, ammo)`, `select(id)`, `fire(shooter, origin, dir, weaponId)` (hitscan: `collision.raycast` plus dynamic entities through ray-vs-capsule for peds/player and ray-vs-OBB for vehicles; applies `damage(amount, {type:'bullet', source, point, dir, weapon})`; emits `gunshot` and `bulletImpact`), and `update(dt)` (player aiming and firing from `cameraRig.aimRay`, reload, weapon switching through 1–4 and the mouse wheel, punching). Also handles world **pickups** (weapons, ammo, armour, health, cash from peds) with glowing markers, plus an ammo shop at the gas stations (optional). Reports `shoot` crimes.

**Effects** (owner: police agent, `src/fx/effects.js`). `effects.spawn(type, opts)` returns `{stop(), update()}` for continuous types. Types: `tireSmoke {position, velocity, intensity}`, `dust`, `sparks {position, normal, count}`, `muzzleFlash {position, direction, weapon}` (with a pooled light flash), `bulletImpact {position, normal, surface}`, `tracer {from, to}`, `explosion {position, radius}` (fireball, smoke column, debris, shockwave, light, camera shake), `fire {position, follow (Object3D), duration}`, `smoke {position, follow, intensity}`, `splash {position, size}`, `glass {position, normal}`, `debris {position, velocity, color}`, `hit {position, normal}` (cloth puff, non-graphic), `waterSpray {position, duration}` (broken hydrant). Also `effects.skidMark(key, position, intensity, width)` (continuous tyre-mark ribbons that fade over time), `effects.decal('bulletHole', position, normal)`, and `update(dt)`. Effects also **listen** for `explosion`, `bulletImpact`, `gunshot` (muzzle flash for non-player shooters if a position is given), `propBroken` (sparks/debris; a hydrant gets a water spray) and `vehicleCollision` (sparks above a threshold). Rain particles while `weather.rain > 0`. GPU-friendly: pooled instanced particles, no per-particle meshes.

**Missions** (owner: missions agent, `src/gameplay/missions.js` plus `src/gameplay/mis-*.js`) provides `missions.active`, `start(id)`, `fail(reason)`, `complete()`, `spawnPoint()` (Continue spawns at the safehouse), `update(dt)`, and save/load (`localStorage` key `bravabay-save-v1`: money, completed missions, stats, weapons). Content: a short original story chain of 5–6 missions from original contacts at the `cafe` and `garage` POIs (driving, theft, escaping cops, a chase, a race, a finale), side activities (street races, taxi fares in a `taxi`, courier deliveries, hidden collectibles), 3D glowing start markers (press `E`), objectives via HUD events, GPS routes, blips, timers and checkpoints, and pass/fail screens with rewards.

## 12. UI & audio

**HUD** (owner: UI agent, `src/ui/*`, `src/index.html` styles/markup) has `show()`, `hide()` and `addBlip({x,z | entity, icon, color, label, route, flash, scale, minimapOnly})` → `{remove(), set(opts)}`, and `update(dt)`. Elements: a minimap/radar (rotating with the camera, roads drawn from `city`, blips, the GPS route line `game.gps.route`, a north marker, and the police search-area circle `wanted.searchRadius`), health and armour bars, a money counter with animated deltas, wanted stars (flashing while searching), the weapon icon and ammo, a speedometer and gear in vehicles (km/h or mph from settings), the district and street name on change, the clock, and the radio station popup. It listens to `notify {text, duration}`, `subtitle {text, speaker, duration}`, `objective {text}`, `help {text, duration}`, `bigMessage {title, subtitle, color, duration, style}`, `hudTimer {seconds|null, label}`, `hudCounter {label, value, max}|null`, `moneyChanged`, `wantedChanged`, `radioChanged`, `playerDamaged` (hit direction indicator), `missionComplete`, `missionFailed`, and a crosshair while aiming. Also the full-screen **map** (a pause menu tab) with pan/zoom, a legend, and click to set a waypoint (`gps.setTarget(x,z,{source:'waypoint'})`).
**Menu**: a title screen over the cinematic camera (Continue / New Game / Settings / Controls / Credits), a pause menu (Resume, Map, Settings, Controls, Quit to title), settings bound to `game.settings` with `game.saveSettings()` (quality changes reload the page), and touch controls for mobile (virtual stick plus buttons via `input.setVirtual*`). `canResumeWithKey()`. The design is original and polished: sunset palette, clean typography, glass panels.

**Audio** (owner: audio agent, `src/audio/*`) has `start()` (on a user gesture), `play(name, {position, volume, rate})`, `setVolumes()`, `update(dt)` (listener follows the camera), and `radio.next()`, `radio.off()`, `radio.current`, `radio.stations[{name, genre, freq}]`. All sound is synthesised in WebAudio. Engine sounds per vehicle class from `engine.rpm/load` for the nearest ~6 vehicles. Tyre squeal from `skid`, wind by speed, collisions, horns, sirens, gunshots, explosions, footsteps by surface, splashes, city ambience (traffic hum, birds by day, insects at night), ocean surf near the beach, rain, UI clicks, and mission jingles. The **radio** has 4–5 original procedural stations (synthwave, Latin urban, lo-fi, salsa/brass, plus a talk/ads station using `speechSynthesis` if available, with original scripts). It plays only in vehicles and is muffled outside; `Q` cycles stations and emits `radioChanged {station}`. Audio listens to events (`gunshot`, `explosion`, `vehicleCollision`, `propBroken`, `pedHit`, `footstep`, `playerEnterVehicle`, `playerExitVehicle`, `missionComplete`, `missionFailed`, `moneyChanged`, `wantedChanged`, `bigMessage`, `horn`, `bulletImpact`, `splash`). Volumes come from settings.

## 13. Input (`src/core/input.js`, owned by the integrator)

`input.down(action)`, `input.pressed(action)`, `input.released(action)`, `input.axis('moveX'|'moveY'|'lookX'|'lookY'|'throttle'|'brake'|'steer')`, `input.mouse {dx,dy,wheel,locked}`, `input.setVirtual(action, held)`, `input.setVirtualAxis(axis, v)`, `input.enabled`, `input.lastDevice`, `input.rumble(strong, weak, ms)`, `input.lockPointer()`.

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| move / steer | WASD / arrows | left stick |
| look | mouse | right stick |
| throttle / brake-reverse | W / S | RT / LT |
| sprint | Shift | B |
| jump (foot) / handbrake (vehicle) | Space | A (handbrake also RB) |
| enter / exit vehicle | F | Y |
| interact (start mission, pick up) | E | D-pad right |
| attack / fire | left mouse | RT |
| aim | right mouse | LT |
| reload | R | X |
| weapons | 1–4, mouse wheel | LB/RB (UI agent may map) |
| horn | H | left-stick click |
| headlights | L | D-pad down |
| siren (police car) | G | (none) |
| look back | C | right-stick click |
| camera view | V | Back |
| radio next / off | Q / X | D-pad left |
| map | M | D-pad up |
| pause | Esc / P | Start |
| phone (optional) | T | (none) |

## 14. Events (`game.events.emit(name, payload)`)

Positions are `{x,y,z}`-like (a Vector3 is fine). Don't mutate payloads.

| Event | Payload | Emitted by |
|---|---|---|
| `gameStart` | `{continued}` | main |
| `paused`, `resumed` | `{}` | main |
| `respawn` | `{reason:'dead'|'arrested', poi}` | main |
| `resize` | `{width,height}` | main |
| `playerDamaged` | `{amount, info}` | player |
| `playerDied` | `{cause, info}` | player |
| `playerArrested` | `{}` | player |
| `playerEnterVehicle` | `{vehicle, carjack, previousDriver}` | player |
| `playerExitVehicle` | `{vehicle}` | player |
| `carjack` | `{vehicle, ped}` | player / traffic |
| `footstep` | `{x,y,z,surface,run,entity}` | player, peds (peds only near the camera) |
| `moneyChanged` | `{amount, delta, reason}` | player |
| `vehicleSpawned` / `vehicleRemoved` | `{vehicle}` | vehicles |
| `vehicleCollision` | `{vehicle, other ('static'|Vehicle|Ped|Player), impulse, point, normal, speed}` | vehicles |
| `vehicleInWater` | `{vehicle}` | vehicles |
| `horn` | `{vehicle}` | vehicles (on press) |
| `propBroken` | `{collider, prop, vehicle, impulse}` | vehicles (or weapons) |
| `pedHit` | `{ped (or player), vehicle, speed}` | vehicles |
| `pedKilled` | `{ped, killer, cause}` | peds |
| `explosion` | `{x,y,z, radius, source, vehicle?}` | vehicles, weapons |
| `gunshot` | `{x,y,z, shooter, weapon, dir}` | weapons |
| `bulletImpact` | `{x,y,z, normal, surface, target}` | weapons |
| `crime` | `{type, x, z, severity, witness?, victim?}` | player, peds, vehicles, weapons |
| `wantedChanged` | `{level, prev}` | wanted |
| `notify` | `{text, duration}` | anyone |
| `subtitle` | `{text, speaker, duration}` | missions |
| `objective` | `{text}` (empty clears) | missions |
| `help` | `{text, duration}` | anyone (context hints) |
| `bigMessage` | `{title, subtitle, color, duration, style}` | main, missions |
| `hudTimer` | `{seconds|null, label}` | missions |
| `hudCounter` | `{label, value, max}` or `null` | missions |
| `missionStart` / `missionComplete` / `missionFailed` | `{mission, reward?, reason?}` | missions |
| `radioChanged` | `{station: {name, freq, genre} | null}` | radio |
| `gpsChanged` | `{target}` | gps |
| `splash` | `{x,y,z,size}` | vehicles, player |
| `pickup` | `{type, amount}` | weapons |
| `weaponChanged` | `{weapon}` | weapons |

## 15. Ownership

| Owner | Files |
|---|---|
| integrator (lead) | `src/main.js`, `src/core/*`, `src/world/citygen.js`, `src/world/collision.js`, `src/world/nav.js`, `CONTRACT.md`, `build.mjs`, `tools/*`, `package.json` |
| render | `src/render/*` |
| buildings | `src/world/buildings.js`, `src/world/bld-*.js` |
| streets | `src/world/streets.js`, `src/world/st-*.js` |
| nature | `src/world/nature.js`, `src/world/water.js`, `src/world/nat-*.js` |
| vehicles | `src/vehicles/*` |
| characters | `src/actors/*` |
| traffic/peds | `src/ai/*` |
| police/combat | `src/gameplay/wanted.js`, `src/gameplay/police.js`, `src/gameplay/weapons.js`, `src/fx/*` |
| missions | `src/gameplay/missions.js`, `src/gameplay/mis-*.js` |
| UI | `src/ui/*`, `src/index.html` (keep ids `gl`, `ui`, `loading`, `load-bar`, `load-msg` and the `/*__BUNDLE__*/` marker) |
| audio | `src/audio/*` |

## 16. Performance budget

- Medium preset on an integrated GPU: aim for ≥ 50 fps at 1080p with dynamic resolution, ≤ 400 draw calls and ≤ 2.5 M triangles in a downtown view. Low preset (Chromebooks): ≤ 150 draw calls.
- Build geometry once at init in under 3 s total for your module where possible. Use `InstancedMesh` and `BufferGeometryUtils.mergeGeometries` per chunk (about 200 m), frustum culling per chunk, LOD by distance (`quality.drawDistance`, `propDistance`). Share materials. Avoid per-frame allocations in hot paths (reuse vectors).
- The bundle grows only by code. Generate textures at runtime with canvas or GPU, at 512–1024 px, and reuse them.

## 17. Git hygiene for module agents

Commit **only your owned source files** (`git add brava-bay/src/<your paths> …`). **Never commit `brava-bay/index.html`** (it is build output and would conflict between branches): run `git checkout -- brava-bay/index.html` before committing, or simply don't stage it. Don't commit screenshots or node_modules.

## 18. Definition of done (every module)

1. `npm run build` succeeds, and the game loads with **no console errors** (`tools/shot.cjs`).
2. You took screenshots at the times of day and places relevant to your module, and they look premium and realistic: not boxy placeholders, not oversaturated, not flat-shaded.
3. Your API matches this contract and the stubs' signatures. Other modules still work.
4. Performance is reasonable on `quality=low` in SwiftShader (it shouldn't tank the FPS printed by the harness).
