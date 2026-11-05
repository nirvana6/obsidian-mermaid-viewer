import type { DiagramMetadata } from '../diagram/types';
import { Camera, MAX_SCALE } from './camera';
import { ViewerInput } from './input';
import { createSvgViewport } from './svg-viewport';
import { createViewerUI, legend, type UIActions, type ViewerUI } from './ui';

/** A viewer body mounted into some host element: camera, header, canvas and input. */
export interface MountedViewer {
  camera: Camera;
  ui: ViewerUI;
  viewport: SVGSVGElement;
  input: ViewerInput;
  /** Cancels frames, disconnects the resize observer and releases event listeners. */
  dispose(): void;
}

/**
 * Builds the diagram viewer inside an already attached `parent` element and `win`:
 * header UI, camera, viewport and input. The fullscreen modal and the standalone
 * pop-up window view mount this same body, so both hosts behave identically.
 * `close` backs the header close button and `Esc` for whichever host mounts it.
 */
export function mountViewer(
  parent: HTMLElement,
  source: SVGSVGElement,
  meta: DiagramMetadata,
  close: () => void,
  win: Window,
): MountedViewer {
  const events = new AbortController();
  const signal = events.signal;
  const actions: UIActions = {
    close,
    fit: () => {
      camera.fit();
      render();
    },
    fitWidth: () => {
      camera.fitWidth();
      render();
    },
    actualSize: () => {
      camera.actualSize();
      render();
    },
    zoomCenter: (factor) => {
      camera.zoomCenter(factor);
      render();
    },
  };
  const ui = createViewerUI(parent, meta, actions, signal);
  const scene = createSvgViewport(source, ui.canvas);
  const viewport = scene.viewport;
  const camera = new Camera(scene.bounds);
  // Frame the SVG before input is enabled: a background window postpones
  // requestAnimationFrame indefinitely, so measure the attached node instead.
  camera.resize(ui.canvas.getBoundingClientRect());
  camera.initialView();
  render();
  legend(ui.help, scene.content);
  const input = new ViewerInput(ui.stage, parent, camera, render, actions);
  function render(): void {
    viewport.setAttribute('viewBox', camera.viewBox);
    const label = `${Math.round(camera.scale * 100)}%`;
    if (ui.counter.textContent !== label) ui.counter.textContent = label;
    ui.fitButton.setAttribute('aria-pressed', String(camera.viewMode === 'fit'));
    ui.widthButton.setAttribute('aria-pressed', String(camera.viewMode === 'width'));
    ui.actualButton.setAttribute('aria-pressed', String(camera.viewMode === 'actual'));
    ui.zoomOut.disabled = camera.scale <= camera.minimumScale;
    ui.zoomIn.disabled = camera.scale >= MAX_SCALE;
  }
  let focusFrame = 0;
  let presenter = 0;
  const resize = new ResizeObserver(() => {
    win.cancelAnimationFrame(presenter);
    presenter = win.requestAnimationFrame(() => {
      camera.resize(ui.canvas.getBoundingClientRect());
      render();
    });
  });
  resize.observe(ui.stage);
  focusFrame = win.requestAnimationFrame(() => {
    ui.stage.focus({ preventScroll: true });
  });
  return {
    camera,
    ui,
    viewport,
    input,
    dispose() {
      win.cancelAnimationFrame(focusFrame);
      win.cancelAnimationFrame(presenter);
      resize.disconnect();
      input.dispose();
      events.abort();
    },
  };
}
