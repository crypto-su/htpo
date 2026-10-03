# Htpo static HTML sanitization

Static HTML sanitization is implemented in `src/sanitize.ts`. This internal module is intended only for Htpo's PDF layout document, which is constrained by a sandbox and Content Security Policy (CSP). It is not exposed through the public API and is not a general-purpose sanitizer for inserting untrusted HTML into an application's main DOM.

## Processing pipeline

1. The browser's `DOMParser` parses HTML into a document without executing scripts. Only allowed nodes and attributes are recreated in a separate inert document. Input nodes are not adopted directly.
2. Separate tag and attribute allowlists apply to HTML and SVG. Namespace transitions are checked; XML/xlink attributes are preserved only in recognized namespaces. Event handlers, `srcdoc`, `autofocus`, `is`, form actions, `ping` and `srcset` are removed. `id`/`name` values that conflict with document/prototype members are removed.
3. Script, iframe, object/embed, base/meta, media, template/shadow root, noscript and MathML subtrees are removed. Printable descendants of unknown HTML containers and form elements are preserved in source order. SVG `foreignObject` and SMIL animation elements are removed. SVG `style`, geometry, text, local `use`, gradients, clipping/masks and filter elements are preserved; the separate SVG rendering layer determines how they appear in the PDF.
4. Links are limited to HTTP(S), mailto, tel and relative/fragment URLs. Images accept HTTP(S), blob and selected `data:image/...` types. Stylesheets may use HTTP(S), blob or `data:text/css`. SVG `use` and paint-server references are restricted to local `#id` values. HTML entities are decoded during parsing; protocol checks account for whitespace/control-character obfuscation.
5. CSS, images and fonts are prepared through the `Resources` layer, which applies `resolveResource`, CORS, cancellation, timeouts and the error/warning policy. SVG `image` and `feImage` resources are embedded as well. CSS is retained as an application stylesheet; resource embedding is not a complete CSS security parser.
6. The iframe initially loads only a fixed HTML shell and trusted CSP. The sanitized DOM with embedded resources is inserted using `importNode`. Input HTML and CSS text are never concatenated into `srcdoc`. For example, `</style><script>...` in an external stylesheet cannot become new nodes through a second HTML parse.

## Combined isolation boundaries

The iframe sandbox includes `allow-same-origin allow-modals`. It does not permit scripts, forms, pop-ups or top-level navigation. Same-origin access allows layout measurements; modal permission supports `print()`.

CSP: `default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'`. CSS network references missed by the resource resolver are blocked inside the iframe by this policy. Legitimate CSS/image/font URLs in the HTML are loaded through the resource layer; sanitization does not define a server access policy for those resources.

Raster previews use an SVG Image context. Input SVG `foreignObject` elements are removed; Htpo creates its own `foreignObject` from the sanitized document when generating a preview. The code, CSP and sandbox must be considered together. Reusing sanitizer output as an HTML string in another context is outside this module's scope.

## Validation

`tests/browser/sanitize.spec.ts` covers structure/text order, CSS/SVG attributes, URL protocol obfuscation, active elements, events, custom element upgrades, DOM clobbering, malformed namespace/markup inputs, closing tags inside external/custom CSS, the resource resolver, CSP and deeply nested containers. Tests also exercise vector PDF and raster preview paths.

`tests/dependencies.test.ts` prevents runtime, optional or peer dependencies from being added to the manifest or lockfile. The standalone build fails if it bundles a `node_modules` module. Standalone tests verify that distribution files work without additional libraries or a host-provided sanitizer global.

Tests run in Chrome. Passing them is not an independent security audit, a guarantee for every browser/payload or a general-purpose sanitizer compatibility certification. MathML, SVG `foreignObject`, SMIL and interactive application behavior are outside the supported scope.

Behavior references: [WHATWG DOMParser and DOM sanitization](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html), [SVG secure image processing modes](https://www.w3.org/TR/SVG/conform.html#secure-static-mode). No third-party sanitizer source code is included.
