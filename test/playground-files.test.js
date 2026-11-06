const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('web/playground/app.js', 'utf8');

function createPlayground({ direct = true } = {}) {
  const elements = new Map();
  const listeners = new Map();
  const confirmations = [];
  const downloads = [];
  const windowListeners = new Map();
  let openPicker;
  let savePicker;

  function element(id) {
    if (!elements.has(id)) {
      const handlers = new Map();
      elements.set(id, {
        id, value: '', textContent: '', className: '', title: '', disabled: false,
        classList: { toggle() {} },
        addEventListener(type, fn) { handlers.set(type, fn); },
        dispatch(type, event = {}) { return handlers.get(type)?.({ target: this, ...event }); },
        setAttribute() {},
        focus() {},
        click() { if (this.download) downloads.push(this.download); },
      });
    }
    return elements.get(id);
  }
  const document = {
    getElementById: element,
    addEventListener(type, fn) { listeners.set(type, fn); },
    createElement() { return element(`link-${downloads.length}`); },
  };
  const window = {
    pegm: { compile: () => ({ success: true, code: '' }) },
    confirm: () => confirmations.shift() ?? true,
    addEventListener(type, fn) { windowListeners.set(type, fn); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  if (direct) {
    window.showOpenFilePicker = (...args) => openPicker(...args);
    window.showSaveFilePicker = (...args) => savePicker(...args);
  }
  const context = {
    window, document, navigator: { clipboard: {} }, Blob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Worker: class { postMessage() {} terminate() {} },
    setTimeout: () => 1, clearTimeout() {},
  };
  vm.runInNewContext(app, context);
  return {
    element, windowListeners, confirmations, downloads,
    open(fn) { openPicker = fn; },
    save(fn) { savePicker = fn; },
    edit(text) { element('grammar').value = text; element('grammar').dispatch('input'); },
    key(event) { return listeners.get('keydown')(event); },
  };
}

function fileHandle(name, initial) {
  let content = initial;
  return {
    name,
    get content() { return content; },
    set content(value) { content = value; },
    async getFile() { return { name, text: async () => content }; },
    async createWritable() {
      let written;
      return {
        async write(value) { written = value; },
        async close() { content = written; },
        async abort() {},
      };
    },
  };
}

test('opens, saves and detects external changes', async () => {
  const page = createPlayground();
  const file = fileHandle('example.pegm', 'Main = "a"');
  page.open(async () => [file]);
  await page.element('open-file').dispatch('click');
  assert.equal(page.element('grammar').value, 'Main = "a"');
  page.edit('Main = "b"');
  assert.ok(page.windowListeners.has('beforeunload'));
  await page.element('save-file').dispatch('click');
  assert.equal(file.content, 'Main = "b"');
  assert.equal(page.windowListeners.has('beforeunload'), false);

  page.edit('Main = "c"');
  file.content = 'external';
  page.confirmations.push(false);
  await page.element('save-file').dispatch('click');
  assert.equal(file.content, 'external');
  assert.match(page.element('file-status').textContent, /Unsaved/);
  page.confirmations.push(true);
  await page.element('save-file').dispatch('click');
  assert.equal(file.content, 'Main = "c"');
});

test('save as and keyboard save preserve edits made while writing', async () => {
  const page = createPlayground();
  const file = fileHandle('new.pegm', '');
  let finishWrite;
  file.createWritable = async () => ({
    write: () => new Promise(resolve => { finishWrite = resolve; }),
    async close() {},
    async abort() {},
  });
  page.save(async () => file);
  let prevented = false;
  page.key({ key: 's', ctrlKey: true, preventDefault() { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  page.edit('modified during save');
  finishWrite();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.match(page.element('file-status').textContent, /Unsaved changes.*earlier version/);
});

test('save as switches the associated file only after a successful write', async () => {
  const page = createPlayground();
  const original = fileHandle('original.pegm', 'first');
  const copy = fileHandle('copy.pegm', '');
  page.open(async () => [original]);
  await page.element('open-file').dispatch('click');
  page.edit('second');
  page.save(async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); });
  await page.element('save-as-file').dispatch('click');
  await page.element('save-file').dispatch('click');
  assert.equal(original.content, 'second');
  page.save(async () => copy);
  await page.element('save-as-file').dispatch('click');
  page.edit('third');
  await page.element('save-file').dispatch('click');
  assert.equal(original.content, 'second');
  assert.equal(copy.content, 'third');
});

test('open cancellation and failed saves preserve the editor', async () => {
  const page = createPlayground();
  const original = page.element('grammar').value;
  page.open(async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); });
  await page.element('open-file').dispatch('click');
  assert.equal(page.element('grammar').value, original);
  page.edit('edited');
  page.save(async () => { throw new Error('permission denied'); });
  await page.element('save-file').dispatch('click');
  assert.match(page.element('file-status').textContent, /Save failed: permission denied/);

});

test('closing a file restores the previous in-memory draft and protects unsaved file edits', async () => {
  const page = createPlayground();
  page.edit('my in-memory draft');
  const file = fileHandle('example.pegm', 'file contents');
  page.open(async () => [file]);
  await page.element('open-file').dispatch('click');
  assert.equal(page.element('open-file-label').hidden, false);
  assert.equal(page.element('open-file-name').textContent, 'example.pegm');
  page.edit('modified file');
  page.confirmations.push(false);
  page.element('close-file').dispatch('click');
  assert.equal(page.element('grammar').value, 'modified file');
  assert.equal(page.element('open-file-label').hidden, false);
  page.confirmations.push(true);
  page.element('close-file').dispatch('click');
  assert.equal(page.element('grammar').value, 'my in-memory draft');
  assert.equal(page.element('open-file-label').hidden, true);
  assert.ok(page.windowListeners.has('beforeunload'));
});

test('closing a saved in-memory grammar starts an empty draft', async () => {
  const page = createPlayground();
  const file = fileHandle('saved.pegm', '');
  page.save(async () => file);
  await page.element('save-file').dispatch('click');
  assert.equal(page.element('open-file-name').textContent, 'saved.pegm');
  page.element('close-file').dispatch('click');
  assert.equal(page.element('grammar').value, '');
  assert.equal(page.element('open-file-label').hidden, true);
  assert.equal(page.windowListeners.has('beforeunload'), false);
});

test('switching files keeps the original in-memory draft', async () => {
  const page = createPlayground();
  page.edit('draft');
  page.open(async () => [fileHandle('first.pegm', 'first')]);
  await page.element('open-file').dispatch('click');
  page.edit('unsaved first');
  page.confirmations.push(false);
  page.open(async () => [fileHandle('second.pegm', 'second')]);
  await page.element('open-file').dispatch('click');
  assert.equal(page.element('open-file-name').textContent, 'first.pegm');
  page.confirmations.push(true);
  await page.element('open-file').dispatch('click');
  assert.equal(page.element('open-file-name').textContent, 'second.pegm');
  page.element('close-file').dispatch('click');
  assert.equal(page.element('grammar').value, 'draft');
});

test('unsupported browsers keep the in-memory editor without file controls or a save shortcut', () => {
  const page = createPlayground({ direct: false });
  assert.equal(page.element('file-actions').hidden, true);
  assert.equal(page.element('save-shortcut').hidden, true);
  page.edit('unsaved grammar');
  let prevented = false;
  page.key({ key: 's', ctrlKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.ok(page.windowListeners.has('beforeunload'));
  assert.equal(page.element('grammar').value, 'unsaved grammar');
});
