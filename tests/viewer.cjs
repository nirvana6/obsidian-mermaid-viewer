const fs = require('fs');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const path = require('node:path');
const fixture = process.argv[2] || 'sequence';
assert(['sequence', 'flow'].includes(fixture));
const dir = path.resolve(__dirname, '..');
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    fs.mkdirSync(path.join(dir, 'previews'), { recursive: true });
    const svg = fs.readFileSync(path.join(__dirname, 'fixtures', fixture + '.svg'), 'utf8');
    await page.setContent(
      `<style>*{box-sizing:border-box}.theme-dark .mermaid > svg{filter:invert(100%) hue-rotate(180deg) saturate(1.25)}body{background:#202020;color:#ddd;--background-primary:#202020;--background-modifier-border:#777;--text-muted:#aaa;--font-mermaid:Arial;--font-ui-small:13px}.modal-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000a}.modal{background:#202020}.mermaid-notes{width:700px}.mermaid svg{max-width:100%;height:auto}</style><main class="mermaid-notes markdown-preview-view"><h2>请求处理过程</h2><div class="mermaid">${svg}</div></main><aside><div class="mermaid">${svg}</div></aside>`,
    );
    await page.addStyleTag({ content: fs.readFileSync(dir + '/dist/styles.css', 'utf8') });
    await page.evaluate(require('./helpers/obsidian-mock.cjs'));
    await page.evaluate(() => (window.suppressPopout = true));
    await page.evaluate(
      ({ theme, main }) => {
        const themeModule = { exports: {} };
        new Function('module', 'require', theme)(themeModule, () => {});
        window.themeModule = themeModule.exports;
        window.module = { exports: {} };
        new Function('module', 'require', main)(module, (id) =>
          id === 'obsidian' ? obsidianMock : themeModule.exports,
        );
      },
      {
        theme: fs.readFileSync(dir + '/.test-build/theme.cjs', 'utf8'),
        main: fs.readFileSync(dir + '/dist/main.js', 'utf8'),
      },
    );
    // Fail on any plugin-created style element; Mermaid's existing SVG style is retained.
    await page.evaluate(() => {
      for (const method of ['createElement', 'createElementNS']) {
        const native = Document.prototype[method];
        Document.prototype[method] = function (...args) {
          const tag = args[method === 'createElementNS' ? 1 : 0];
          if (tag.toLowerCase() === 'style') throw Error('Runtime style injection');
          return native.apply(this, args);
        };
      }
    });
    await page.evaluate(async () => {
      window.viewer = new module.exports.default();
      await viewer.onload();
    });
    await page.waitForSelector('.mpv-mermaid-window');
    assert.equal(
      await page.$$eval('.mpv-mermaid-window', (els) => els.length),
      1,
      'must only affect scoped notes',
    );
    await page.click('.mpv-mermaid-window');
    await page.waitForFunction(() =>
      document
        .querySelector('.mpv-diagram-canvas')
        ?.querySelector('.mpv-svg-viewport')
        ?.hasAttribute('viewBox'),
    );
    await page.evaluate(() => {
      const m = [...viewer.modals.values()][0],
        svg = m.viewport.querySelector('svg');
      const initial = svg.outerHTML;
      const labels = [...svg.querySelectorAll('foreignObject')].map((el) => [
        el,
        el.getBBox().width,
        el.getBBox().height,
        el.querySelector('div')?.scrollHeight,
      ]);
      const line = svg.querySelector('.actor-line');
      const lineBox = line?.getBBox();
      const anchor = { x: 347.125, y: 192.625 };
      m.camera.zoomTo(1, anchor);
      m.render();
      const camera = () => m.viewport.getScreenCTM();
      const matrix = camera();
      const point = new DOMPoint(
        anchor.x + m.ui.stage.getBoundingClientRect().left + m.ui.stage.clientLeft,
        anchor.y + m.ui.stage.getBoundingClientRect().top + m.ui.stage.clientTop,
      ).matrixTransform(matrix.inverse());
      for (let i = 0; i < 150; i++) {
        m.camera.zoomTo(0.1 + i * 0.05, anchor);
        m.render();
        const screen = point.matrixTransform(camera());
        const expected = point.matrixTransform(matrix);
        if (Math.hypot(screen.x - expected.x, screen.y - expected.y) > 0.002)
          throw Error('Zoom anchor drift at step ' + i);
        for (const [el, w, h, sh] of labels) {
          if (
            el.getBBox().width !== w ||
            el.getBBox().height !== h ||
            el.querySelector('div')?.scrollHeight !== sh
          )
            throw Error('HTML label reflowed');
        }
        if (svg.outerHTML !== initial) throw Error('Inner SVG changed');
        if (line && JSON.stringify(line.getBBox()) !== JSON.stringify(lineBox))
          throw Error('Lifeline reflowed');
        if (getComputedStyle(m.ui.canvas).transform !== 'none') throw Error('CSS scaling remains');
      }
      m.fit();
    });
    const fit = await page.evaluate(() => {
      const m = [...viewer.modals.values()][0],
        s = m.ui.stage.getBoundingClientRect();
      return {
        scale: m.camera.scale,
        w: m.camera.bounds.width * m.camera.scale,
        h: m.camera.bounds.height * m.camera.scale,
        sw: s.width,
        sh: s.height,
        viewport: !!m.ui.canvas.querySelector('svg') && !m.ui.canvas.shadowRoot,
        styles: m.ui.canvas.querySelectorAll('style').length,
        originalStyles: document.querySelector('main .mermaid > svg').querySelectorAll('style')
          .length,
        originalWidth: document.querySelector('main .mermaid > svg').getAttribute('width'),
      };
    });
    assert.equal(fit.styles, fit.originalStyles, 'viewer must not add SVG styles');
    assert(fit.w <= fit.sw && fit.h <= fit.sh && fit.viewport);
    await page.evaluate(() => [...viewer.modals.values()][0].fitWidth());
    await page.screenshot({ path: path.join(dir, 'previews', fixture + '-paper-fullscreen.png') });
    await page.evaluate(() => [...viewer.modals.values()][0].fit());
    const light = await page.evaluate(() => {
      const m = [...viewer.modals.values()][0];
      return getComputedStyle(m.ui.canvas.querySelector('g[data-mpv-role] rect')).fill;
    });
    await page.evaluate(() => document.body.classList.add('theme-dark'));
    await new Promise((r) => setTimeout(r, 180));

    const dark = await page.evaluate(() => {
      const m = [...viewer.modals.values()][0];
      return getComputedStyle(m.ui.canvas.querySelector('g[data-mpv-role] rect')).fill;
    });
    assert.equal(light, dark, 'diagram palette must stay light when the vault switches theme');
    const appearance = await page.evaluate(() => {
      const svg = document.querySelector('main .mermaid > svg'),
        line = svg.querySelector('.actor-line');
      return {
        filter: getComputedStyle(svg).filter,
        background: getComputedStyle(svg.parentElement).backgroundColor,
        width: line && getComputedStyle(line).strokeWidth,
        effect: line && getComputedStyle(line).vectorEffect,
        dash: line && getComputedStyle(line).strokeDasharray,
      };
    });
    assert.equal(
      appearance.filter,
      'none',
      'disable Obsidian dark-mode inversion in inline diagrams',
    );
    assert.equal(appearance.background, 'rgb(250, 249, 245)');
    if (fixture === 'sequence') {
      assert.equal(appearance.width, '1px');
      assert.equal(appearance.effect, 'none');
      assert.equal(appearance.dash, 'none');
    }
    // Toolbar focus must not disable keyboard view controls.
    await page.focus('[aria-label="放大"]');
    await page.keyboard.press('w');
    assert.equal(
      await page.evaluate(() => [...viewer.modals.values()][0].camera.viewMode),
      'width',
    );
    await page.keyboard.press('f');
    assert.equal(
      await page.$$eval('.mpv-diagram-legend-item', (els) => els.length),
      fixture === 'sequence' ? 1 : 6,
    );
    await page.click('[aria-label="操作说明"]');
    assert.equal(await page.$eval('.mpv-diagram-help', (el) => el.hidden), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('.mpv-diagram-help', (el) => el.hidden), true);
    assert.equal(
      await page.$$eval('.mpv-diagram-modal', (els) => els.length),
      1,
      'Escape should close help before closing modal',
    );
    await page.click('[aria-label="放大"]');
    assert(
      Math.abs(
        (await page.evaluate(() => [...viewer.modals.values()][0].camera.scale)) - fit.scale * 1.25,
      ) < 1e-8,
    );
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('.mpv-diagram-toolbar button'))
        .find((b) => b.textContent === '原始尺寸')
        .click(),
    );
    assert.equal(await page.evaluate(() => [...viewer.modals.values()][0].camera.scale), 1);
    await page.waitForFunction(() => !document.querySelector('.mpv-diagram-canvas.is-animating'));
    const stage = await page.$('.mpv-diagram-stage');
    const bounds = await stage.boundingBox();
    const old = await page.evaluate(() => {
      const m = [...viewer.modals.values()][0];
      return { x: m.camera.x, y: m.camera.y };
    });
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 50);
    await page.mouse.up();
    const pan = await page.evaluate(() => {
      const m = [...viewer.modals.values()][0];
      return { x: m.camera.x, y: m.camera.y };
    });
    assert(Math.abs(pan.x - old.x - 80) < 1 && Math.abs(pan.y - old.y - 50) < 1);
    await page.mouse.wheel({ deltaY: 100 });
    await page.waitForFunction((y) => [...viewer.modals.values()][0].camera.y < y, {}, pan.y);
    assert.equal(
      await page.evaluate(() => [...viewer.modals.values()][0].camera.scale),
      1,
      'plain wheel must pan, not zoom',
    );
    await page.evaluate(() => {
      const m = [...viewer.modals.values()][0],
        rect = m.ui.stage.getBoundingClientRect();
      m.ui.stage.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          ctrlKey: true,
          clientX: rect.left + 300,
          clientY: rect.top + 200,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.waitForFunction(() => [...viewer.modals.values()][0].camera.scale > 1);
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('.mpv-diagram-toolbar button'))
        .find((b) => b.textContent === '完整显示')
        .click(),
    );
    await page.setViewport({ width: 820, height: 640 });
    await page.waitForFunction(() => {
      const m = [...viewer.modals.values()][0];
      return (
        m.camera.bounds.width * m.camera.scale <= m.ui.stage.clientWidth &&
        m.camera.bounds.height * m.camera.scale <= m.ui.stage.clientHeight
      );
    });
    // Real multi-touch events verify pinch zoom and pointer-capture cleanup.
    const touchBounds = await page.$eval('.mpv-diagram-stage', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    const session = await page.createCDPSession();
    const point = (id, x, y) => ({ id, x: touchBounds.x + x, y: touchBounds.y + y });
    const beforePinch = await page.evaluate(() => [...viewer.modals.values()][0].camera.scale);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(1, 200, 220), point(2, 300, 220)],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(1, 150, 220), point(2, 350, 220)],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterPinch = await page.evaluate(() => {
      const m = [...viewer.modals.values()][0];
      return {
        scale: m.camera.scale,
        pointers: m.input.pointers.size,
        dragging: m.ui.stage.classList.contains('is-dragging'),
      };
    });
    assert(
      Math.abs(afterPinch.scale / beforePinch - 2) < 0.02,
      'two-finger pinch should double scale',
    );
    assert.equal(afterPinch.pointers, 0);
    assert.equal(afterPinch.dragging, false);
    await session.detach();
    // Camera/control DOM updates must not rescan every diagram in the vault.
    await page.evaluate(() => {
      viewer.metadataCalls = 0;
      const original = viewer.metadata;
      viewer.metadata = function (...args) {
        this.metadataCalls++;
        return original.apply(this, args);
      };
    });
    for (let i = 0; i < 6; i++) await page.click('[aria-label="放大"]');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(
      await page.evaluate(() => viewer.metadataCalls),
      0,
      'zoom should not rescan notes',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.$$eval('.mpv-diagram-modal', (els) => els.length), 0);
    assert.equal(
      await page.evaluate(() => document.activeElement.classList.contains('mpv-mermaid-window')),
      true,
      'restore focus to the opener',
    );
    await page.screenshot({
      path: path.join(dir, 'previews', fixture + '-paper-inline-dark-vault.png'),
    });
    // Removing the note class must remove styles and controls, and re-adding it must restore them.
    await page.evaluate(() => document.querySelector('main').classList.remove('mermaid-notes'));
    await page.waitForFunction(
      () =>
        !document.querySelector('main .mpv-diagram') &&
        !document.querySelector('.mpv-mermaid-window'),
    );
    await page.evaluate(() => document.querySelector('main').classList.add('mermaid-notes'));
    await page.waitForSelector('.mpv-mermaid-window');
    await page.evaluate(() => (document.querySelector('main h2').textContent = '更新后的示例'));
    await page.waitForFunction(() =>
      document.querySelector('.mpv-mermaid-caption').textContent.includes('更新后的示例'),
    );
    for (let i = 0; i < 3; i++) {
      await page.click('.mpv-mermaid-window');
      await page.click('[aria-label="关闭（Esc）"]');
    }
    assert.equal(await page.evaluate(() => viewer.modals.size), 0);
    await page.setViewport({ width: 390, height: 720 });
    await page.click('.mpv-mermaid-window');
    await page.waitForFunction(() =>
      [...viewer.modals.values()][0]?.viewport.hasAttribute('viewBox'),
    );
    const narrow = await page.evaluate(() => {
      const m = [...viewer.modals.values()][0];
      return {
        viewport: innerWidth,
        modal: m.modalEl.getBoundingClientRect().width,
        controls: [...m.contentEl.querySelectorAll('button')]
          .filter((b) => !b.closest('[hidden]'))
          .map((b) => {
            const r = b.getBoundingClientRect();
            return { left: r.left, right: r.right, bottom: r.bottom };
          }),
      };
    });
    assert(narrow.modal <= narrow.viewport);
    assert(
      narrow.controls.every((r) => r.left >= 0 && r.right <= narrow.viewport && r.bottom <= 720),
      'narrow controls must fit',
    );
    await page.screenshot({ path: path.join(dir, 'previews', fixture + '-paper-mobile.png') });
    await page.keyboard.press('Escape');
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluate(() => {
      const svg = document.querySelector('main .mermaid > svg');
      for (let i = 0; i < 10; i++) themeModule.decorate(svg);
    });
    assert.equal(
      await page.$$eval('main svg.mpv-diagram.mpv-palette', (els) => els.length),
      1,
      'decoration must be idempotent',
    );
    assert.equal(
      await page.$$eval('aside svg.mpv-diagram', (els) => els.length),
      0,
      'unscoped notes remain unchanged',
    );
    // A background window can pause animation frames: opening must still set a usable camera.
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
      try {
        document.querySelector('.mpv-mermaid-window').click();
        const modal = [...viewer.modals.values()][0];
        const box = modal.viewport.getAttribute('viewBox').split(' ').map(Number);
        const width = modal.ui.canvas.getBoundingClientRect().width;
        if (Math.abs(box[2] * modal.camera.scale - width) > 0.01)
          throw Error('Camera initialization depends on an animation frame');
        modal.close();
      } finally {
        window.requestAnimationFrame = raf;
      }
    });
    // Settings apply immediately, persist across reload, and clean the old scope.
    await page.evaluate(() => viewer.updateSettings({ noteClass: '' }));
    assert.equal(await page.$$eval('.mpv-mermaid-window', (els) => els.length), 2);
    assert.deepEqual(await page.evaluate(() => savedSettings), {
      noteClass: '',
    });
    await page.evaluate(async () => {
      document.querySelector('aside').classList.add('review-diagrams');
      await viewer.updateSettings({ noteClass: 'review-diagrams' });
      viewer.unload();
      window.viewer = new module.exports.default();
      await viewer.onload();
    });
    assert.equal(await page.$$eval('main .mpv-mermaid-window', (els) => els.length), 0);
    assert.equal(await page.$$eval('main svg.mpv-diagram', (els) => els.length), 0);
    assert.equal(await page.$$eval('aside .mpv-mermaid-window', (els) => els.length), 1);
    // Storage failure must preserve the active settings and visible controls.
    await page.evaluate(async () => {
      const save = viewer.saveData;
      viewer.saveData = async () => {
        throw Error('Storage unavailable');
      };
      await viewer.updateSettings({ noteClass: '' });
      viewer.saveData = save;
    });
    assert.equal(await page.evaluate(() => viewer.settings.noteClass), 'review-diagrams');
    assert.equal(await page.$$eval('.mpv-mermaid-window', (els) => els.length), 1);
    // Other Mermaid types retain their original SVG styling after decoration and cleanup.
    assert(
      await page.evaluate(() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML =
          '<style>.pieCircle { fill: #123456; }</style><circle class="pieCircle" r="20"/><text fill="#abcdef">Slice</text>';
        const original = svg.innerHTML;
        document.body.appendChild(svg);
        themeModule.decorate(svg);
        const color = getComputedStyle(svg.querySelector('circle')).fill;
        themeModule.clean(svg);
        const preserved = svg.innerHTML === original && color === 'rgb(18, 52, 86)';
        svg.remove();
        return preserved;
      }),
    );
    await page.evaluate(() => viewer.unload());
    assert.equal(await page.$$eval('svg.mpv-diagram', (els) => els.length), 0);
    assert.equal(await page.$$eval('[data-mpv-role]', (els) => els.length), 0);
    assert.equal(await page.$$eval('.mpv-mermaid-window', (els) => els.length), 0);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: fixed light palette, role legend, help, idempotent decoration, clean unload; scope, fit, zoom buttons, 100%, pointer pan, wheel zoom, resize, Escape, repeated close, unload, zero page errors.',
    );
  } finally {
    await browser.close();
  }
})();
