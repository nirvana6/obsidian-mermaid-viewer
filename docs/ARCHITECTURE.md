# Architecture

`src/main.ts` composes the plugin. Obsidian renders Mermaid; the viewer decorates and clones the generated SVG. The only external runtime module is `obsidian`.

| Module                             | Responsibility                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `settings-model.ts`, `settings.ts` | Scope validation, persistence and settings UI                                |
| `integration/note-observer.ts`     | Eligible diagrams, inline controls and reversible cleanup                    |
| `diagram/metadata.ts`              | Note and heading metadata through the public View API                        |
| `viewer/modal.ts`                  | Modal lifecycle and module coordination                                      |
| `viewer/camera.ts`                 | Pure zoom, pan and fit geometry                                              |
| `viewer/input.ts`                  | Mouse, keyboard, wheel, touch and pointer cleanup                            |
| `viewer/ui.ts`                     | Controls, help and legends                                                   |
| `viewer/svg-viewport.ts`           | Fixed inner SVG and outer camera viewport                                    |
| `theme/`                           | Generic semantic roles and reversible SVG styling                            |
| `styles.css`                       | Light surfaces, inline cards, Live Preview integration and fullscreen layout |

## Invariants

1. Camera calculations retain fractional coordinates. The zoom anchor stays at the same screen position.
2. Zoom changes only the outer SVG viewBox; the original SVG dimensions and HTML label layout remain fixed.
3. The light surface opts out of the host's dark-mode inversion.
4. Scope accepts an empty string or one CSS class, never an arbitrary selector.
5. Decoration removes only its own controls, `mpv-` classes and `data-mpv-*` attributes. Note text is never changed.
6. Observers, pointers, event listeners and animation frames are cleaned up on disposal.
7. Obsidian Scope handles Escape: close help before closing the viewer.
8. Node colors depend on semantic classes, not labels or application-specific names.
9. Initial camera layout is synchronous. Paused background animation frames must not leave an uninitialized viewport.
10. Live Preview overrides apply only to a host containing an owned `.mermaid.mpv-note-diagram` and `.mpv-mermaid-embed` classes. Native source-edit actions keep their original behavior.
11. Inline cards and SVG viewports fit the note width. Oversized SVGs shrink proportionally without changing the viewBox or label geometry; conflicting inline viewport styles are restored on cleanup. The fullscreen clone is excluded from these responsive rules.

## Verification

- Unit tests exercise camera geometry, scope normalization and semantic roles.
- Browser tests exercise the built bundle with the API mock in `tests/helpers/`.
- Theme tests check contrast, actor bounds and host-theme invariance. Integration checks cover exact style restoration, concurrent DOM edits, scoped hover styling and searchable settings. Inline layout tests cover fixed and inline SVG dimensions, narrow notes, aspect ratios, fullscreen isolation and cleanup without host-provided sizing styles.
- Source and CSS lint reject direct style assignments, deprecated active-leaf access, global animation frames, native DOM creation, forced CSS overrides and broad parent selectors.
- CSS is bundled from `styles.css` and `src/theme/svg.css` into `dist/styles.css`, which Obsidian loads. Runtime code adds no style elements. Inline palette normalization reads these loaded rules and restores original declarations on cleanup.
- Release tests reject missing, stale or unsupported assets. The release workflow attests the three install assets and verifies downloaded bytes and provenance before publishing.
- `docs/examples/*.mmd` are the source of both SVG fixtures and documentation screenshots. Regenerate with `npm run build` and `npm run docs:images`.
- A real Obsidian installation remains necessary for host integration checks.

Flowcharts and sequence diagrams have the broadest coverage. Other diagram types keep their internal styles when their structure is unrecognized. Pop-out windows, embedded Canvas surfaces, the declared minimum app version and mobile devices need dedicated verification before being advertised as supported.
