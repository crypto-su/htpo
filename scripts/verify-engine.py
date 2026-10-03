"""Independent PDF reader checks. Run after the browser tests; requires pymupdf."""
from pathlib import Path
import pymupdf as fitz

folder = Path('test-results/pdf-engine')
pdf = fitz.open(folder / 'vector.pdf')
assert not pdf.is_repaired and len(pdf) == 2
assert pdf.metadata['producer'] == 'Htpo PDF 0.1.0'
assert pdf.metadata['title'] == 'ŞĞİ 😀 (test)'
assert pdf.metadata['author'] == 'Yazar'
assert 'Türkçe ŞĞİı çğıöşü · 911₺ 😀' in pdf[0].get_text()
assert 'Kalın İĞŞ' in pdf[0].get_text()
assert 'İkinci sayfa' in pdf[1].get_text()
assert abs(pdf[0].rect.width - 120 * 72 / 25.4) < .001
assert abs(pdf[0].rect.height - 100 * 72 / 25.4) < .001
assert len(pdf[0].get_links()) == 1
assert pdf[0].get_links()[0]['uri'] == 'https://example.com/a(b)?q=%C5%9F'
assert len(pdf[0].get_drawings()) >= 6
assert len(pdf[0].get_image_info()) == 6  # Four HTML images and two explicit SVG fallbacks.
fonts = {font[0] for page in pdf for font in page.get_fonts()}
for xref in fonts:
    assert pdf.extract_font(xref)[3], 'Every referenced font must actually be embedded.'

pix = pdf[0].get_pixmap(matrix=fitz.Matrix(4 / 3, 4 / 3))
def near(point, expected, tolerance=3):
    actual = pix.pixel(*point)
    assert all(abs(a - b) <= tolerance for a, b in zip(actual, expected)), (point, actual, expected)

near((25, 80), (128, 0, 127))  # PNG alpha over a blue vector rectangle.
near((55, 80), (0, 0, 255))
near((90, 80), (0, 128, 0))    # Original DCT JPEG.
near((145, 80), (255, 127, 127))  # PNG delivered with image/jpeg MIME.
near((210, 80), (0, 128, 0))   # WebP decoded by the browser.
near((30, 155), (0, 128, 0))   # Translated SVG rect.
near((70, 160), (0, 0, 255))
near((100, 160), (255, 0, 0))
near((145, 160), (255, 255, 255))  # Clipped at the SVG viewport.
assert pix.pixel(185, 155)[2] > 220 and pix.pixel(185, 155)[0] < 10 and pix.pixel(275, 155)[1] > 220 and pix.pixel(275, 155)[2] < 40, 'Gradient fallback must retain local paint references.'
near((30, 240), (255, 127, 127))
near((60, 240), (255, 127, 127))  # Group opacity must composite the overlap once.

second = fitz.open(folder / 'repeated.pdf')
for a, b in zip(pdf, second):
    assert a.get_text() == b.get_text()
    assert a.get_pixmap().samples == b.get_pixmap().samples

for kind in ('png', 'jpeg'):
    raster = fitz.open(folder / f'raster-{kind}.pdf')
    assert not raster.is_repaired and len(raster) == 1
    assert 'Başlık İŞ' in raster[0].get_text() and 'Sayfa 1/1' in raster[0].get_text()
    assert 'Görüntü' not in raster[0].get_text()
    assert len(raster[0].get_images()) == 1
    actual = raster[0].get_pixmap().pixel(70, 70)
    assert all(abs(a - b) <= 3 for a, b in zip(actual, (0, 128, 0)))
assert not fitz.TOOLS.mupdf_warnings(), 'PDF reader reported a structural or font error.'
print('PASS: independent reader; Unicode and emoji; embedded subsets; alpha, JPEG, WebP; SVG paths, clipping, gradient and group opacity; links; repeated export; PNG/JPEG raster and furniture.')
