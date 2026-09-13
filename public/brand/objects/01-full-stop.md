# Object 1 — the full stop

**What it is.** The brand mark made physical: a sphere in the brand green, the
same proportion to the wordmark as the flat stop (0.3em of the cap height).

**Material.** Matte satin. No gloss, no chrome, no subsurface glow. Roughness
around 0.55; specular tight and low (a single soft highlight upper-left, white
at no more than 55% opacity).

**Palette.** Body `#86BC25`; the lit rim toward `#C4D600`; the shaded side
through `#26890D` to black. Contact shadow black at 55% falling to 0. Nothing
else. On a light ground the shadow stays black and the rim highlight drops to
35%.

**Lighting.** One key light, upper-left, 35° elevation, 40° off-axis. One low
fill from the ground plane at 10% so the underside does not go to pure black.
No rim light: a rim light reads as glow, and glow is the default look this
guide refuses.

**Camera.** Straight on, 50mm equivalent, the sphere's centre a third from
the top of the frame, sitting on an invisible ground plane that only the
contact shadow reveals.

**Allowed angles.** Static only. No rotation, no bounce, no pulse. It may fade
in over 400ms on first paint and it may drift at most 8px with the hero's
parallax; under reduced motion it is simply present.

**Where.** Sign-in (top right of the lockup), empty states (beside the
sentence, never above it), loading states (beside the skeleton). Never inside
a grid, table, form, chart or dialog.

**Files.** `full-stop-3d.svg` is the flat-rendered reference; the raster
export is WebP/AVIF at 320px and 640px, at most 300 KB, with
`full-stop-flat.svg` as the fallback.
