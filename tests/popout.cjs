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
    /** Close the pop-out the way the host does; the controls must be gone with its observer. */
    const closePopout = () =>
      page.evaluate(() => {
        const frame = document.querySelector('iframe');
        const win = frame.contentWindow;
        viewer.app.workspace.trigger('window-close', { win, doc: win.document }, win);
        const released = !win.document.querySelector('.mpv-mermaid-action');
        frame.remove();
        window.activeWindow = window;
        return released;
      });
    await page.waitForFunction(() => document.querySelectorAll('.mpv-mermaid-window').length === 2);

    // Every diagram owns a window action, and the clicked one is the diagram that opens.
    await clickWindowAction(1);
    await page.waitForFunction(() => viewer.modals.size === 1);
    assert.deepEqual(
      await page.evaluate(() => {
        const popout = document.querySelector('iframe').contentWindow;
        const modal = [...viewer.modals.values()][0];
        return {
          modalDocument: modal.containerEl.ownerDocument === popout.document,
          modalInPopout: !!popout.document.querySelector('.mpv-diagram-modal'),
          modalInMain: !!document.querySelector('.mpv-diagram-modal'),
          diagram: modal.viewport.querySelector('.mpv-svg-content')?.dataset.diagram,
          title: modal.titleEl.textContent,
          controlsInPopout: popout.document.querySelectorAll('.mpv-mermaid-action').length,
          headings: [...document.querySelectorAll('main h2')].map((el) => el.textContent),
        };
      }),
      {
        modalDocument: true,
        modalInPopout: true,
        modalInMain: false,
        diagram: 'second',
        title: '第二张图',
        controlsInPopout: 2,
        headings: ['第一张图', '第二张图'],
      },
    );
    // Escape in the pop-out closes its viewer only, then the window release drops its state.
    await page.evaluate(() => {
      const popout = document.querySelector('iframe').contentWindow;
      popout.document.dispatchEvent(new popout.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await page.waitForFunction(() => viewer.modals.size === 0);
    assert.equal(await closePopout(), true);
    assert.equal(await page.evaluate(() => document.querySelectorAll('main h2').length), 2);

    // A host that reports focus late still gets the viewer in the window showing the diagram.
    await page.evaluate(() => {
      window.suppressFocus = true;
    });
    await clickWindowAction(0);
    await page.waitForFunction(() => viewer.modals.size === 1);
    assert.deepEqual(
      await page.evaluate(() => {
        const popout = document.querySelector('iframe').contentWindow;
        const modal = [...viewer.modals.values()][0];
        return {
          modalInPopout: !!popout.document.querySelector('.mpv-diagram-modal'),
          modalInMain: !!document.querySelector('.mpv-diagram-modal'),
          diagram: modal.viewport.querySelector('.mpv-svg-content')?.dataset.diagram,
        };
      }),
      { modalInPopout: true, modalInMain: false, diagram: 'first' },
    );
    await closePopout();
    await page.waitForFunction(() => viewer.modals.size === 0);

    // A window closed while its note loads must not leave a viewer behind in a dead window.
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
        viewers: viewer.modals.size,
        modalInMain: !!document.querySelector('.mpv-diagram-modal'),
        controlsInMain: document.querySelectorAll('.mpv-mermaid-action').length,
      })),
      { viewers: 0, modalInMain: false, controlsInMain: 4 },
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
      'PASS: each diagram opens its own pop-out window, keeps the note visible, follows the focused window, survives a window closed mid-load and falls back without pop-out support.',
    );
  } finally {
    await browser.close();
  }
})();
