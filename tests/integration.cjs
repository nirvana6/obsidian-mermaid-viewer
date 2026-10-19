const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(`
      <style>.cm-embed-block:hover{box-shadow:0 0 0 2px red}</style>
      <main class="markdown-source-view mod-cm6 mermaid-notes">
        <section class="cm-embed-block" id="diagram-host"><div class="mermaid"></div></section>
        <section class="cm-embed-block" id="other-host">Other code block</section>
      </main>`);
    await page.addStyleTag({ path: path.join(root, 'dist/styles.css') });
    await page.evaluate(require('./helpers/obsidian-mock.cjs'));
    await page.evaluate(
      ({ source, svg }) => {
        document.querySelector('.mermaid').innerHTML = svg;
        const module = { exports: {} };
        new Function('module', 'require', source)(module, () => obsidianMock);
        window.Viewer = module.exports.default;
        window.viewer = new Viewer();
        return viewer.onload();
      },
      {
        source: fs.readFileSync(path.join(root, 'dist/main.js'), 'utf8'),
        svg: fs.readFileSync(path.join(root, 'tests/fixtures/flow.svg'), 'utf8'),
      },
    );
    await page.waitForSelector('#diagram-host.mpv-mermaid-embed');
    await page.hover('#diagram-host');
    assert.equal(await page.$eval('#diagram-host', (el) => getComputedStyle(el).boxShadow), 'none');
    await page.hover('#other-host');
    assert.notEqual(
      await page.$eval('#other-host', (el) => getComputedStyle(el).boxShadow),
      'none',
    );
    await page.evaluate(() => {
      document.querySelector('#diagram-host').createDiv({ cls: 'embed-actions' });
    });
    await page.waitForSelector('#diagram-host.mpv-mermaid-embed-with-actions');
    assert.equal(
      await page.$eval('.mpv-mermaid-cardbar', (el) => getComputedStyle(el).paddingInlineEnd),
      '44px',
    );
    await page.evaluate(() => document.querySelector('.embed-actions').remove());
    await page.waitForFunction(() => !document.querySelector('.mpv-mermaid-embed-with-actions'));
    await page.click('.mpv-mermaid-open');
    await page.waitForSelector('.mpv-diagram-modal');
    await page.keyboard.press('Escape');

    // Definitions are searchable on current Obsidian, while the legacy view retains validation.
    assert.deepEqual(
      await page.evaluate(() =>
        viewer.settingsTab
          .getSettingDefinitions()
          .map((d) => ({ name: d.name, aliases: d.aliases })),
      ),
      [
        { name: '图表应用范围', aliases: ['Mermaid', 'scope', 'cssclasses'] },
        { name: '节点配色规则', aliases: ['Mermaid', 'colors', 'palette'] },
      ],
    );
    await page.evaluate(() => {
      document.body.appendChild(viewer.settingsTab.containerEl);
      viewer.settingsTab.display();
      const input = viewer.settingsTab.containerEl.querySelector('input');
      input.value = '.invalid scope';
      input.dispatchEvent(new Event('change'));
    });
    assert.equal(
      await page.evaluate(() => viewer.settingsTab.containerEl.querySelector('input').value),
      'mermaid-notes',
    );
    await page.evaluate(() => {
      const input = viewer.settingsTab.containerEl.querySelector('input');
      input.value = '';
      input.dispatchEvent(new Event('input'));
    });
    assert.equal(
      await page.evaluate(() => viewer.settings.noteClass),
      'mermaid-notes',
      'typing should not change scope',
    );
    await page.evaluate(() =>
      viewer.settingsTab.containerEl.querySelector('input').dispatchEvent(new Event('change')),
    );
    await page.waitForFunction(() => viewer.settings.noteClass === '');
    await page.evaluate(() => {
      document.querySelector('#diagram-host .mermaid').remove();
    });
    await page.waitForFunction(() => !document.querySelector('.mpv-mermaid-embed'));
    await page.evaluate(() => viewer.unload());

    // Mermaid's inline palette is replaceable without touching geometry, then restored exactly.
    await page.evaluate(
      (source) => {
        const module = { exports: {} };
        new Function('module', source)(module);
        window.theme = module.exports;
      },
      fs.readFileSync(path.join(root, '.test-build/theme.cjs'), 'utf8'),
    );
    const restored = await page.evaluate(() => {
      const host = document.body.createDiv({ cls: 'mermaid mpv-note-diagram' });
      const svg = host.createSvg('svg', { attr: { id: 'custom:diagram' } });
      svg.innerHTML =
        '<style>#custom\\:diagram .nodeLabel{color:red}</style><g class="node focus"><rect width="100" height="40" style="fill: pink; stroke: purple; transform: translateX(3px)"/><foreignObject width="100" height="40"><div xmlns="http://www.w3.org/1999/xhtml" class="nodeLabel" style="color: yellow; width: 100px">A</div></foreignObject></g>';
      const rect = svg.querySelector('rect');
      const label = svg.querySelector('.nodeLabel');
      const before = svg.innerHTML;
      theme.decorate(svg);
      const colors = [getComputedStyle(rect).fill, getComputedStyle(label).color];
      const geometry = rect.style.transform === 'translateX(3px)' && label.style.width === '100px';
      theme.decorate(svg);
      const styleCount = svg.querySelectorAll('style').length;
      theme.clean(svg);
      const exact = before === svg.innerHTML;
      theme.decorate(svg);
      rect.style.opacity = '0.7';
      theme.clean(svg);
      const concurrent = rect.style.opacity === '0.7' && rect.style.fill === 'pink';
      host.remove();
      return { colors, geometry, exact, concurrent, styleCount };
    });
    assert.deepEqual(restored, {
      colors: ['rgb(27, 54, 93)', 'rgb(250, 249, 245)'],
      geometry: true,
      exact: true,
      concurrent: true,
      styleCount: 1,
    });
    // Schedule mutation work in the diagram's window, even when the plugin lives in another realm.
    const nestedWindow = await page.evaluate(
      async ({ mock, svg }) => {
        const frame = document.body.createEl('iframe');
        const child = frame.contentWindow;
        child.eval(`(${mock})()`);
        child.document.body.innerHTML = `<main class="markdown-preview-view mermaid-notes"><h2>Before</h2><div class="mermaid">${svg}</div></main>`;
        let frames = 0;
        const request = child.requestAnimationFrame.bind(child);
        child.requestAnimationFrame = (callback) => {
          frames++;
          return request(callback);
        };
        const nested = new Viewer();
        nested.app.workspace.containerEl = child.document.body;
        try {
          await nested.onload();
          child.document.querySelector('h2').textContent = 'Updated in nested window';
          await new Promise((resolve) => setTimeout(resolve, 80));
          return {
            frames,
            caption: child.document.querySelector('.mpv-mermaid-caption')?.textContent,
          };
        } finally {
          nested.unload();
          frame.remove();
        }
      },
      {
        mock: require('./helpers/obsidian-mock.cjs').toString(),
        svg: fs.readFileSync(path.join(root, 'tests/fixtures/flow.svg'), 'utf8'),
      },
    );
    assert(nestedWindow.frames > 0);
    assert(nestedWindow.caption.includes('Updated in nested window'));
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Live Preview host cleanup, original SVG styles and concurrent edits, header actions, searchable settings and legacy validation.',
    );
  } finally {
    await browser.close();
  }
})();
