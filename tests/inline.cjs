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
    await page.setViewport({ width: 1280, height: 800 });
    // No host-provided SVG sizing: the plugin must contain diagrams on its own.
    await page.setContent(`
      <style>
        body { margin: 0; background: #202020; }
        main { width: calc(100% - 32px); max-width: 900px; margin: 16px auto; }
        .note-row { display: flex; }
        .note-row > .mermaid { flex: 1; }
        .mermaid > svg { overflow: visible; }
        .cm-embed-block { position: relative; }
        .modal-container { position: fixed; inset: 0; display: flex; }
      </style>
      <main class="markdown-preview-view mermaid-notes">
        <h2>Document workflow</h2>
        <section class="note-row"><div class="mermaid" id="fixed-flow"></div></section>
        <section class="note-row"><div class="mermaid" id="inline-flow"></div></section>
        <section class="note-row"><div class="mermaid" id="small-flow"></div></section>
      </main>
      <main class="markdown-source-view mod-cm6 mermaid-notes">
        <section class="cm-embed-block"><div class="mermaid" id="sequence"></div>
          <div class="embed-actions"><button class="embed-action">Edit</button></div>
        </section>
      </main>
      <aside class="mermaid" id="unowned"></aside>`);
    await page.addStyleTag({ path: path.join(root, 'dist/styles.css') });
    await page.evaluate(require('./helpers/obsidian-mock.cjs'));
    await page.evaluate(() => (window.suppressPopout = true));
    await page.evaluate(
      async ({ flow, sequence, source }) => {
        for (const id of ['fixed-flow', 'inline-flow', 'small-flow', 'unowned'])
          document.querySelector('#' + id).innerHTML = flow;
        document.querySelector('#sequence').innerHTML = sequence;
        const fixed = document.querySelector('#fixed-flow > svg');
        fixed.setAttribute('width', String(fixed.viewBox.baseVal.width));
        fixed.setAttribute('height', String(fixed.viewBox.baseVal.height));
        const forced = document.querySelector('#inline-flow > svg');
        forced.setAttribute(
          'style',
          'width: 2400px; height: 1600px; min-width: 2400px; max-width: none; overflow: visible;',
        );
        const small = document.querySelector('#small-flow > svg');
        small.setAttribute('width', '240');
        small.setAttribute(
          'height',
          String((240 * small.viewBox.baseVal.height) / small.viewBox.baseVal.width),
        );
        small.removeAttribute('style');
        window.originals = Array.from(document.querySelectorAll('.mermaid > svg'), (svg) => ({
          svg,
          style: svg.getAttribute('style'),
          width: svg.getAttribute('width'),
          height: svg.getAttribute('height'),
          viewBox: svg.getAttribute('viewBox'),
        }));
        window.unowned = document.querySelector('#unowned').innerHTML;
        const module = { exports: {} };
        new Function('module', 'require', source)(module, () => obsidianMock);
        window.viewer = new module.exports.default();
        await viewer.onload();
      },
      {
        flow: fs.readFileSync(path.join(root, 'tests/fixtures/flow.svg'), 'utf8'),
        sequence: fs.readFileSync(path.join(root, 'tests/fixtures/sequence.svg'), 'utf8'),
        source: fs.readFileSync(path.join(root, 'dist/main.js'), 'utf8'),
      },
    );

    for (const width of [1280, 375, 800]) {
      await page.setViewport({ width, height: 800 });
      const failures = await page.evaluate(() => {
        const failures = [];
        for (const card of document.querySelectorAll('.mpv-note-diagram')) {
          const svg = card.querySelector(':scope > svg');
          const rect = svg.getBoundingClientRect();
          const bounds = card.getBoundingClientRect();
          const style = getComputedStyle(card);
          const left =
            bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
          const right =
            bounds.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
          const box = svg.viewBox.baseVal;
          const intrinsicWidth = Number(svg.getAttribute('width'));
          const intrinsicHeight = Number(svg.getAttribute('height'));
          const ratio =
            intrinsicWidth > 0 && intrinsicHeight > 0
              ? intrinsicHeight / intrinsicWidth
              : box.height / box.width;
          if (rect.left < left - 1 || rect.right > right + 1)
            failures.push(card.id + ': SVG exceeds card content');
          if (Math.abs(rect.height - rect.width * ratio) > 1)
            failures.push(card.id + ': SVG aspect ratio changed');
          if (card.scrollWidth > card.clientWidth + 1) failures.push(card.id + ': card overflows');
          if (bounds.left < 0 || bounds.right > innerWidth + 1)
            failures.push(card.id + ': card exceeds note width');
          if (getComputedStyle(svg).overflow !== 'hidden')
            failures.push(card.id + ': SVG paint can escape its viewport');
          const button = card.querySelector('.mpv-mermaid-window').getBoundingClientRect();
          if (button.left < left - 1 || button.right > right + 1)
            failures.push(card.id + ': fullscreen control exceeds card');
        }
        if (document.querySelector('#small-flow > svg').getBoundingClientRect().width > 241)
          failures.push('small diagram was enlarged');
        return failures;
      });
      assert.deepEqual(failures, [], `inline layout at ${width}px`);
    }

    // Responsive note styles must never constrain the fullscreen's fixed inner SVG.
    await page.click('#inline-flow .mpv-mermaid-window');
    const fullscreen = await page.$eval('.mpv-svg-content', (svg) => ({
      width: svg.getBoundingClientRect().width,
      style: getComputedStyle(svg).maxWidth,
      contentWidth: svg.width.baseVal.value,
      viewBoxWidth: svg.viewBox.baseVal.width,
    }));
    assert.equal(fullscreen.style, 'none');
    assert.equal(fullscreen.contentWidth, fullscreen.viewBoxWidth);
    assert(fullscreen.width > 0);
    await page.keyboard.press('Escape');

    await page.setViewport({ width: 1024, height: 800 });
    fs.mkdirSync(path.join(root, 'previews'), { recursive: true });
    await page
      .$('#fixed-flow')
      .then((el) => el.screenshot({ path: path.join(root, 'previews/inline-contained.png') }));

    // Scope changes and unload restore authored dimensions, including inline declarations.
    await page.evaluate(() => viewer.updateSettings({ noteClass: 'different-scope' }));
    assert.equal(await page.$$eval('.mpv-mermaid-window', (els) => els.length), 0);
    assert.equal(
      await page.evaluate(() =>
        originals.every(({ svg, style }) => svg.getAttribute('style') === style),
      ),
      true,
      'scope cleanup restores exact SVG styles',
    );
    await page.evaluate(async () => {
      await viewer.updateSettings({ noteClass: 'mermaid-notes' });
      await viewer.updateSettings({ noteClass: 'mermaid-notes' });
    });
    assert.equal(await page.$$eval('.mpv-mermaid-window', (els) => els.length), 4);
    await page.evaluate(() => viewer.unload());
    assert.equal(
      await page.evaluate(() =>
        originals.every(
          ({ svg, style, width, height, viewBox }) =>
            svg.getAttribute('style') === style &&
            svg.getAttribute('width') === width &&
            svg.getAttribute('height') === height &&
            svg.getAttribute('viewBox') === viewBox,
        ),
      ),
      true,
      'unload restores authored SVG dimensions',
    );
    assert.equal(
      await page.$eval('#unowned', (el) => el.innerHTML),
      await page.evaluate(() => unowned),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: inline SVG containment, aspect ratios, narrow notes, fixed fullscreen geometry and reversible cleanup.',
    );
  } finally {
    await browser.close();
  }
})();
