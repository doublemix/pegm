(() => {
  const { compile } = window.pegm;
  const TIMEOUT_MS = 3000;
  const $ = (id) => document.getElementById(id);
  const tabs = ['result', 'code'];
  const labels = { result: 'PARSE RESULT', code: 'GENERATED JAVASCRIPT' };
  let activeTab = 'result';
  let activeWorker = null;
  let timer = null;
  let revision = 0;

  $('grammar').value = `Main
  = words:$([a-zA-Z]+)<' '>+ => (words.toUpperCase())
`;
  $('source').value = 'hello world';

  const grammarEditor = $('grammar');
  const fileTypes = [{ description: 'PEGM grammar', accept: { 'text/plain': ['.pegm'] } }];
  const canAccessFiles = typeof window.showOpenFilePicker === 'function' &&
    typeof window.showSaveFilePicker === 'function';
  let fileHandle = null;
  let fileName = 'Untitled';
  let savedText = grammarEditor.value;
  let diskText = null;
  let fileBusy = false;
  let fileMessage = '';
  let fileError = false;
  let memoryDraft = null;

  function isGrammarDirty() {
    return grammarEditor.value !== savedText;
  }

  function warnBeforeLeaving(event) {
    event.preventDefault();
    event.returnValue = '';
  }

  function updateFileStatus() {
    const dirty = isGrammarDirty();
    $('file-status').textContent = `${fileName}${dirty ? ' • Unsaved changes' : ''}${fileMessage ? ` — ${fileMessage}` : ''}`;
    $('file-status').classList.toggle('error', fileError);
    $('file-status').title = $('file-status').textContent;
    $('open-file-label').hidden = !fileHandle;
    $('open-file-name').textContent = fileHandle ? fileName : '';
    $('open-file-name').title = fileHandle ? fileName : '';
    window.removeEventListener('beforeunload', warnBeforeLeaving);
    if (dirty) window.addEventListener('beforeunload', warnBeforeLeaving);
  }

  function setFileBusy(busy) {
    fileBusy = busy;
    for (const id of ['open-file', 'save-file', 'save-as-file', 'close-file']) $(id).disabled = busy;
  }

  function setFileMessage(message, isError = false) {
    fileMessage = message;
    fileError = isError;
    updateFileStatus();
  }

  function confirmReplace() {
    return !fileHandle || !isGrammarDirty() || window.confirm('Discard unsaved grammar changes and open another file?');
  }

  async function loadFile(file, handle, originalText) {
    const text = await file.text();
    if (grammarEditor.value !== originalText && !confirmReplace()) return;
    if (!fileHandle) memoryDraft = { text: grammarEditor.value, savedText };
    grammarEditor.value = text;
    savedText = grammarEditor.value;
    diskText = text;
    fileHandle = handle;
    fileName = file.name;
    setFileMessage('Opened');
    markEdited();
    run();
  }

  async function openFile() {
    if (fileBusy || !confirmReplace()) return;
    const originalText = grammarEditor.value;
    setFileBusy(true);
    try {
      let handles;
      try {
        handles = await window.showOpenFilePicker({ types: fileTypes, multiple: false });
      } catch (error) {
        if (error.name === 'AbortError') return;
        throw error;
      }
      const handle = handles[0];
      await loadFile(await handle.getFile(), handle, originalText);
    } catch (error) {
      setFileMessage(`Open failed: ${formatError(error)}`, true);
    } finally {
      setFileBusy(false);
    }
  }

  async function saveFile(saveAs = false) {
    if (fileBusy) return;
    setFileBusy(true);
    try {
      let handle = saveAs ? null : fileHandle;
      if (!handle) {
        try {
          handle = await window.showSaveFilePicker({
            suggestedName: fileName === 'Untitled' ? 'grammar.pegm' : fileName,
            types: fileTypes,
          });
        } catch (error) {
          if (error.name === 'AbortError') return;
          throw error;
        }
      }
      if (handle === fileHandle) {
        const currentDiskText = await (await handle.getFile()).text();
        if (currentDiskText !== diskText && !window.confirm('This file has changed on disk. Overwrite it with the editor contents?')) return;
      }
      const text = grammarEditor.value;
      const writable = await handle.createWritable();
      try {
        await writable.write(text);
        await writable.close();
      } catch (error) {
        try {
          await writable.abort();
        } catch (abortError) {
          throw new Error(`${formatError(error)}; could not abort write: ${formatError(abortError)}`);
        }
        throw error;
      }
      if (!fileHandle) memoryDraft = null;
      fileHandle = handle;
      fileName = handle.name;
      savedText = text;
      diskText = text;
      setFileMessage(isGrammarDirty() ? 'Saved earlier version' : 'Saved');
    } catch (error) {
      setFileMessage(`Save failed: ${formatError(error)}`, true);
    } finally {
      setFileBusy(false);
    }
  }

  function closeFile() {
    if (!fileHandle || fileBusy) return;
    if (isGrammarDirty() && !window.confirm('Discard unsaved grammar changes and close this file?')) return;
    fileHandle = null;
    fileName = 'Untitled';
    diskText = null;
    grammarEditor.value = memoryDraft ? memoryDraft.text : '';
    savedText = memoryDraft ? memoryDraft.savedText : '';
    memoryDraft = null;
    setFileMessage('');
    markEdited();
    run();
  }

  function setStatus(text, kind = '') {
    $('status').textContent = text;
    $('status').className = `status ${kind}`;
  }

  function showTab(name, focus = false) {
    activeTab = name;
    for (const id of tabs) {
      const selected = id === name;
      $(`tab-${id}`).setAttribute('aria-selected', String(selected));
      $(`tab-${id}`).tabIndex = selected ? 0 : -1;
      $(id).hidden = !selected;
    }
    $('output-label').textContent = labels[name];
    if (focus) $(`tab-${name}`).focus();
  }

  function formatError(error) {
    if (error && error.location && error.location.start) {
      const { line, column } = error.location.start;
      return `${error.message} (line ${line}, column ${column})`;
    }
    return String(error && error.message ? error.message : error);
  }

  function cancelWorker() {
    if (activeWorker) activeWorker.terminate();
    activeWorker = null;
    clearTimeout(timer);
    timer = null;
  }

  function markEdited() {
    revision++;
    cancelWorker();
    setStatus('Edited - run to update', 'pending');
    $('output-note').textContent = 'Output may be out of date';
    $('source-count').textContent = `${$('source').value.length} characters`;
    updateFileStatus();
  }

  function markGrammarEdited() {
    fileMessage = '';
    fileError = false;
    markEdited();
  }

  function run() {
    const currentRevision = ++revision;
    cancelWorker();
    for (const id of tabs) $(id).textContent = '';
    $('output-note').textContent = 'Current run';
    let compiled;
    try {
      compiled = compile($('grammar').value, { target: 'browser' });
    } catch (error) {
      compiled = { success: false, error };
    }
    if (!compiled.success) {
      setStatus(compiled.error && compiled.error.location ? 'Grammar error' : 'Compile error', 'error');
      $('result').textContent = formatError(compiled.error);
      showTab('result');
      return;
    }
    $('code').textContent = compiled.code;
    setStatus('Running...', 'pending');

    try {
      const worker = new Worker('worker.js');
      activeWorker = worker;
      timer = setTimeout(() => {
        if (revision !== currentRevision) return;
        cancelWorker();
        setStatus('Timed out', 'error');
        $('result').textContent = `Parser execution timed out after ${TIMEOUT_MS / 1000} seconds.`;
        showTab('result');
      }, TIMEOUT_MS);
      worker.onmessage = (event) => {
        if (revision !== currentRevision) return;
        cancelWorker();
        const outcome = event.data;
        if (!outcome.ok) {
          setStatus('Runtime error', 'error');
          $('result').textContent = outcome.error;
          showTab('result');
          return;
        }
        try {
          const output = JSON.stringify(outcome.result, null, 2);
          $('result').textContent = output === undefined ? String(outcome.result) : output;
        } catch (error) {
          setStatus('Output error', 'error');
          $('result').textContent = `Could not display the result: ${formatError(error)}`;
          showTab('result');
          return;
        }
        setStatus(outcome.result && outcome.result.success === false ? 'Parse failed' : 'Parse successful',
          outcome.result && outcome.result.success === false ? 'error' : '');
      };
      worker.onerror = (event) => {
        if (revision !== currentRevision) return;
        cancelWorker();
        setStatus('Runtime error', 'error');
        $('result').textContent = event.message;
        showTab('result');
      };
      worker.postMessage({ code: compiled.code, source: $('source').value });
    } catch (error) {
      cancelWorker();
      setStatus('Runtime error', 'error');
      $('result').textContent = formatError(error);
      showTab('result');
    }
  }

  $('run').addEventListener('click', run);
  $('open-file').addEventListener('click', openFile);
  $('close-file').addEventListener('click', closeFile);
  $('save-file').addEventListener('click', () => saveFile());
  $('save-as-file').addEventListener('click', () => saveFile(true));
  document.addEventListener('keydown', (event) => {
    if (canAccessFiles && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveFile(event.shiftKey);
    }
  });
  $('tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) showTab(tab.dataset.tab);
  });
  $('tabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    showTab(tabs[(tabs.indexOf(activeTab) + offset + tabs.length) % tabs.length], true);
  });
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($(activeTab).textContent);
      $('output-note').textContent = 'Copied to clipboard';
    } catch (error) {
      $('output-note').textContent = `Copy failed: ${formatError(error)}`;
    }
  });
  for (const id of ['grammar', 'source']) {
    const editor = $(id);
    editor.addEventListener('input', () => {
      if (id === 'grammar') markGrammarEdited();
      else markEdited();
    });
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        run();
      } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
        if (id === 'grammar') markGrammarEdited();
        else markEdited();
      }
    });
  }
  $('file-actions').hidden = !canAccessFiles;
  $('save-shortcut').hidden = !canAccessFiles;
  $('source-count').textContent = `${$('source').value.length} characters`;
  run();
})();
