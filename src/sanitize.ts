/** Static report HTML only. This is internal to the CSP-protected layout frame,
 * not a general-purpose sanitizer for insertion into an application's live DOM.
 * Rebuild allowed nodes in an inert document; never adopt an input node.
 */
const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const names = (value: string) => new Set(value.split(/\s+/));

const htmlTags = names(`a abbr address article aside b bdi bdo blockquote br button
  caption center cite code col colgroup data datalist dd del details dfn div dl dt em
  fieldset figcaption figure font footer h1 h2 h3 h4 h5 h6 header hgroup hr i img input
  ins kbd label legend li main map mark menu meter nav ol optgroup option output p
  picture pre progress q rp rt ruby s samp section select small span strong style sub
  summary sup table tbody td textarea tfoot th thead time title tr u ul var wbr`);
// These subtrees are active, opaque, non-rendered, or have incompatible parsing rules.
const dropHtml = names(`applet audio base basefont bgsound embed frame frameset iframe
  math meta noembed noframes noscript object param plaintext portal script source
  template track video xmp`);
const svgTags = names(`svg a circle clipPath defs desc ellipse feBlend feColorMatrix
  feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap
  feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur
  feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting
  feSpotLight feTile feTurbulence filter g image line linearGradient marker mask
  metadata path pattern polygon polyline radialGradient rect stop style switch symbol text
  textPath title tspan use view`);
const commonAttrs = names('class dir hidden id lang role style title');
const htmlAttrs = names(`abbr align alt bgcolor border cellpadding cellspacing char
  charoff checked cite color cols colspan datetime disabled face for headers height
  high label list low max maxlength min minlength multiple open optimum pattern
  placeholder readonly reversed rows rowspan scope selected size span start step
  summary type valign value width wrap`);
const svgAttrs = names(`alignment-baseline amplitude azimuth baseFrequency baseline-shift
  bias clip clip-path clip-rule clipPathUnits color color-interpolation color-interpolation-filters
  cx cy d diffuseConstant direction display divisor dominant-baseline dx dy edgeMode
  elevation exponent fill fill-opacity fill-rule filter filterUnits flood-color flood-opacity
  font-family font-size font-stretch font-style font-variant font-weight fx fy fr gradientTransform
  gradientUnits height image-rendering in in2 intercept k1 k2 k3 k4 kernelMatrix kernelUnitLength
  lengthAdjust letter-spacing lighting-color limitingConeAngle marker-end marker-mid marker-start
  markerHeight markerUnits markerWidth mask maskContentUnits maskUnits mode numOctaves offset
  opacity operator order orient overflow pathLength patternContentUnits patternTransform patternUnits
  points pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits r radius
  refX refY result rotate rx ry scale seed shape-rendering slope spacing specularConstant
  specularExponent spreadMethod startOffset stdDeviation stitchTiles stop-color stop-opacity
  stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit
  stroke-opacity stroke-width surfaceScale targetX targetY text-anchor text-decoration
  text-rendering textLength transform type unicode-bidi vector-effect version viewBox
  visibility width word-spacing writing-mode x x1 x2 y y1 y2 z`);

type UrlKind = 'link' | 'image' | 'stylesheet';
function safeUrl(value: string, kind: UrlKind): boolean {
  // Entities have already been decoded by the HTML parser. Match browser URL
  // handling of whitespace/control characters, including obfuscated schemes.
  const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (!compact) return false;
  let protocol: string;
  try { protocol = new URL(compact, 'https://htpo.invalid/').protocol; } catch { return false; }
  if (protocol === 'http:' || protocol === 'https:') return true;
  if (kind === 'link') return protocol === 'mailto:' || protocol === 'tel:';
  if (protocol === 'blob:') return true;
  if (protocol !== 'data:') return false;
  return kind === 'stylesheet' ? /^data:text\/css[;,]/i.test(compact)
    : /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|bmp|avif|apng|x-icon|vnd\.microsoft\.icon)[;,]/i.test(compact);
}

