"""Fallback PNG renderer when Poppler is unavailable; requires pypdfium2."""
from pathlib import Path
import argparse
import pypdfium2 as pdfium

parser = argparse.ArgumentParser()
parser.add_argument('--pdf', required=True)
parser.add_argument('--cover', required=True)
parser.add_argument('--previews', required=True)
args = parser.parse_args()
doc = pdfium.PdfDocument(args.pdf)
previews = Path(args.previews)
previews.mkdir(parents=True, exist_ok=True)
for index in range(len(doc)):
    page = doc[index]
    image = page.render(scale=110 / 72).to_pil()
    image.save(previews / f'page-{index + 1}.png')
    if index == 0:
        page.render(scale=140 / 72).to_pil().save(args.cover)
    page.close()
doc.close()
