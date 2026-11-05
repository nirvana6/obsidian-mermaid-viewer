module.exports = function installObsidianMock() {
  Node.prototype.createEl = function (tag, options = {}) {
    const e = (this.ownerDocument ?? document).createElement(tag);
    if (options.cls) e.className = options.cls;
    if (options.text) e.textContent = options.text;
    for (const [k, v] of Object.entries(options.attr || {})) e.setAttribute(k, v);
    if (options.prepend) this.prepend(e);
    else this.appendChild(e);
    return e;
  };
  Node.prototype.createDiv = function (options = {}) {
    return this.createEl('div', options);
  };
  Node.prototype.createSpan = function (options = {}) {
    return this.createEl('span', options);
  };
  Element.prototype.empty = function () {
    this.replaceChildren();
  };
  Node.prototype.createSvg = function (tag, options = {}) {
    const e = (this.ownerDocument ?? document).createElementNS('http://www.w3.org/2000/svg', tag);
    if (options.cls) e.setAttribute('class', options.cls);
    for (const [k, v] of Object.entries(options.attr || {})) e.setAttribute(k, v);
    this.appendChild(e);
    return e;
  };
  Object.defineProperty(Node.prototype, 'win', {
    configurable: true,
    get() {
      return this.ownerDocument?.defaultView ?? window;
    },
  });
  Object.defineProperty(Node.prototype, 'doc', {
    configurable: true,
    get() {
      return this.ownerDocument ?? document;
    },
  });
  const setCssStyles = function (styles) {
    Object.assign(this.style, styles);
  };
  HTMLElement.prototype.setCssStyles = SVGElement.prototype.setCssStyles = setCssStyles;
  HTMLElement.prototype.addClass = function (...classes) {
    this.classList.add(...classes);
    return this;
  };
  HTMLElement.prototype.removeClass = function (...classes) {
    this.classList.remove(...classes);
    return this;
  };
  class MarkdownView {}

  // Windows, leaves and events: enough of the workspace for per-window behaviour.
  const events = new Map();
  const leaves = [];
  /** A leaf in `containerEl`; overrides replace the default detach/openFile behaviour. */
  function makeLeaf(containerEl, overrides = {}) {
    const leaf = {
      containerEl,
      view: { containerEl, file: { basename: '示例笔记' } },
      detach: () => containerEl.remove(),
      async openFile() {},
      async setViewState(state) {
        const factory = workspace.viewFactories.get(state.type);
        if (!factory) throw new Error(`No view registered for ${state.type}`);
        this.view = factory(this);
      },
      ...overrides,
    };
    return leaf;
  }
  const mainLeaf = makeLeaf(document.querySelector('main'), {
    detach() {
      const index = leaves.indexOf(mainLeaf);
      if (index >= 0) leaves.splice(index, 1);
    },
  });
  leaves.push(mainLeaf);
  window.activeWindow = window;
  function createMainLeaf() {
    // A host without pop-out windows reuses the main window for the new leaf.
    return makeLeaf(document.body.createDiv({ cls: 'workspace-leaf-content' }));
  }
  function createPopoutLeaf() {
    const frame = document.body.createEl('iframe');
    const win = frame.contentWindow;
    win.eval(`(${installObsidianMock.toString()})()`);
    const note = win.document.body.createDiv({ cls: 'markdown-preview-view mermaid-notes' });
    // A window whose frame left the document is closed, the way the host reports `win.closed`.
    Object.defineProperty(win, 'closed', {
      configurable: true,
      get: () => !document.contains(frame),
    });
    // Modal.open follows the active window, so a focused pop-out owns the next modal.
    Object.defineProperty(win, 'focus', {
      configurable: true,
      value: () => {
        frame.focus();
        if (!window.suppressFocus) window.activeWindow = win;
      },
    });
    // Script-opened windows are closable; closing drops the window the way the host does.
    Object.defineProperty(win, 'close', {
      configurable: true,
      value: () => leaf.detach(),
    });
    if (!window.suppressFocus) window.activeWindow = win;
    const leaf = makeLeaf(note, {
      detach() {
        const index = leaves.indexOf(leaf);
        if (index >= 0) leaves.splice(index, 1);
        frame.remove();
        if (window.activeWindow === win) window.activeWindow = window;
        workspace.trigger('window-close', { win, doc: win.document }, win);
      },
      async openFile() {
        // Mermaid renders after the file opens, so the diagram arrives asynchronously.
        await new Promise((resolve) => setTimeout(resolve, 30));
        note.createDiv({ cls: 'mermaid' }).innerHTML = window.mermaidFixture ?? '';
      },
    });
    leaves.push(leaf);
    workspace.trigger('window-open', { win, doc: win.document }, win);
    return leaf;
  }
  const workspace = {
    containerEl: document.body,
    viewFactories: new Map(),
    onLayoutReady: (fn) => fn(),
    on(name, callback) {
      const ref = { name, callback };
      const entries = events.get(name) ?? [];
      entries.push(ref);
      events.set(name, entries);
      return ref;
    },
    off(ref) {
      const entries = events.get(ref.name) ?? [];
      const index = entries.indexOf(ref);
      if (index >= 0) entries.splice(index, 1);
    },
    trigger(name, ...args) {
      for (const ref of [...(events.get(name) ?? [])]) ref.callback(...args);
    },
    getActiveViewOfType: () => ({ containerEl: document.querySelector('main') }),
    getLeavesOfType: () => leaves,
    iterateAllLeaves: (callback) => [...leaves].forEach(callback),
    getLeaf(paneType) {
      if (paneType !== 'window') return mainLeaf;
      return window.suppressPopout ? createMainLeaf() : createPopoutLeaf();
    },
  };

  class Plugin {
    constructor() {
      this.app = { workspace };
      this.cleanups = [];
      this.commands = [];
    }
    async loadData() {
      return window.savedSettings ?? { noteClass: 'mermaid-notes' };
    }
    async saveData(value) {
      window.savedSettings = value;
    }
    addSettingTab(tab) {
      this.settingsTab = tab;
    }
    register(f) {
      this.cleanups.push(f);
    }
    registerDomEvent(el, type, fn) {
      el.addEventListener(type, fn);
      this.register(() => el.removeEventListener(type, fn));
    }
    registerEvent(ref) {
      this.register(() => workspace.off(ref));
    }
    addCommand(command) {
      this.commands.push(command);
    }
    registerView(type, factory) {
      workspace.viewFactories.set(type, factory);
    }
    unload() {
      this.onunload();
      this.cleanups.forEach((f) => f());
    }
  }
  class Scope {
    constructor(parent) {
      this.parent = parent;
      this.keys = [];
    }
    register(modifiers, key, func) {
      this.keys.push({ key, func });
    }
    handleKey(event) {
      const entry = this.keys.find((k) => k.key === event.key);
      return entry ? entry.func(event) : this.parent?.handleKey(event);
    }
  }
  class Modal {
    constructor() {
      this.scope = new Scope();
      this.scope.register([], 'Escape', () => {
        this.close();
        return false;
      });
    }
    open() {
      const doc = (window.activeWindow ?? window).document;
      this.containerEl = doc.createElement('div');
      this.containerEl.className = 'modal-container';
      this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
      this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
      this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
      doc.body.appendChild(this.containerEl);
      this.doc = doc;
      this.onOpen();
      this.escape = (e) => {
        if (this.scope.handleKey(e) === false) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      };
      doc.addEventListener('keydown', this.escape, true);
    }
    close() {
      this.doc.removeEventListener('keydown', this.escape, true);
      this.onClose();
      this.containerEl.remove();
    }
  }
  const setIcon = (el, icon) => {
    const paths = {
      x: 'M6 6l12 12M18 6 6 18',
      minus: 'M5 12h14',
      plus: 'M5 12h14M12 5v14',
      'maximize-2': 'M8 3H3v5M16 21h5v-5M3 3l6 6M21 21l-6-6',
      'picture-in-picture-2':
        'M21 9V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M12 13h9v6h-9z',
      'grid-2x2': 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
      'circle-help': 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01',
    };
    el.innerHTML =
      '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="' +
      (paths[icon] || paths.plus) +
      '"/></svg>';
  };
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.containerEl = leaf.containerEl;
      this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
    }
  }

  window.obsidianMock = {
    Plugin,
    ItemView,
    MarkdownView,
    Modal,
    Scope,
    PluginSettingTab: class {
      constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = document.createElement('div');
      }
    },
    Setting: class {
      constructor(parent) {
        this.settingEl = parent.createDiv({ cls: 'setting-item' });
        this.nameEl = this.settingEl.createDiv({ cls: 'setting-item-name' });
        this.descEl = this.settingEl.createDiv({ cls: 'setting-item-description' });
      }
      setName(value) {
        this.nameEl.textContent = value;
        return this;
      }
      setDesc(value) {
        this.descEl.textContent = value;
        return this;
      }
      addText(callback) {
        const inputEl = this.settingEl.createEl('input');
        const text = {
          inputEl,
          setPlaceholder(value) {
            inputEl.placeholder = value;
            return this;
          },
          setValue(value) {
            inputEl.value = value;
            return this;
          },
          getValue() {
            return inputEl.value;
          },
        };
        callback(text);
        return this;
      }
    },
    Notice: class {},
    setIcon,
  };
};
