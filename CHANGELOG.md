# Changelog

## 1.5.4

- Keep inline diagrams inside their cards and scale oversized SVGs proportionally in narrow notes, including diagrams with fixed inline dimensions.
- Preserve fullscreen geometry and restore original SVG sizing when the plugin's scope changes or it unloads.

## 1.5.3

- Load all viewer and diagram CSS through the Obsidian-managed stylesheet, without injecting style elements.
- Preserve fixed SVG geometry, light colors and reversible inline styling in the shared document.
- Use the dedicated Obsidian span helper throughout the controls.
- Publish only the three supported installation assets, with GitHub build provenance verified before publication.

## 1.5.2

- Publish complete, verified GitHub Release assets with a versioned title and release notes.
- Use Obsidian DOM helpers, owning-window animation frames and the active Markdown view API.
- Make settings searchable on Obsidian 1.13+, retaining the settings UI on older versions.
- Replace forced CSS overrides with scoped rules and reversible inline-style normalization.
- Remove broad hover selectors, clip-path and duplicate height declarations while preserving the light canvas and stable zoom.
- Add CSS and source checks plus regression coverage for styling, settings, Live Preview cleanup and release attachments.

## 1.5.1

- Rename the plugin and package to Mermaid Viewer (`mermaid-viewer`).
- Split documentation into an English README and a Chinese README, focused on previews, features and usage.
- Include both guides and example images with the local installation.

## 1.5.0

- Adopt the Mermaid Paper Viewer identity and `mermaid-paper-viewer` plugin ID.
- Use the `mpv-` namespace throughout source, styles and tests.
- Simplify settings and coloring to a generic, semantic-class-based viewer.
- Add bilingual documentation, original Mermaid examples and reproducible screenshots.

## 1.4.1

- Remove the extra Live Preview hover frame and align native source editing with the card header.
- Preserve other code blocks and keyboard focus indicators.

## 1.4.0

- Separate camera, input, UI, SVG, theme, settings and host integration into strict TypeScript modules.
- Add reproducible builds, validation, unit/browser tests, CI and draft Release workflows.
- Add configurable note scope and synchronous initial viewport layout.

## 1.3.0

- Use a fixed light surface, thin lifelines and a compact fullscreen layout.
- Improve width-based reading, touch gestures, Escape handling and cleanup.

## 1.2.0

- Use an SVG viewBox camera for stable zoom and fractional anchor positioning.
