# Daniel Nelson — Engineering Portfolio

Personal engineering portfolio: Formula SAE valvetrain redesign, a two-axis hydraulic flight simulator,
nonlinear-optics research, a hydrogen–oxygen ignition model, and supporting projects.

The site is plain **HTML, CSS and JavaScript** — no framework, no build step. Every page is a real
`.html` file you can open and edit directly.

## View it

- **Quick look:** double-click `index.html`.
- **Exactly as it will be served:** from this folder run `python3 -m http.server 8000` and open
  <http://localhost:8000>.

## Publish with GitHub Pages

1. On GitHub: **Settings → Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. The site appears at `https://dnl2030.github.io/EngineeringPortfolioDanielN/` within a minute or two.

The empty `.nojekyll` file tells GitHub to serve the files as-is.
If you later use a custom domain, update the absolute links in `404.html` (they start with `/EngineeringPortfolioDanielN/`).

## Layout

```
index.html                 Home: identity, selected work, project register, workshop, "where the threads meet"
about.html, resume.html    About and a printable HTML resume
work/<project>.html        One page per project (four in-depth pages, seven compact ones)
404.html                   "Sheet not found"
assets/css/site.css        All styles. Design tokens (colors, type scale, spacing, motion) are at the top.
assets/js/site.js          Line drawing on scroll, video loops, mobile menu, lightbox, register filter, FSAE process rail
assets/js/physics.js       Calculations behind the Formula SAE figures (restrictor flow, cam motion laws)
assets/js/figures/fsae.js  Formula SAE interactive figures
assets/js/figures/sim.js   Flight-simulator piston targets, ported from the project's Python IK routine
assets/js/figures/spdc.js  SPDC Type II phase-matching heatmap, ported from Phase_matching_graphs.py
assets/js/figures/fourier.js  Fourier Lab, ported from the Flask app (app.py, DisplayFunction.py, displayfft.py, script.js)
assets/js/figures/h2map.js    Hydrogen 3D flammability map, ported from Plot_3D_Flammability.py (Dash)
assets/js/figures/mechanism.js  Hydrogen mechanism explorer (trace a species through the 19 reactions)
assets/js/figures/gamesense.js  GameSense force-footprint viewer, adapted from force_footprints.html
assets/data/                Data for the live figures (3D map grid, simplified cleat mesh, simulated kicks)
assets/vendor/              Plotly 3D and three.js builds (MIT licenses alongside), loaded only by the pages that use them
assets/img/<project>/      Images as WebP: <name>.webp (large) and <name>-sm.webp (small)
assets/video/              MP4 videos and their poster images
assets/fonts/              Geist, Geist Mono and Archivo (SIL Open Font License — see the LICENSE files)
tools/add-image.sh         Converts a new photo into the two WebP sizes and strips its metadata
```

## Editing content

- **Text:** edit the page's HTML directly.
- **Add an image:** `tools/add-image.sh photo.jpg <project-folder> <nn-short-name>`, then copy an existing
  `<figure>` on the page and change `src`, `srcset`, `width`, `height`, `alt` and the caption.
  Use `class="cover"` with `style="--fx:50%; --fy:30%"` to choose the crop point when an image fills a frame.
- **Add a video:** encode with
  `ffmpeg -i in.mov -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart -an -map_metadata -1 out.mp4`,
  save a poster frame as a `.jpg` next to it, and copy an existing `<video>` tag.
- **Add a project:** copy a compact page such as `work/catalyst-review.html`, give it the next sheet number,
  and add an `<li>` to the right group in the "All projects" section of `index.html` (newest first).
  Add `data-thumb="assets/img/<folder>/<name>-sm.webp"` to the link to show an image preview on hover.

## Evidence labels

Results are tagged so modeled and measured work are never confused:

| Class | Meaning |
|---|---|
| `ev ev--measured` | physical measurement or inspection |
| `ev ev--modeled` | simulation or analytical model output |
| `ev ev--built` | hardware made (and tested where noted) |
| `ev ev--result` | competition placing or award |
| `ev ev--literature` | reported by others, reviewed |
| `ev ev--dev` | in development |
