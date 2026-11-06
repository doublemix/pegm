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
    editor.addEventListener('input', markEdited);
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        run();
      } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
        markEdited();
      }
    });
  }
  $('source-count').textContent = `${$('source').value.length} characters`;
  run();
})();
