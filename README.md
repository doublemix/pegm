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

The site is deployed by the GitHub Pages workflow on pushes to `main`.
In repository settings, set **Pages > Build and deployment > Source** to
**GitHub Actions**. The workflow can also be started manually.

Grammars can contain JavaScript actions and initializers. The playground runs
generated parsers in a worker with a timeout, but that worker is not a security
sandbox; only run grammars you trust.
