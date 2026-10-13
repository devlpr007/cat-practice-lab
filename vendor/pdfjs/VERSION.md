# PDF.js (vendored copy)

- Package: `pdfjs-dist` **6.3.289** (released 2026-08-29), Mozilla, Apache-2.0 licence (see `LICENSE`).
- Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz
- Copied files: `legacy/build/pdf.min.mjs`, `legacy/build/pdf.worker.min.mjs` (the "legacy" build works in older browsers too),
  and the folders `cmaps/`, `standard_fonts/`, `iccs/`, `wasm/` (without `quickjs-eval.*`, which is only for PDF form scripts).
- SHA-256 `pdf.min.mjs`: F401927E692EFC7735E0CD528C490D0DD31B7F0972C122B7040DF805BE45CCE4
- SHA-256 `pdf.worker.min.mjs`: A33CFE728C584FDBA4FCC1FD54BCDC2F9F2F13889DDBB5B2BD1D0F8CBE49B84E

The app loads these files from its own folder, never from the internet. Do not update casually:
after any update, run the full test suite (`npm test`), including the golden PDF tests.
