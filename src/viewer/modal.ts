import { Modal, Scope, type App } from 'obsidian';
import type { DiagramMetadata } from '../diagram/types';
import { Camera, MAX_SCALE } from './camera';
import { ViewerInput } from './input';
import { createSvgViewport } from './svg-viewport';
import { createViewerUI, legend, type ViewerUI } from './ui';

export class DiagramModal extends Modal {
  camera!: Camera;
  ui!: ViewerUI;
  viewport!: SVGSVGElement;
  input?: ViewerInput;
  private readonly events = new AbortController();
  private readonly returnFocus: HTMLElement | null;
  private resize?: ResizeObserver;
  private frame = 0;
  private resizeFrame = 0;
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
    this.ui = createViewerUI(this.contentEl, this.meta, this, this.events.signal);
    const scene = createSvgViewport(this.source, this.ui.canvas);
    this.viewport = scene.viewport;
    this.camera = new Camera(scene.bounds);
    // Modal.open has attached the DOM. Frame the SVG before input is enabled;
    // background windows can postpone requestAnimationFrame indefinitely.
    this.camera.resize(this.ui.canvas.getBoundingClientRect());
    this.camera.initialView();
    this.render();
    legend(this.ui.help, scene.content);
    this.input = new ViewerInput(
      this.ui.stage,
      this.contentEl,
      this.camera,
      () => this.render(),
      this,
    );
    this.resize = new ResizeObserver(() => {
      this.containerEl.win.cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = this.containerEl.win.requestAnimationFrame(() => {
        this.camera.resize(this.ui.canvas.getBoundingClientRect());
        this.render();
      });
    });
    this.resize.observe(this.ui.stage);
    this.frame = this.containerEl.win.requestAnimationFrame(() => {
      this.focus();
    });
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
    this.containerEl.win.cancelAnimationFrame(this.frame);
    this.containerEl.win.cancelAnimationFrame(this.resizeFrame);
    this.resize?.disconnect();
    this.input?.dispose();
    this.events.abort();
    this.contentEl.empty();
    this.onClosed();
    queueMicrotask(() => {
      if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    });
  }
}
