// Runs a generated (browser target) parser off the main thread so it can be terminated on timeout.
self.onmessage = (event) => {
  const { code, source } = event.data;
  try {
    const parser = new Function(`${code}\nreturn parse;`)();
    self.postMessage({ ok: true, result: parser(source) });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error && error.stack ? error.stack : error) });
  }
};
