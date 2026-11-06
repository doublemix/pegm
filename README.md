# PEGM

PEGM is a parser generator for JavaScript.

## Playground

Build and serve the site locally:

```sh
npm ci
npm run serve:web
```

Open `http://localhost:8080/` for the home page or
`http://localhost:8080/playground/` for the playground. Set `PORT` to use
a different local port. Run `npm run build:web` to generate the browser
compiler bundle without starting the server.

The playground automatically recompiles and parses after you pause editing
the grammar or input.

Use **Open** to load a grammar and **Save** (Ctrl+S or Cmd+S) to write it
back. **Save as** chooses a new file. Browsers supporting the File System
Access API can save directly to a selected file on HTTPS or localhost;
permission may be requested again. In other browsers, file controls are
unavailable, and the playground remains an in-memory
editor. File access is not retained after reloading the page.

The grammar bar shows the selected filename. Close it with the adjacent
button to return to the in-memory draft that was present before opening a
file. If an in-memory grammar was saved as a file, closing it starts an empty
draft instead. Unsaved file edits require confirmation before closing.

The site is deployed by the GitHub Pages workflow on pushes to `main`.
In repository settings, set **Pages > Build and deployment > Source** to
**GitHub Actions**. The workflow can also be started manually.

Grammars can contain JavaScript actions and initializers. The playground runs
generated parsers in a worker with a timeout, but that worker is not a security
sandbox; only run grammars you trust.
