# Third-party components

Htpo's own code is copyright (c) 2026 Ugur Yildirim and MIT licensed. Website: https://8bit.tr. Contact: info@8bit.tr. There are no runtime npm dependencies. Embedded font licenses remain in effect.

## Embedded fonts

**DejaVu Sans 2.37**, regular and bold: Bitstream Vera license and DejaVu public-domain changes. Full license: [assets/fonts/LICENSE.txt](assets/fonts/LICENSE.txt). Project: https://dejavu-fonts.github.io/.

Both font binaries are embedded in the built library. The standalone `dist/htpo.min.js` build includes the Htpo and DejaVu font license texts in its leading comment. Keep that comment when redistributing the file.

## Development tooling

Development and test dependencies are listed in `devDependencies` in `package.json` and resolved in `package-lock.json`. They are not bundled into the SDK's runtime code. The standalone build fails if a `node_modules` package is included in its runtime bundle.

PDF serialization, TrueType subsetting, basic SVG geometry and static HTML cleaning are implemented in Htpo's own source code under the project's MIT license. Parsing, compression and image decoding use browser APIs.
