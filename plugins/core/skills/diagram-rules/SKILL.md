---
name: diagram-rules
description: Use when hand-authoring or reviewing an SVG or HTML diagram of structure or mechanism, such as architecture, flowchart or process flow, sequence, state machine, ER/data model, swimlane, or any boxes-and-arrows schematic, including inside an artifact; also when such a diagram carries Hebrew or other right-to-left labels. Companion to artifact-diagramming, adding connector rules, a complexity budget, theme-safe color, RTL handling, and a pre-output checklist. Not for Mermaid, ASCII, or data plots: charts, graphs, dashboards, and any quantitative data visualization belong to the dataviz skill.
---

# Diagram rules

Hard rules for hand-authored SVG diagrams. `artifact-diagramming` decides what to
draw and the SVG basics; this skill adds the layout rules, a budget, theme safety,
RTL, and a gate. Charts and plots go to `dataviz`.

Adapted from cathrynlavery/diagram-design (MIT, notice in
[LICENSE-diagram-design](LICENSE-diagram-design)), https://github.com/cathrynlavery/diagram-design at commit cea465e7f5ea1043d8dab21a99f2dd3f7f661beb.

## Principle

Deletion is the best edit. Each node is one distinct idea (two nodes that always
travel together are one node); each edge says something the layout doesn't already
show. The diagram is done when nothing more can be removed.

## Complexity budget

| Limit | Max |
|---|---|
| Nodes / arrows | 9 / 12 |
| Accent (focal) elements | 2 |
| Sequence: lifelines / combined fragments / fragment nesting | 5 / 1 / 1 |
| ER entities | 8 |
| Swimlanes | 5 |
| Tree depth | 4 |
| Annotation callouts | 2 |

Over budget: split into an overview plus a detail diagram. Never shrink text to fit.

## Theme safety (light and dark)

- No hex on elements. Text, strokes, arrowheads: `currentColor`. Tints:
  `fill="currentColor"` plus `fill-opacity`. Other roles (`--bg`, `--accent`) are page
  tokens defined once with a dark override; reuse the host page's tokens when present.
- Reference tokens via `style="fill: var(--bg)"` or page CSS classes; prefer these
  over `fill="var(...)"` attributes for portability. No `<style>` inside the SVG.
- Opaque masks (behind arrow labels, under node boxes) fill with the background
  token, never literal white. A hex mask is the classic dark-mode break.
- Markers inherit from their own ancestors, not from the path using them, so
  `currentColor` in a marker resolves at `<defs>`. One marker per color role.
- Accent on 1-2 focal elements. If four things feel important, nothing is focal yet.

## Anti-patterns

- Dark ground plus neon or cyan/purple glow as "technical" styling.
- Identical boxes for every node. Vary by role: focal, service, store, external,
  optional (dashed).
- Legend floating inside the drawing. Use a strip below, only for repeated encodings.
- Vertical `writing-mode` text on arrows.
- Shadows, glows, corner radius above ~10px.
- Monospace as a blanket "dev" font. Mono is for technical strings (ports, commands,
  URLs, types); names are sans.
- Reproducing Mermaid or auto-layout output instead of placing nodes deliberately.
- Structural geometry (origins, sizes, gaps, padding) off a 4px grid.

## Connector rules (any breach is a fail)

Draw connectors before boxes so boxes paint over line ends.

1. **Orthogonal only.** Nodes not sharing an x or y connect by right-angle paths
   with rounded elbows (arc r=8, min 6). No diagonal lines.
2. **Label gap.** Labels sit beside their segment, never on it: opaque mask, then a
   visible 6-10px gap to the stroke. Vertical segment: label to the side. Keep labels
   to about 14 characters.
3. **No overlap.** Connectors never share or stack on a path; parallel runs stay
   12px or more apart end to end; a crossing gets a small hop arc. Needing to stack
   means the layout or the budget failed.
4. **Fan attach points.** N connectors on one edge of length L attach at
   L*k/(N+1), k=1..N, at least 12px apart (8px on tiny boxes). No shared points.
