/** Temporarily remove only inline declarations covered by our loaded CSS rules.
 * Mermaid's viewBox, transforms and label geometry remain untouched.
 */
type StyledElement = SVGElement | HTMLElement;
interface SavedStyle {
  element: StyledElement;
  original: string;
  themed: string;
  properties: Map<string, { value: string; priority: string }>;
}
const originals = new WeakMap<SVGSVGElement, SavedStyle[]>();

// Read the rules Obsidian already loaded from styles.css. Cache by stylesheet,
// so observing more diagrams does not repeatedly walk the host's entire CSS.
const rulesBySheet = new WeakMap<CSSStyleSheet, CSSStyleRule[]>();
function themeRules(doc: Document): CSSStyleRule[] {
  return Array.from(doc.styleSheets).flatMap((sheet) => {
    const cached = rulesBySheet.get(sheet);
    if (cached) return cached;
    const rules: CSSStyleRule[] = [];
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type !== CSSRule.STYLE_RULE) continue;
        const style = rule as CSSStyleRule;
        if (style.selectorText.startsWith('svg.mpv-diagram')) rules.push(style);
      }
    } catch {
      // Cross-origin theme sheets can be unreadable. Our local stylesheet is not.
    }
    rulesBySheet.set(sheet, rules);
    return rules;
  });
}

export function prepareThemeStyles(svg: SVGSVGElement): void {
  const saved = new Map<StyledElement, SavedStyle>();
  for (const rule of themeRules(svg.ownerDocument)) {
    const elements = Array.from(svg.querySelectorAll<StyledElement>(rule.selectorText));
    if (svg.matches(rule.selectorText)) elements.unshift(svg);
    for (const element of elements) {
      for (const property of Array.from(rule.style)) {
        if (property.startsWith('--')) continue;
        const value = element.style.getPropertyValue(property);
        if (!value) continue;
        let record = saved.get(element);
        if (!record) {
          record = {
            element,
            original: element.getAttribute('style') ?? '',
            themed: '',
            properties: new Map(),
          };
          saved.set(element, record);
        }
        record.properties.set(property, {
          value,
          priority: element.style.getPropertyPriority(property),
        });
        element.style.removeProperty(property);
      }
    }
  }
  for (const record of saved.values()) record.themed = record.element.style.cssText;
  originals.set(svg, [...saved.values()]);
}

export function restoreThemeStyles(svg: SVGSVGElement): void {
  for (const record of originals.get(svg) ?? []) {
    const { element } = record;
    if (element.style.cssText === record.themed) {
      element.setAttribute('style', record.original);
    } else {
      // Preserve changes made by the note renderer or another plugin meanwhile.
      for (const [property, { value, priority }] of record.properties) {
        if (!element.style.getPropertyValue(property))
          element.style.setProperty(property, value, priority);
      }
    }
  }
  originals.delete(svg);
}
