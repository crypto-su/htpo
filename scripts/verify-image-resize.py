"""Independent PDF checks after npm run test:e2e.
Requires PyMuPDF and Pillow; generates no PDFs and makes no network requests.
"""
from pathlib import Path
import json
import base64
import pymupdf as fitz
from PIL import Image, ImageChops, ImageStat


def bitmap(page, dpi=96):
    pix = page.get_pixmap(dpi=dpi)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


def mae(a, b):
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3 / 255


def links(page):
    return [(link['uri'], tuple(link['from'])) for link in page.get_links()]


folder = Path('test-results/image-resize')
original = fitz.open(folder / 'default.pdf')
resized = fitz.open(folder / 'on.pdf')
assert not resized.is_repaired and len(original) == len(resized) == 2
for name in ('off', 'off-again', 'disabled-quality'):
    other = fitz.open(folder / f'{name}.pdf')
    for a, b in zip(original, other):
        assert a.get_text() == b.get_text() and bitmap(a).tobytes() == bitmap(b).tobytes()
        assert links(a) == links(b)
assert (folder / 'on.pdf').stat().st_size < (folder / 'default.pdf').stat().st_size / 3
for a, b in zip(original, resized):
    assert a.get_text() == b.get_text() and links(a) == links(b)
    assert len(a.get_drawings()) == len(b.get_drawings())
    assert mae(bitmap(a), bitmap(b)) < .015

first, second = [page.get_image_info(xrefs=True) for page in resized]
assert [(i['width'], i['height']) for i in first] == [(100, 60), (80, 80), (100, 67), (60, 30), (60, 30), (20, 10), (80, 80), (80, 80)]
assert [(i['width'], i['height']) for i in second] == [(80, 80), (200, 100), (100, 60)]
assert first[1]['xref'] == second[0]['xref'] and first[0]['xref'] == second[2]['xref']
assert second[1]['xref'] != second[0]['xref']  # Larger use must not reuse a smaller bitmap.
assert first[1]['xref'] != first[7]['xref']  # Different object-position means different pixels.
assert resized.xref_get_key(first[3]['xref'], 'SMask')[0] == 'xref'
image = bitmap(resized[0])
for point, color in [((20, 170), (128, 0, 127)), ((50, 170), (0, 0, 255)), ((100, 170), (255, 127, 127)), ((190, 170), (0, 128, 0)), ((245, 260), (0, 128, 0))]:
    assert all(abs(a - b) <= 3 for a, b in zip(image.getpixel(point), color)), (point, image.getpixel(point))
# An orientation-tagged JPEG must retain its existing PDF orientation after canvas decoding.
region = (10, 230, 90, 310)
assert mae(bitmap(original[0]).crop(region), image.crop(region)) < .015
references = json.loads((folder / 'expected-lossless.json').read_text())
for reference in references:
    dpi = reference['dpi']
    lossless = fitz.open(folder / f'lossless-{dpi}.pdf')
    info = lossless[0].get_image_info(xrefs=True)
    photo = info[0]
    assert (photo['width'], photo['height']) == (reference['width'], reference['height'])
    assert lossless.xref_get_key(photo['xref'], 'Filter') == ('name', '/FlateDecode')
    assert fitz.Pixmap(lossless, photo['xref']).samples == base64.b64decode(reference['rgb']), 'Lossless encoding changed resized RGB pixels.'
    expected_sizes = [(100, 60), (80, 80), (100, 67), (60, 30), (60, 30), (20, 10), (80, 80), (80, 80)] if dpi == 96 else [(200, 120), (160, 160), (200, 134), (120, 60), (120, 60), (20, 10), (160, 160), (160, 160)]
    assert [(i['width'], i['height']) for i in info] == expected_sizes
    assert info[1]['xref'] == lossless[1].get_image_info(xrefs=True)[0]['xref']
    for a, b in zip(original, lossless):
        assert a.rect == b.rect and a.get_text() == b.get_text() and links(a) == links(b)
        assert len(a.get_drawings()) == len(b.get_drawings())
        assert mae(bitmap(a), bitmap(b)) < .015
    assert mae(bitmap(original[0]).crop(region), bitmap(lossless[0]).crop(region)) < .015
    for plain, kept in zip(resized[0].get_image_info(), info):
        assert plain['bbox'] == kept['bbox'], 'DPI must not change image placement.'
lossless = fitz.open(folder / 'lossless-192.pdf')
jpeg_high = fitz.open(folder / 'jpeg-192.pdf')
kept_high = fitz.open(folder / 'lossless-keep-png-192.pdf')
for i in (0, 1, 2, 6, 7):
    reference = lossless[0].get_image_info(hashes=True)[i]
    jpeg = jpeg_high[0].get_image_info(xrefs=True)[i]
    kept = kept_high[0].get_image_info(hashes=True)[i]
    assert jpeg_high.xref_get_key(jpeg['xref'], 'Filter') == ('name', '/DCTDecode')
    assert (jpeg['width'], jpeg['height']) == (reference['width'], reference['height'])
    assert kept['digest'] == reference['digest']
for i in (3, 4, 5):
    a, b = original[0].get_image_info(hashes=True)[i], kept_high[0].get_image_info(hashes=True)[i]
    assert (a['width'], a['height'], a['digest']) == (b['width'], b['height'], b['digest'])
for name, ignored in [('keep-png', {3, 4, 5}), ('keep-jpeg', {0, 1, 2, 6, 7})]:
    exempt = fitz.open(folder / f'{name}.pdf')
    for page_number, page in enumerate(exempt):
        assert page.get_text() == original[page_number].get_text() and links(page) == links(original[page_number])
        before = original[page_number].get_image_info(hashes=True)
        scaled = resized[page_number].get_image_info(hashes=True)
        images = page.get_image_info(hashes=True)
        assert len(images) == len(before)
        for index, actual in enumerate(images):
            skip = index in ignored if page_number == 0 else name == 'keep-jpeg'
            expected = before[index] if skip else scaled[index]
            for field in ('width', 'height', 'digest', 'bbox'):
                assert actual[field] == expected[field], (name, page_number, index, field)
raster = fitz.open(folder / 'raster.pdf')
assert [(i['width'], i['height']) for i in raster[0].get_image_info()] == [(200, 200)]
assert not fitz.TOOLS.mupdf_warnings()
print('PASS: opt-in/default equivalence, repeated export, image dimensions/crops, per-size reuse, lossless RGB pixel equality, independent DPI/codec control, alpha/mislabeled PNG, JPEG orientation, format exemptions, small originals, text/SVG/links and raster resolution.')
