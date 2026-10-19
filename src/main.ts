import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { diagramFile, diagramMetadata } from './diagram/metadata';
import { NoteObserver } from './integration/note-observer';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  ViewerSettingsTab,
  type ViewerSettings,
} from './settings';
import { decorate } from './theme/decorate';
import { DiagramModal } from './viewer/modal';

/** Composition root: settings, per-window note integration and modal lifetime only. */
export default class MermaidViewer extends Plugin {
  settings = { ...DEFAULT_SETTINGS };
  /** One viewer per window, so a pop-out can show its own diagram. */
  readonly modals = new Map<Window, DiagramModal>();
  private readonly observers = new Map<Window, NoteObserver>();
  /** Set by `window-open`, which fires while `getLeaf('window')` builds the pop-out. */
  private popout: Window | null = null;
  private unloaded = false;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    if (this.unloaded) return;
    this.addSettingTab(new ViewerSettingsTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.observe(this.app.workspace.containerEl);
      // Pop-outs that were restored before the layout was ready need an observer too.
      this.app.workspace.iterateAllLeaves((leaf) => this.observe(leaf.view.containerEl.doc.body));
    });
    this.registerEvent(
      this.app.workspace.on('window-open', (workspaceWindow) => {
        this.popout = workspaceWindow.win;
        // A pop-out exposes no workspace container element, so observe its whole document.
        this.observe(workspaceWindow.doc.body);
      }),
    );
    this.registerEvent(
      this.app.workspace.on('window-close', (workspaceWindow) => this.release(workspaceWindow.win)),
    );
    this.addCommand({
      id: 'open-current-diagram',
      name: '全屏查看当前笔记的 Mermaid 图',
      callback: () => {
        const scope = this.app.workspace.getActiveViewOfType(MarkdownView)?.containerEl;
        const diagrams = Array.from(
          scope?.querySelectorAll<SVGSVGElement>('.mermaid > svg') ?? [],
        ).filter((svg) => this.eligible(svg));
        const svg =
          diagrams.find((el) => {
            const rect = el.getBoundingClientRect();
            return rect.bottom > 0 && rect.top < (el.ownerDocument.defaultView?.innerHeight ?? 0);
          }) ?? diagrams[0];
        if (svg) this.open(svg);
        else new Notice('当前笔记没有可查看的 Mermaid 图表，请检查插件设置中的应用范围。');
      },
    });
  }

  metadata(svg: SVGSVGElement) {
    return diagramMetadata(this.app, svg);
  }

  /** Scope is per window: a pop-out may show a different note than the main window. */
  private eligible(svg: SVGSVGElement): boolean {
    return !!this.observers.get(svg.win)?.eligible(svg);
  }

  /** The pop-out created by the current command, if the host opened one. */
  private takePopout(): Window | null {
    const win = this.popout;
    this.popout = null;
    return win;
  }

  private observe(root: HTMLElement): void {
    const win = root.win;
    if (this.unloaded || this.observers.has(win)) return;
    this.observers.set(
      win,
      new NoteObserver(
        root,
        () => this.settings,
        (svg) => this.metadata(svg),
        {
          open: (svg) => this.open(svg),
          openInWindow: (svg) => void this.openInWindow(svg),
        },
      ),
    );
  }

  private release(win: Window): void {
    if (this.popout === win) this.popout = null;
    this.observers.get(win)?.dispose();
    this.observers.delete(win);
    this.modals.get(win)?.close();
    this.modals.delete(win);
  }

  /** Opens the viewer for one diagram. A pop-out target keeps the note visible in its own window. */
  private open(svg: SVGSVGElement, target: Window = svg.win): void {
    const active = this.modals.get(target);
    if (active) {
      active.focus();
      return;
    }
    decorate(svg);
    const modal = new DiagramModal(
      this.app,
      svg,
      this.metadata(svg),
      () => this.modals.delete(target),
      target,
    );
    this.modals.set(target, modal);
    modal.open();
  }

  /** Shows this diagram in a pop-out window, leaving the note text visible in the main window. */
  private async openInWindow(svg: SVGSVGElement): Promise<void> {
    this.popout = null;
    let leaf: WorkspaceLeaf;
    try {
      leaf = this.app.workspace.getLeaf('window');
    } catch (error) {
      // Phones and installers whose Electron cannot open windows are notified by Obsidian;
      // anything else came from the window-open handler and must not be swallowed silently.
      console.error('Mermaid Viewer could not open a window', error);
      this.open(svg);
      return;
    }
    const win = this.takePopout();
    if (!win) {
      // Defensive: a host that cannot open windows keeps the in-place viewer, and the leaf
      // this call asked for is still empty, so drop it again.
      leaf.detach();
      this.open(svg);
      return;
    }
    const file = diagramFile(this.app, svg);
    if (file) await leaf.openFile(file, { state: { mode: 'preview' } });
    if (this.unloaded || win.closed) return;
    win.focus();
    // The clicked diagram is cloned, so a note with several diagrams opens the one requested.
    this.open(svg, win);
  }

  async updateSettings(value: ViewerSettings): Promise<void> {
    const next = normalizeSettings(value);
    // Persist first: a failed save must not leave settings and rendered scope split.
    try {
      await this.saveData(next);
    } catch {
      new Notice('设置保存失败，请检查 Vault 的写入权限。');
      return;
    }
    this.settings = next;
    this.modals.forEach((modal) => modal.close());
    this.observers.forEach((observer) => observer.refresh());
  }

  onunload(): void {
    this.unloaded = true;
    this.observers.forEach((observer) => observer.dispose());
    this.observers.clear();
    this.modals.forEach((modal) => modal.close());
    this.modals.clear();
  }
}
