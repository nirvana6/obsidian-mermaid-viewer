import { setIcon } from 'obsidian';
import type { DiagramMetadata } from '../diagram/types';
import type { ViewerSettings } from '../settings';
import { clean, decorate } from '../theme/decorate';

/** Inline actions a note can offer for one diagram. */
interface NoteActions {
  open(svg: SVGSVGElement): void;
  openInWindow(svg: SVGSVGElement): void;
}

/** One card control: the class is the click hook, the handler the matching action. */
interface NoteAction {
  cls: string;
  handler: keyof NoteActions;
  icon: string;
  label: string;
  title: string;
  description: string;
}

const ACTIONS: NoteAction[] = [
  {
    cls: 'mpv-mermaid-open',
    handler: 'open',
    icon: 'maximize-2',
    label: '全屏查看',
    title: '全屏查看此图，支持缩放和拖动',
    description: '全屏查看 Mermaid 图表',
  },
  {
    cls: 'mpv-mermaid-window',
    handler: 'openInWindow',
    icon: 'picture-in-picture-2',
    label: '新窗口打开',
    title: '在新窗口打开此图，可同时对照笔记正文',
    description: '在新窗口打开 Mermaid 图表',
  },
];

const ACTION_SELECTOR = ACTIONS.map((action) => `.${action.cls}`).join(', ');

/** Owns only injected note controls/styles. No modal or camera logic lives here. */
export class NoteObserver {
  private readonly owned = new Map<HTMLElement, SVGSVGElement>();
  private readonly observer: MutationObserver;
  private pending = 0;
  private readonly embeds = new Set<HTMLElement>();
  private stopped = false;
  private readonly click: (event: MouseEvent) => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: () => ViewerSettings,
    private readonly metadata: (svg: SVGSVGElement) => DiagramMetadata,
    private readonly actions: NoteActions,
  ) {
    this.click = (event) => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLElement>(ACTION_SELECTOR);
      const svg = button?.closest('.mermaid')?.querySelector<SVGSVGElement>(':scope > svg');
      const action = ACTIONS.find((entry) => button?.classList.contains(entry.cls));
      if (!svg || !action || !this.eligible(svg)) return;
      event.preventDefault();
      event.stopPropagation();
      this.actions[action.handler](svg);
    };
    root.addEventListener('click', this.click);
    this.scan();
    this.observer = new MutationObserver((records) => {
      if (records.some((record) => this.relevant(record))) this.schedule();
    });
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  }

  eligible(svg: SVGSVGElement): boolean {
    if (!this.root.contains(svg) || !svg.closest('.mermaid')) return false;
    const { noteClass } = this.settings();
    return !noteClass || !!svg.closest(`.${noteClass}`);
  }

  private relevant(record: MutationRecord): boolean {
    const el =
      record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement;
    if (!el || el.closest('.mpv-diagram-container, .mpv-mermaid-cardbar, svg')) return false;
    if (record.type === 'attributes') {
      const name = this.settings().noteClass;
      return (
        !!name &&
        (record.oldValue ?? '').split(/\s+/).includes(name) !== el.classList.contains(name)
      );
    }
    if (el.closest('.markdown-preview-view, .markdown-source-view, .mpv-note-diagram')) return true;
    return [...record.addedNodes, ...record.removedNodes].some(
      (node) =>
        node.nodeType === 1 &&
        ((node as Element).matches('.mermaid, .mpv-note-diagram') ||
          (node as Element).querySelector('.mermaid')),
    );
  }

  private schedule(): void {
    if (this.stopped || this.pending) return;
    this.pending = this.root.win.requestAnimationFrame(() => {
      this.pending = 0;
      this.scan();
    });
  }

  refresh(): void {
    if (!this.stopped) this.scan();
  }

  private scan(): void {
    for (const [container, svg] of this.owned) {
      if (!this.eligible(svg) || container.querySelector(':scope > svg') !== svg) {
        this.remove(container, svg);
        this.owned.delete(container);
      }
    }
    for (const svg of this.root.querySelectorAll<SVGSVGElement>('.mermaid > svg')) {
      if (!this.eligible(svg)) continue;
      const container = svg.parentElement;
      if (!container) continue;
      container.classList.add('mpv-note-diagram');
      this.owned.set(container, svg);
      decorate(svg);
      const meta = this.metadata(svg);
      let bar = container.querySelector<HTMLElement>(':scope > .mpv-mermaid-cardbar');
      if (!bar) {
        bar = container.createDiv({ cls: 'mpv-mermaid-cardbar', prepend: true });
        bar.createSpan({ cls: 'mpv-mermaid-caption' });
        for (const action of ACTIONS) this.control(bar, action);
      }
      const caption = bar.querySelector<HTMLElement>('.mpv-mermaid-caption');
      const text = `${meta.kind} · ${meta.title}`;
      if (caption && caption.textContent !== text) {
        caption.textContent = text;
        caption.title = meta.title;
      }
    }
    this.syncEmbeds();
  }

  private control(bar: HTMLElement, action: NoteAction): void {
    const button = bar.createEl('button', {
      cls: `mpv-mermaid-action ${action.cls}`,
      attr: { type: 'button', title: action.title, 'aria-label': action.description },
    });
    setIcon(button, action.icon);
    button.createSpan({ text: action.label });
  }

  private syncEmbeds(): void {
    const current = new Set<HTMLElement>();
    for (const container of this.owned.keys()) {
      const host = container.parentElement;
      if (!host?.matches('.cm-embed-block')) continue;
      current.add(host);
      host.classList.add('mpv-mermaid-embed');
      host.classList.toggle(
        'mpv-mermaid-embed-with-actions',
        !!host.querySelector(':scope > .embed-actions'),
      );
    }
    for (const host of this.embeds) {
      if (!current.has(host))
        host.classList.remove('mpv-mermaid-embed', 'mpv-mermaid-embed-with-actions');
    }
    this.embeds.clear();
    current.forEach((host) => this.embeds.add(host));
  }

  private remove(container: HTMLElement, svg: SVGSVGElement): void {
    clean(svg);
    container.classList.remove('mpv-note-diagram');
    container.querySelector(':scope > .mpv-mermaid-cardbar')?.remove();
  }

  dispose(): void {
    this.stopped = true;
    this.observer.disconnect();
    this.root.win.cancelAnimationFrame(this.pending);
    this.root.removeEventListener('click', this.click);
    for (const [container, svg] of this.owned) this.remove(container, svg);
    this.owned.clear();
    this.syncEmbeds();
  }
}