function copyAttributes(source: Element, target: Element, doc: Document) {
  const svg = target.namespaceURI === SVG, tag = target.localName;
  for (const attr of source.attributes) {
    const { name, value, namespaceURI } = attr;
    if (namespaceURI === XMLNS) {
      if ((name === 'xmlns' && value === target.namespaceURI) || (name === 'xmlns:xlink' && value === XLINK)) target.setAttributeNS(XMLNS, name, value);
      continue;
    }
    if (namespaceURI === XML) {
      if (attr.localName === 'lang' || attr.localName === 'space') target.setAttributeNS(XML, name, value);
      continue;
    }
    if (namespaceURI && !(svg && namespaceURI === XLINK && attr.localName === 'href')) continue;
    if (/^on/i.test(name)) continue;
    if (name === 'id' || name === 'name') {
      // Preserve selectors and fragment IDs without document/prototype clobbering.
      if (value && !(value in doc) && !(value in Object.prototype) && value !== 'prototype' && value !== 'htpo-print') target.setAttribute(name, value);
      continue;
    }
    if (name === 'href' || (namespaceURI === XLINK && attr.localName === 'href')) {
      const kind = tag === 'a' ? 'link' : !svg && tag === 'link' ? 'stylesheet' : svg && (tag === 'image' || tag === 'feImage') ? 'image' : undefined;
      // SVG instances/paint servers may only refer to nodes within this document.
      const allowed = kind ? safeUrl(value, kind) : svg && /^#[^\s]+$/.test(value);
      if (allowed) {
        if (namespaceURI === XLINK) target.setAttributeNS(XLINK, 'xlink:href', value);
        else target.setAttribute('href', value);
      }
      continue;
    }
    if (name === 'src') {
      if (!svg && tag === 'img' && safeUrl(value, 'image')) target.setAttribute(name, value);
      continue;
    }
    if (!svg && tag === 'link' && (name === 'rel' || name === 'media' || name === 'type')) {
      target.setAttribute(name, value); continue;
    }
    if (name === 'media' && tag === 'style') { target.setAttribute(name, value); continue; }
    if (name === 'target' && tag === 'a') {
      if (value === '_blank' || value === '_self') target.setAttribute(name, value);
      continue;
    }
    if (commonAttrs.has(name) || /^data-[a-z0-9_.-]+$/.test(name) || /^aria-[a-z-]+$/.test(name)
      || (svg ? svgAttrs : htmlAttrs).has(name)) target.setAttribute(name, value);
  }
  if (tag === 'a' && target.getAttribute('target') === '_blank') target.setAttribute('rel', 'noopener noreferrer');
}

export function sanitizeDocument(html: string): Document {
  // DOMParser creates a document with scripting disabled and no browsing context.
  const source = new DOMParser().parseFromString(html, 'text/html');
  const clean = document.implementation.createHTMLDocument('');
  clean.head.replaceChildren();
  copyAttributes(source.documentElement, clean.documentElement, clean);
  copyAttributes(source.head, clean.head, clean);
  copyAttributes(source.body, clean.body, clean);
  const unwrap: Element[] = [];
  const pending: { source: Node; target: Node }[] = [
    { source: source.head, target: clean.head }, { source: source.body, target: clean.body },
  ];
  while (pending.length) {
    const { source: parent, target } = pending.pop()!;
    // Iterate without JS recursion so deeply nested input cannot exhaust the stack.
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) { target.appendChild(clean.createTextNode(node.textContent ?? '')); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element, tag = el.localName, ns = el.namespaceURI;
      if (ns !== HTML && ns !== SVG) continue;
      if (ns === SVG && (!svgTags.has(tag) || ((target as Element).namespaceURI !== SVG && tag !== 'svg'))) continue;
      if (ns === HTML && (dropHtml.has(tag) || (target as Element).namespaceURI === SVG)) continue;
      if (ns === HTML && tag === 'link' && (el.getAttribute('rel')?.toLowerCase() !== 'stylesheet' || !safeUrl(el.getAttribute('href') ?? '', 'stylesheet'))) continue;
      if (ns === HTML && !htmlTags.has(tag) && tag !== 'link') {
        // Unknown HTML containers (including forms) keep printable descendants.
        // Use a temporary container to preserve their position among siblings.
        const fragment = clean.createElement('span');
        target.appendChild(fragment); pending.push({ source: el, target: fragment });
        // These placeholders are removed after all descendants have been copied.
        unwrap.push(fragment);
        continue;
      }
      const copy = clean.createElementNS(ns, tag);
      copyAttributes(el, copy, clean);
      target.appendChild(copy);
      if (tag === 'style' || tag === 'title' || tag === 'textarea' || (ns === SVG && tag === 'desc')) copy.textContent = el.textContent;
      else pending.push({ source: el, target: copy });
    }
  }
  for (const el of unwrap) {
    while (el.firstChild) el.before(el.firstChild);
    el.remove();
  }
  return clean;
}
