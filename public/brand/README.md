# Whitespace brand assets

Assets for the Mining Whitespace Intelligence Tool, built for Deloitte Canada's
Mining & Metals practice. The rules for using them are in
`docs/design/18-brand-guide.md`, sections 2 and 11; this file says what each
file is and what it may be used for.

## Licence and use

Internal to Deloitte. Nothing here may be published, shared outside the firm,
or used to represent Deloitte in any external material: the product is a proof
of concept and the co-branding lockup is a placeholder until the brand hub
supplies the firm's own wordmark asset *[confirm]*. Open Sans (SIL OFL 1.1) and
Archivo (SIL OFL 1.1) are self-hosted through `next/font`; the SVGs here name
the faces but do not embed them, so a viewer without the fonts sees Arial.

## Files

| File | What it is | Where it may appear |
|---|---|---|
| `wordmark-dark.svg`, `wordmark-light.svg` | "Whitespace" with the green full stop, for a dark or a light ground | Anywhere the product names itself: the top bar, documents, decks |
| `lockup-dark.svg`, `lockup-light.svg` | The wordmark with DELOITTE set beneath in tracked capitals | Sign-in, print headers, the export cover. **Placeholder lettering** until the brand hub's asset replaces it |
| `favicon.svg`, `favicon-16.png`, `favicon-32.png` | Black rounded tile, green dot lower-right | Browser tab. `src/app/icon.svg` is the same drawing and is the one Next serves |
| `app-icon.svg`, `app-icon-180.png`, `app-icon-512.png` | The tile at app-icon proportions (radius 22%) | Home-screen and PWA icons |
| `app-icon-light.svg` | The tile on white with a hairline, for light document grounds | Decks and print where a black tile would sit heavy |
| `full-stop-3d.svg` | The full stop as an object: a matte satin sphere, lit upper-left, contact shadow | Sign-in, empty states, loading, section heroes. Never inside a grid, table, form or chart |
| `full-stop-3d.png`, `full-stop-3d@2x.png` | The same, rasterised at 320px and 640px (36 KB and 119 KB, under the 300 KB budget) | Where an SVG cannot be used (mail, decks) |
| `full-stop-flat.svg` | The flat fallback: a plain green disc | Forced-colours mode, print, reduced motion where the rendered object would animate |
| `objects/*.md` | Rendering briefs for the other three objects | For whoever renders them; nothing ships until it passes the budget |

## Budgets

- A rendered object: at most 300 KB as compressed WebP or AVIF, with a 2× variant, plus a flat SVG fallback. The PNGs here are placeholders for the WebP/AVIF exports the render pipeline will produce; both PNGs are already under the cap.
- No WebGL anywhere. The map's 3D form is an SVG under a CSS perspective transform, at most 8px of parallax, and it is flat under reduced motion, in print and in forced colours.

## Colours

Every colour in these files is a token from `src/app/globals.css`: the brand
green `#86BC25`, its ramp steps `#C4D600` and `#26890D`, black, white, and cool
greys 2 and 11. The sphere's shading is the green toward black and its
highlight is white at low opacity; no other hue appears.
