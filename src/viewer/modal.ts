import { Modal, Scope, type App } from 'obsidian';
import type { DiagramMetadata } from '../diagram/types';
import { MAX_SCALE, type Camera } from './camera';
import { mountViewer, type MountedViewer } from './mount-viewer';
import type { ViewerInput } from './input';
import type { ViewerUI } from './ui';

export class DiagramModal extends Modal {
  camera!: Camera;
  ui!: ViewerUI;
  viewport!: SVGSVGElement;
  input?: ViewerInput;
  private viewer?: MountedViewer;
  private readonly returnFocus: HTMLElement | null;
  private closed = false;

  constructor(
    app: App,
    private readonly source: SVGSVGElement,
    private readonly meta: DiagramMetadata,
    private readonly onClosed: () => void,
    private readonly target: Window = source.win,
  ) {
    super(app);
    // Focus returns to whatever opened the viewer: the header action the user clicked.
    this.returnFocus = source.doc.activeElement as HTMLElement | null;
    this.scope = new Scope(this.scope);
    this.scope.register([], 'Escape', () => {
      if (this.ui && !this.ui.help.hidden) {
        this.ui.help.hidden = true;
        this.ui.helpButton.setAttribute('aria-expanded', 'false');
        this.ui.helpButton.focus();
      } else this.close();
      return false;
    });
  }

  onOpen(): void {
    // Modal.open appends to the active window, which is not necessarily the one showing the
    // diagram, so adopt the modal before anything derives a window from its element.
    if (this.containerEl.doc !== this.target.document)
      this.target.document.body.appendChild(this.containerEl);
    this.modalEl.classList.add('mpv-diagram-modal');
    this.containerEl.classList.add('mpv-diagram-container');
    this.titleEl.textContent = this.meta.title;
    const mounted = mountViewer(
      this.contentEl,
      this.source,
      this.meta,
      () => this.close(),
      this.containerEl.win,
    );
    this.camera = mounted.camera;
    this.ui = mounted.ui;
    this.viewport = mounted.viewport;
    this.input = mounted.input;
    this.viewer = mounted;
  }

  focus(): void {
    this.ui.stage.focus({ preventScroll: true });
  }
  fit(): void {
    this.camera.fit();
    this.render();
  }
  fitWidth(): void {
    this.camera.fitWidth();
    this.render();
  }
  actualSize(): void {
    this.camera.actualSize();
    this.render();
  }
  zoomCenter(factor: number): void {
    this.camera.zoomCenter(factor);
    this.render();
  }

  render(): void {
    this.viewport.setAttribute('viewBox', this.camera.viewBox);
    const label = `${Math.round(this.camera.scale * 100)}%`;
    if (this.ui.counter.textContent !== label) this.ui.counter.textContent = label;
    this.ui.fitButton.setAttribute('aria-pressed', String(this.camera.viewMode === 'fit'));
    this.ui.widthButton.setAttribute('aria-pressed', String(this.camera.viewMode === 'width'));
    this.ui.actualButton.setAttribute('aria-pressed', String(this.camera.viewMode === 'actual'));
    this.ui.zoomOut.disabled = this.camera.scale <= this.camera.minimumScale;
    this.ui.zoomIn.disabled = this.camera.scale >= MAX_SCALE;
  }

  onClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.viewer?.dispose();
    this.contentEl.empty();
    this.onClosed();
    queueMicrotask(() => {
      if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    });
  }
}
