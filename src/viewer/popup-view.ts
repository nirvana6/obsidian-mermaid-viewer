import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { DiagramMetadata } from '../diagram/types';
import { type Camera } from './camera';
import { mountViewer, type MountedViewer } from './mount-viewer';
import type { ViewerInput } from './input';
import type { ViewerUI } from './ui';

/** A workspace window leaf that shows one diagram and nothing else. */
export const POPUP_VIEW_TYPE = 'mpv-diagram-popup';

/**
 * The standalone pop-up: a full-size diagram viewer in its own workspace window.
 * It renders no note text; `Esc` and the header close button close the whole
 * window, and the host releases everything through `window-close`.
 */
export class DiagramPopupView extends ItemView {
  camera!: Camera;
  ui!: ViewerUI;
  viewport!: SVGSVGElement;
  input?: ViewerInput;
  private viewer?: MountedViewer;
  private meta: DiagramMetadata | null = null;
  private escapeOff?: () => void;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return POPUP_VIEW_TYPE;
  }
  getDisplayText(): string {
    return this.meta ? `${this.meta.file} · Mermaid 弹窗` : 'Mermaid 弹窗';
  }
  getIcon(): string {
    return 'picture-in-picture-2';
  }

  /** Shows one diagram at full size; a note with several diagrams opens the one clicked. */
  show(source: SVGSVGElement, meta: DiagramMetadata): void {
    this.meta = meta;
    this.contentEl.empty();
    this.contentEl.addClass('mpv-diagram-popup');
    // The pop-up reuses the fullscreen modal's surface classes, so the light
    // canvas, header controls and help panel look exactly the same as in place.
    const surface = this.contentEl.createDiv({ cls: 'modal mpv-diagram-modal' });
    const content = surface.createDiv({ cls: 'modal-content' });
    const viewer = mountViewer(
      content,
      source,
      meta,
      () => this.closeWindow(),
      this.containerEl.win,
    );
    this.camera = viewer.camera;
    this.ui = viewer.ui;
    this.viewport = viewer.viewport;
    this.input = viewer.input;
    // The whole window is the viewer, so `Esc` closes the window; opening the
    // floating help panel gets `Esc` back first, matching the modal behaviour.
    this.escapeOff?.();
    const doc = this.containerEl.doc;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (this.ui && !this.ui.help.hidden) {
        this.ui.help.hidden = true;
        this.ui.helpButton.setAttribute('aria-expanded', 'false');
        this.ui.helpButton.focus();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.closeWindow();
    };
    doc.addEventListener('keydown', onKey, true);
    this.escapeOff = () => doc.removeEventListener('keydown', onKey, { capture: true });
  }

  /** The window is the viewer: closing it closes the leaf window and its workspace leaf. */
  private closeWindow(): void {
    this.containerEl.win.close();
  }

  /** Releases the mounted viewer body; `window-close` and view disposal both reach here. */
  disposeBody(): void {
    this.escapeOff?.();
    this.escapeOff = undefined;
    this.viewer?.dispose();
    this.viewer = undefined;
  }

  async onClose(): Promise<void> {
    this.disposeBody();
  }
}