5. **No transit behind a non-endpoint box.** Reroute. Only when a cross-cutting box
   (a full-width layer bar) blocks the sole straight path: dashed stroke, label at
   the visible end, no arrowhead on the intervening box.
6. **Masks clear later nodes.** A label mask overlapping a node painted after it gets
   cut off. Put labels on open-canvas segments; a chip fully inside a node is fine.

## Hebrew / RTL

**Flow.** Hebrew-primary: start at the right and flow leftward. English- or
code-dominant labels: keep left-to-right. Mixed audience or unsure: top-to-bottom,
which is direction-neutral. Mirror by recomputing coordinates, never
`scale(-1,1)` (it mirrors glyphs); `orient="auto"` markers follow the path.

**Base direction.** Pure Hebrew words shape correctly under any base direction, but
punctuation and mixed runs resolve against it: under an LTR base `שלום!` puts the
`!` on the wrong side and `ל-API` reads backwards. Set it explicitly:
- SVG: `direction="rtl"` on each Hebrew `<text>`, or on a `<g>` of RTL-only text.
  SVG has no `dir` attribute. Prefer a separate `<text>` per direction: any
  `<tspan>` reorders only with `unicode-bidi="embed"` (or `isolate`); `direction`
  alone, even with its own x, flips the anchor but leaves `!` on the LTR side.
- Inline SVG inherits CSS `direction` from the HTML `dir`, so an RTL host page flips
  every `<text>`. Set `direction` on the `<svg>` so the drawing ignores its host.
- HTML labels, legends, captions: `dir="rtl"` on the container, `lang="he"`,
  `dir="auto"` for user-supplied text, logical CSS (`margin-inline-start`,
  `text-align: start`) so the layout mirrors.

**text-anchor.** `middle` is direction-neutral: use it for node labels. `start` and
`end` follow the text's direction, so under rtl `start` pins the right edge at x.
Exception: when a `unicode-bidi` tspan that changes direction ends the text, WebKit
flips the anchor (rtl `start` pins the left edge); use `middle`, an LRM, or a
separate `<text>` instead. Verify start/end in rasterizers (librsvg, resvg,
Inkscape) before export.

**Mixed runs.** A Latin token ending in neutrals (`C++`, `C#`) inside RTL text shows
them on the wrong side (`++C`). In SVG, add an LRM (`&#x200E;`) right after the
token; LRI...PDI isolates are ignored in WebKit SVG text. In HTML, use `<bdi>` or
`<span dir="ltr">`. The mirror case, a Hebrew run ending in punctuation inside LTR
text, takes an RLM (`&#x200F;`). Code, URLs, ports, and paths are always LTR: give
them their own `direction="ltr"` mono sublabel.

**Fonts.** Use a family with Hebrew glyphs; a fallback font changes widths and breaks
box sizing. Stack: Heebo, Assistant, or Noto Sans Hebrew (web), then "Arial Hebrew"
(macOS), Arial (Windows), `system-ui, sans-serif`. Mono fonts mostly lack Hebrew, so
keep Hebrew out of mono. Hebrew has no case: signal with weight, not uppercase. Size
boxes from rendered width (`getComputedTextLength()`), not character counts.

## Pre-output checklist

- [ ] A table or paragraph would not do the same job.
- [ ] Remove test: no removable node, mergeable pair, arrow the layout implies, or
      label the shape already says.
- [ ] Within budget, or split into overview + detail.
- [ ] Accent on at most 2 elements; legend covers every repeated encoding, nothing extra.
- [ ] Connector rules 1-6 hold; connectors drawn before boxes.
- [ ] No hex on elements; masks use the background token; one marker per color role;
      checked in both light and dark.
- [ ] `role="img"` plus a name: `aria-label` in a `<figure>` with `<figcaption>`, or,
      standalone, `<title>` as first child plus `<desc>`, with
      `aria-labelledby="p-title p-desc"` naming both (per-diagram prefix `p`, never
      bare `id="title"`). The description states content, not geometry.
- [ ] Any Hebrew: base direction set, flow direction chosen, mixed runs fixed, and a
      render actually looked at.
