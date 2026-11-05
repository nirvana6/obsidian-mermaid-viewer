const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const fixture = (name, marker) =>
      fs
        .readFileSync(path.join(__dirname, 'fixtures', `${name}.svg`), 'utf8')
        .replace('<svg', `<svg data-diagram="${marker}"`);
    const flow = fixture('flow', 'first');
    const sequence = fixture('sequence', 'second');
    await page.setContent(`
      <style>.mermaid-notes{width:700px}.modal-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000a}</style>
      <main class="markdown-preview-view mermaid-notes">
        <h2>第一张图</h2>
        <div class="mermaid">${flow}</div>
        <h2>第二张图</h2>
        <div class="mermaid">${sequence}</div>
      </main>`);
    await page.addStyleTag({ path: path.join(root, 'dist/styles.css') });
    await page.evaluate(require('./helpers/obsidian-mock.cjs'));
    await page.evaluate(
      ({ source, sample }) => {
        window.mermaidFixture = sample;
        const module = { exports: {} };
        new Function('module', 'require', source)(module, () => obsidianMock);
        window.viewer = new module.exports.default();
        return viewer.onload();
      },
      { source: fs.readFileSync(path.join(root, 'dist/main.js'), 'utf8'), sample: flow },
    );
    const clickWindowAction = (index) =>
      page.evaluate(
        (position) => document.querySelectorAll('.mpv-mermaid-window')[position].click(),
        index,
      );
    /** Close the pop-up the way the host does; window-close must release its state. */
    const closePopup = () =>
      page.evaluate(() => {
        const win = document.querySelector('iframe').contentWindow;
        win.close();
        window.activeWindow = window;
      });
    await page.waitForFunction(() => document.querySelectorAll('.mpv-mermaid-window').length === 2);

    // Every diagram owns a window action, and the clicked one is the diagram that shows.
    await clickWindowAction(1);
    await page.waitForFunction(() => viewer.popups.size === 1);
    assert.deepEqual(
      await page.evaluate(() => {
        const popout = document.querySelector('iframe').contentWindow;
        const view = [...viewer.popups.values()][0];
        return {
          viewDocument: view.containerEl.ownerDocument === popout.document,
          viewerInPopup: !!popout.document.querySelector('.modal.mpv-diagram-modal'),
          viewerInMain: !!document.querySelector('.modal.mpv-diagram-modal'),
          diagram: view.viewport.querySelector('.mpv-svg-content')?.dataset.diagram,
          headings: [...document.querySelectorAll('main h2')].map((el) => el.textContent),
          noteInPopup: popout.document.querySelector('main')?.childElementCount ?? 0,
        };
      }),
      {
        viewDocument: true,
        viewerInPopup: true,
        viewerInMain: false,
        diagram: 'second',
        headings: ['第一张图', '第二张图'],
        noteInPopup: 0,
      },
    );

    // Escape in the pop-up closes the whole window; window-close releases its state.
    await page.evaluate(() => {
      const popout = document.querySelector('iframe').contentWindow;
      popout.document.dispatchEvent(new popout.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await page.waitForFunction(() => viewer.popups.size === 0);
    await page.waitForFunction(() => !document.querySelector('iframe'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('main h2').length), 2);

    // A host that reports focus late still gets the viewer in the window showing the diagram.
    await page.evaluate(() => {
      window.suppressFocus = true;
    });
    await clickWindowAction(0);
    await page.waitForFunction(() => viewer.popups.size === 1);
    assert.deepEqual(
      await page.evaluate(() => {
        const popout = document.querySelector('iframe').contentWindow;
        const view = [...viewer.popups.values()][0];
        return {
          viewerInPopup: !!popout.document.querySelector('.modal.mpv-diagram-modal'),
          viewerInMain: !!document.querySelector('.modal.mpv-diagram-modal'),
          diagram: view.viewport.querySelector('.mpv-svg-content')?.dataset.diagram,
        };
      }),
      { viewerInPopup: true, viewerInMain: false, diagram: 'first' },
    );
    await closePopup();
    await page.waitForFunction(() => viewer.popups.size === 0);

    // A window closed while its pop-up loads must not leave a viewer behind in a dead window.
    await page.evaluate(() => {
      document.querySelectorAll('.mpv-mermaid-window')[1].click();
      const frame = document.querySelector('iframe');
      const win = frame.contentWindow;
      viewer.app.workspace.trigger('window-close', { win, doc: win.document }, win);
      frame.remove();
      window.activeWindow = window;
    });
    await page.waitForFunction(() => !document.querySelector('iframe'));
    assert.deepEqual(
      await page.evaluate(() => ({
        popups: viewer.popups.size,
        viewerInMain: !!document.querySelector('.modal.mpv-diagram-modal'),
        controlsInMain: document.querySelectorAll('.mpv-mermaid-action').length,
      })),
      { popups: 0, viewerInMain: false, controlsInMain: 2 },
    );

    // A host without pop-out windows keeps the in-place viewer and drops the empty leaf.
    await page.evaluate(() => {
      window.suppressPopout = true;
    });
    await clickWindowAction(1);
    await page.waitForSelector('.mpv-diagram-modal');
    assert.deepEqual(
      await page.evaluate(() => ({
        modalInMain: !!document.querySelector('.mpv-diagram-modal'),
        frames: document.querySelectorAll('iframe').length,
        strayLeaf: !!document.querySelector('.workspace-leaf-content'),
        diagram: document
          .querySelector('.mpv-diagram-modal .mpv-svg-content')
          ?.getAttribute('data-diagram'),
      })),
      { modalInMain: true, frames: 0, strayLeaf: false, diagram: 'second' },
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: each diagram opens its own diagram-only pop-up window, keeps the note visible, survives Esc on the window and a window closed mid-load and falls back without pop-out support.',
    );
  } finally {
    await browser.close();
  }
})();
