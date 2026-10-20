# Third-party notices

Han-Noon AI uses the following components for local document reading and release
builds. Versions are pinned by `package-lock.json`; notices distributed with an
installed package remain applicable to that package and its bundled resources.

| Component | Use | License |
|---|---|---|
| [Mozilla PDF.js / pdfjs-dist](https://github.com/mozilla/pdf.js) | Browser PDF text extraction and PDF worker | Apache-2.0 |
| [fflate](https://github.com/101arrowz/fflate) | Bounded DOCX/HWPX decompression and extension ZIP creation | MIT |
| [esbuild](https://github.com/evanw/esbuild) | Browser and Worker bundle generation | MIT |
| [Wrangler](https://github.com/cloudflare/workers-sdk) | Cloudflare local development and deployment | MIT OR Apache-2.0 |
| [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm) | D1 schema declarations | Apache-2.0 |
| [Drizzle Kit](https://github.com/drizzle-team/drizzle-orm) | Database migration tooling | MIT |
| [xmldom](https://github.com/xmldom/xmldom) | XML parser used by document-reader tests | MIT |

The browser document-reader build writes the PDF.js and fflate license texts to
`web/vendor/LICENSES.txt` and copies them into the downloadable Chrome extension.
Generated `file-input.js.LEGAL.txt` notices accompany the document-reader bundle.
PDF CMaps and standard fonts retain their own notices, including
`web/vendor/standard_fonts/LICENSE_FOXIT` and
`web/vendor/standard_fonts/LICENSE_LIBERATION`. Preserve these notices when
redistributing the web assets or extension. These resources support document
reading; they do not contain an AI provider key.

The application, renderer, and diagram output do not imply endorsement by any
upstream project. The project's own license is in `LICENSE`.

## Diagram design reference

Han-Noon AI's original deterministic renderer is informed by the visual guidance in
Cathryn Lavery's diagram-design: thin strokes, restrained accent, generous whitespace,
content-specific grammar, and Unicode-aware Korean text width budgeting.

Source: https://github.com/cathrynlavery/diagram-design
No affiliation or endorsement is implied. Eight supported types are implemented in
Han-Noon AI; the reference repository's complete type library is not bundled.

The relevant reference license follows.

MIT License

Copyright (c) 2025 Cathryn Lavery

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
