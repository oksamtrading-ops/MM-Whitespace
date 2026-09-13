# Object 4 — the ore body

**What it is.** A resource model: a translucent block of ground with a
mineralised body inside it, the way a geologist's block model shows it.

**Material.** The ground block is cool grey 11 `#53565A` at 25% opacity with
hairline edges in cool grey 10 `#63666A`; the ore body inside is the brand
green `#86BC25` at 85%, matte, with the sequential ramp's darker steps
(`#26890D`, `#046A38`) where it thickens. No glow, no bloom, no gradient
that leaves the green ramp.

**Palette.** Greys 10 and 11, the green ramp, black. Nothing else.

**Lighting.** One key light upper-left as object 1, so the block's top face
is the lightest and the body's upper surface catches it.

**Camera.** Isometric, 30°/30°, the block filling two-thirds of the frame.

**Allowed angles.** Static. No rotation: a turning block model is a demo
cliché and it would read as data when it is decoration.

**Where.** The runs page while a run is in progress (beside the state bar,
not over it) and the upload page's "what happens next" rail. Never on a
chart.

**Files.** WebP/AVIF at 640×480 and 1280×960, at most 300 KB; fallback a
flat SVG of the block outline with a green polygon.
