import type { App, TFile, View, WorkspaceLeaf } from 'obsidian';
import type { DiagramMetadata } from './types';

/** The leaf showing this diagram; `getLeavesOfType` covers every window, including pop-outs. */
function diagramLeaf(app: App, svg: SVGSVGElement): WorkspaceLeaf | undefined {
  return app.workspace
    .getLeavesOfType('markdown')
    .find((leaf) => leaf.view.containerEl.contains(svg));
}

function viewFile(view: View): TFile | null {
  return 'file' in view ? ((view.file as TFile | null) ?? null) : null;
}

export function diagramFile(app: App, svg: SVGSVGElement): TFile | null {
  const view = diagramLeaf(app, svg)?.view;
  return view ? viewFile(view) : null;
}

export function diagramMetadata(app: App, svg: SVGSVGElement): DiagramMetadata {
  const leaf = diagramLeaf(app, svg);
  const file = (leaf ? viewFile(leaf.view) : null)?.basename ?? 'Mermaid';
  const root =
    svg.closest('.markdown-preview-view, .markdown-source-view') ?? leaf?.view.containerEl;
  const headings = Array.from(root?.querySelectorAll('h1,h2,h3,h4,h5,h6,.cm-header') ?? []).filter(
    (h) => h.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const title = (headings.at(-1)?.textContent ?? file)
    .replace(/\u200b/g, '')
    .replace(/^#+\s*/, '')
    .trim();
  return {
    file,
    title,
    kind: svg.querySelector('text.actor')
      ? '时序图'
      : svg.querySelector('g.node')
        ? '流程图'
        : '图表',
  };
}
