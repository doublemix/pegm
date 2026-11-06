// Builds web/dist/pegm-web.js by wrapping the CommonJS modules verbatim.
// compile.js emits code from Function.prototype.toString(), so a bundler that renames identifiers would corrupt its output.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modules = { './pegm': 'pegm.js', './compile': 'compile.js' };

let out = '(function () {\n"use strict";\nconst modules = {};\nconst cache = {};\n';
out += 'function load(name) {\n  if (!cache[name]) {\n    const module = { exports: {} };\n    cache[name] = module;\n    modules[name](module, module.exports, load);\n  }\n  return cache[name].exports;\n}\n';
for (const [name, file] of Object.entries(modules)) {
  const source = fs.readFileSync(path.join(root, file), 'utf-8').replace(/^"use strict";\s*/m, '');
  out += `modules[${JSON.stringify(name)}] = function (module, exports, require) {\n${source}\n};\n`;
}
out += 'window.pegm = { parse: load("./pegm").parse, compile: load("./compile").compile };\n})();\n';

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'pegm-web.js'), out);
console.log('Built web/dist/pegm-web.js');
