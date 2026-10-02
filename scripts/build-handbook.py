"""Create the cooperation handbook from the exact public site's JSON payload.

Requires ReportLab, pypdf and Pillow. Supply a licensed, embeddable Chinese
TrueType font with --font / CHUANHENG_HANDBOOK_FONT on non-Windows systems.
The PDF contains embedded subsets; readers do not need these fonts installed.
"""
from pathlib import Path
from html import escape
import argparse
import io
import json
import os
import sys

from PIL import Image, ImageOps
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

PAPER = colors.HexColor('#F5F6F4')
SURFACE = colors.HexColor('#FCFDFC')
GREEN = colors.HexColor('#315447')
INK = colors.HexColor('#202923')
MUTED = colors.HexColor('#606B63')
LINE = colors.HexColor('#D6DED8')
SOFT = colors.HexColor('#E7EBE6')
ALPINE = colors.HexColor('#17241F')
ICE = colors.HexColor('#B3CBC0')
WHITE = colors.HexColor('#F2F5F3')
WIDTH, HEIGHT = A4
MARGIN = 42
CONTENT = WIDTH - MARGIN * 2


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--font', type=Path)
    return parser.parse_args()


def register_fonts(root, requested):
    candidates = [requested, os.environ.get('CHUANHENG_HANDBOOK_FONT'),
                  Path('C:/Windows/Fonts/HarmonyOS_Sans_SC_Regular.ttf'),
                  Path('C:/Windows/Fonts/simhei.ttf'), Path('C:/Windows/Fonts/simsun.ttc')]
    font_path = next((Path(path) for path in candidates if path and Path(path).is_file()), None)
    if not font_path:
        raise RuntimeError('未找到可嵌入的中文 TrueType 字体，请设置 CHUANHENG_HANDBOOK_FONT。')
    pdfmetrics.registerFont(TTFont('Han', str(font_path), validate=1))
    medium = font_path.with_name('HarmonyOS_Sans_SC_Medium.ttf')
    bold = font_path.with_name('HarmonyOS_Sans_SC_Bold.ttf')
    pdfmetrics.registerFont(TTFont('HanMedium', str(medium if medium.is_file() else font_path), validate=1))
    pdfmetrics.registerFont(TTFont('HanBold', str(bold if bold.is_file() else font_path), validate=1))
    editorial = Path('C:/Windows/Fonts/simsun.ttc')
    pdfmetrics.registerFont(TTFont('HanEditorial', str(editorial if editorial.is_file() else font_path), validate=1))
    pdfmetrics.registerFontFamily('Han', normal='Han', bold='HanMedium')
    latin = root / 'artifacts/runtime/fonts/_sources/dm-sans-decoded.ttf'
    if latin.is_file():
        pdfmetrics.registerFont(TTFont('Latin', str(latin), validate=1))
        latin_name = 'DM Sans Regular'
    else:
        latin_name = 'Helvetica'
        pdfmetrics.registerFontFamily('Latin', normal='Helvetica', bold='Helvetica-Bold')
    family = pdfmetrics.getFont('Han').face.familyName
    if isinstance(family, bytes):
        family = family.decode('utf-8', errors='replace')
    return {'chinese': str(family), 'headings': 'SimSun' if editorial.is_file() else str(family),
            'latin': latin_name, 'embeddedChinese': True}, latin.is_file()


class Handbook:
    def __init__(self, root, output, data, latin_embedded):
        self.root = root
        self.data = data
        self.settings = data['settings']
        self.coop = data['cooperation']
        self.projects = data['projects']
        self.book = self.coop['handbook']
        self.total = 5 + len(self.projects)
        self.latin = 'Latin' if latin_embedded else 'Helvetica'
        self.c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1, invariant=1)
        self.c.setTitle(self.book['title'])
        self.c.setAuthor(self.settings['clubName'])
        self.c.setSubject(self.book['subtitle'] + ' / ' + self.book['versionLabel'])
        self.page_number = 0

    def paragraph(self, text, x, top, width=CONTENT, size=11, leading=18,
                  color=INK, weight='Han', max_height=None):
        style = ParagraphStyle('text', fontName=weight, fontSize=size, leading=leading,
                               textColor=color, wordWrap='CJK', splitLongWords=True,
                               spaceAfter=0, spaceBefore=0, allowWidows=0, allowOrphans=0)
        markup = escape(str(text)).replace('\n', '<br/>')
        paragraph = Paragraph(markup, style)
        _, height = paragraph.wrap(width, HEIGHT)
        if max_height is not None and height > max_height:
            raise ValueError(f'第 {self.page_number} 页段落超出规划区域：{text[:38]} ({height:.1f}>{max_height})')
        if top - height < 75:
            raise ValueError(f'第 {self.page_number} 页正文进入页脚：{text[:38]}')
        paragraph.drawOn(self.c, x, top - height)
        return height

    def text(self, text, x, y, size=11, color=INK, font='Han'):
        self.c.setFillColor(color)
        self.c.setFont(font, size)
        self.c.drawString(x, y, str(text))

    def line(self, y, x=MARGIN, width=CONTENT, color=LINE):
        self.c.setStrokeColor(color)
        self.c.setLineWidth(.7)
        self.c.line(x, y, x + width, y)

    def mark(self, x, y, scale=.85, color=GREEN):
        self.c.saveState()
        self.c.translate(x, y)
        self.c.scale(scale, scale)
        self.c.setStrokeColor(color)
        self.c.setLineWidth(1.5)
        p = self.c.beginPath()
        p.moveTo(2, 9); p.lineTo(18, 36); p.lineTo(29, 18)
        p.lineTo(36, 31); p.lineTo(47, 9); p.close()
        self.c.drawPath(p)
        p = self.c.beginPath()
        p.moveTo(12, 26); p.lineTo(18, 21); p.lineTo(23, 25)
        p.moveTo(30, 18); p.lineTo(36, 14); p.lineTo(41, 18)
        p.moveTo(2, 3); p.lineTo(47, 3)
        self.c.drawPath(p)
        self.c.restoreState()

    def image(self, url, x, top, width, height, fallback='/images/alpine.webp'):
        source = self.root / 'public' / url.lstrip('/')
        if not source.is_file():
            source = self.root / 'public' / fallback.lstrip('/')
        with Image.open(source) as original:
            image = ImageOps.fit(original.convert('RGB'), (round(width * 2.5), round(height * 2.5)),
                                 method=Image.Resampling.LANCZOS, centering=(.5, .48))
            buffer = io.BytesIO()
            image.save(buffer, 'JPEG', quality=94)
        self.c.drawImage(ImageReader(buffer), x, top - height, width=width, height=height)

    def start(self, chapter, name, dark=False):
        self.page_number += 1
        self.dark = dark
        self.c.setFillColor(ALPINE if dark else PAPER)
        self.c.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
        muted = ICE if dark else MUTED
        self.text('CHUANHENG / PARTNERSHIP HANDBOOK', MARGIN, HEIGHT - 35, 8, muted, self.latin)
        self.c.setFont('Han', 8)
        self.c.setFillColor(muted)
        self.c.drawRightString(WIDTH - MARGIN, HEIGHT - 35, self.book['versionLabel'])
        self.line(HEIGHT - 48, color=colors.HexColor('#3E5449') if dark else LINE)
        self.text(f'{chapter} / {name}', MARGIN, HEIGHT - 79, 9, ICE if dark else GREEN, self.latin)

    def footer(self):
        color = ICE if self.dark else MUTED
        self.line(58, color=colors.HexColor('#3E5449') if self.dark else LINE)
        self.text(self.settings['clubName'] + ' · ' + self.settings['school'], MARGIN, 41, 7.5, color)
        self.text(self.book['versionLabel'] + ' · ' + self.coop['demoNotice'], MARGIN, 27, 6.8, color)
        self.c.setFont(self.latin, 8)
        self.c.setFillColor(color)
        self.c.drawRightString(WIDTH - MARGIN, 35, f'{self.page_number:02d} / {self.total:02d}')
        self.c.showPage()

    def badge(self, label, x, y, width=54, dark=False):
        self.c.setStrokeColor(ICE if dark else LINE)
        self.c.setLineWidth(.65)
        self.c.roundRect(x, y - 5, width, 19, 2, stroke=1, fill=0)
        self.text(label, x + 8, y, 8, ICE if dark else MUTED)

    def cover(self):
        self.start('00', 'A SHARED WAY UP')
        self.mark(MARGIN, HEIGHT - 143, scale=.9)
        self.text(self.settings['clubName'], MARGIN + 54, HEIGHT - 125, 10, GREEN, 'HanMedium')
        self.text(self.settings['school'], MARGIN + 54, HEIGHT - 142, 8, MUTED)
        self.paragraph('川衡登山队', MARGIN, HEIGHT - 182, size=28, leading=39, weight='HanEditorial')
        self.paragraph('合作手册', MARGIN - 2, HEIGHT - 226, size=48, leading=61, weight='HanEditorial', color=GREEN)
        self.paragraph(self.book['subtitle'], MARGIN, HEIGHT - 309, size=12, leading=21, color=MUTED)
        self.line(HEIGHT - 350)
        self.text(self.book['versionLabel'], MARGIN, HEIGHT - 377, 10, GREEN, 'HanMedium')
        self.text(self.book['updatedAt'], MARGIN + 68, HEIGHT - 377, 9, MUTED, self.latin)
        self.image(self.settings['heroTeam'], MARGIN, 419, CONTENT, 288)
        self.c.setFillColor(ALPINE)
        self.c.rect(MARGIN, 131, CONTENT, 38, stroke=0, fill=1)
        self.text('AI 生成示意影像', MARGIN + 14, 146, 8, WHITE)
        last_project = 2 + len(self.projects)
        self.text(f'资质 02 / 项目 03-{last_project:02d} / 权益 {last_project + 1:02d} / 流程 {last_project + 2:02d} / 联系 {last_project + 3:02d}', MARGIN, 99, 8.5, MUTED)
        self.footer()

    def qualifications(self):
        self.start('01', 'THE TEAM & QUALIFICATIONS')
        self.paragraph(self.coop['qualificationTitle'], MARGIN, HEIGHT - 110,
                       size=29, leading=39, weight='HanMedium')
        top = HEIGHT - 210
        height = self.paragraph(self.coop['qualificationDescription'], MARGIN, top,
                                size=11, leading=19, color=MUTED, max_height=66)
        top -= height + 29
        self.text('训练与准备方向', MARGIN, top, 10, GREEN, 'HanMedium')
        top -= 27
        for i, focus in enumerate(self.coop['trainingFocus']):
            x = MARGIN + i * (CONTENT / 4)
            self.c.setFillColor(SOFT)
            self.c.roundRect(x, top - 22, CONTENT / 4 - 8, 33, 2, fill=1, stroke=0)
            self.text(focus, x + 12, top - 10, 10, GREEN)
        top -= 54
        self.line(top)
        top -= 27
        for qualification in self.coop['qualifications']:
            self.text(qualification['name'], MARGIN, top, 18, INK, 'HanMedium')
            self.text(qualification['qualification'], MARGIN + 92, top + 1, 12, GREEN, 'HanMedium')
            if qualification['isDemo']:
                self.badge('示例资质', WIDTH - MARGIN - 65, top + 1, width=65)
            self.paragraph(qualification['description'], MARGIN + 92, top - 18,
                           width=CONTENT - 92, size=10, leading=17, color=MUTED, max_height=42)
            top -= 96
            self.line(top + 15)
        self.paragraph(self.coop['demoNotice'], MARGIN, top - 6, size=9, leading=16, color=MUTED)
        self.footer()

    def project(self, project, index):
        self.start(f'02.{index + 1:02d}', 'PROJECTS WORTH SUPPORTING')
        self.paragraph(project['title'], MARGIN, HEIGHT - 110,
                       size=27, leading=37, weight='HanMedium')
        if project['isDemo']:
            self.badge('示例项目', WIDTH - MARGIN - 65, HEIGHT - 109, width=65)
        self.paragraph(project['summary'], MARGIN, HEIGHT - 158,
                       width=CONTENT, size=11, leading=18, color=MUTED, max_height=40)
        self.image(project['image'], MARGIN, HEIGHT - 214, CONTENT, 146,
                   fallback='/images/hiking.webp' if 'annual' in project['id'] else '/images/alpine.webp')
        self.text('AI 生成示意影像 · 正式项目资料待发布', MARGIN, HEIGHT - 376, 7.8, MUTED)
        self.line(HEIGHT - 391)
        self.text('项目目标', MARGIN, HEIGHT - 413, 8.5, MUTED)
        self.text(project['mountain'] or '待确认', MARGIN + 60, HEIGHT - 413, 10, GREEN, 'HanMedium')
        top = HEIGHT - 439
        labels = [('攀登目标与计划', 'description'), ('训练与准备', 'trainingPlan'),
                  ('项目支持需求', 'supportNeeds'), ('合作与共同价值', 'cooperationValue')]
        for label, key in labels:
            self.text(label, MARGIN, top, 11.5, GREEN, 'HanMedium')
            top -= 16
            height = self.paragraph(project[key], MARGIN, top, size=10, leading=16,
                                    color=MUTED, max_height=57)
            top -= height + 24
        self.footer()

    def benefits(self):
        self.start('03', 'SUPPORT & SHARED VALUE')
        self.paragraph('支持的方式，\n与共同的价值。', MARGIN, HEIGHT - 110,
                       size=29, leading=39, weight='HanMedium')
        self.paragraph(self.coop['intro'], MARGIN, HEIGHT - 210, size=12, leading=20, color=MUTED)
        top = HEIGHT - 262
        gap = 18
        col_width = (CONTENT - gap * 2) / 3
        for index, way in enumerate(self.coop['supportWays']):
            x = MARGIN + index * (col_width + gap)
            self.line(top, x=x, width=col_width)
            self.text(f'{index + 1:02d}', x, top - 27, 9, MUTED, self.latin)
            self.paragraph(way['title'], x, top - 43, col_width, size=13, leading=21, weight='HanMedium')
            self.paragraph(way['description'], x, top - 78, col_width, size=10, leading=17, color=MUTED, max_height=86)
        top -= 188
        self.text('合作权益', MARGIN, top, 15, GREEN, 'HanMedium')
        top -= 25
        columns = [108, 233, CONTENT - 341]
        self.c.setFillColor(GREEN)
        self.c.rect(MARGIN, top - 34, CONTENT, 34, fill=1, stroke=0)
        for index, label in enumerate(['方向', '合作内容', '共同确认']):
            self.text(label, MARGIN + sum(columns[:index]) + 12, top - 22, 9.5, WHITE, 'HanMedium')
        top -= 34
        for index, benefit in enumerate(self.coop['benefits']):
            self.c.setFillColor(SURFACE if index % 2 == 0 else SOFT)
            self.c.rect(MARGIN, top - 47, CONTENT, 47, fill=1, stroke=0)
            for col, key in enumerate(['direction', 'content', 'confirmation']):
                x = MARGIN + sum(columns[:col]) + 12
                self.paragraph(benefit[key], x, top - 15, columns[col] - 24,
                               size=10, leading=17, color=GREEN if col == 0 else INK, max_height=34)
            top -= 47
        self.paragraph(self.coop['process'][2]['description'], MARGIN, top - 23,
                       size=9, leading=16, color=MUTED, max_height=40)
        self.footer()

    def process(self):
        self.start('04', 'FROM CONVERSATION TO ACTION')
        self.paragraph('合作，\n从清晰的沟通开始。', MARGIN, HEIGHT - 110,
                       size=29, leading=39, weight='HanMedium')
        top = HEIGHT - 245
        for index, step in enumerate(self.coop['process']):
            self.line(top)
            self.text(f'{index + 1:02d}', MARGIN, top - 49, 30, GREEN, self.latin)
            self.text(step['title'], MARGIN + 89, top - 37, 16, INK, 'HanMedium')
            self.paragraph(step['description'], MARGIN + 89, top - 57, width=CONTENT - 89,
                           size=11, leading=19, color=MUTED, max_height=59)
            top -= 120
        self.footer()

    def contact(self):
        self.start('05', 'LET\'S MAKE IT POSSIBLE', dark=True)
        self.paragraph(self.coop['title'], MARGIN, HEIGHT - 110, width=CONTENT - 15,
                       size=31, leading=45, weight='HanMedium', color=WHITE, max_height=96)
        self.paragraph(self.coop['intro'], MARGIN, HEIGHT - 235,
                       size=12, leading=21, color=ICE)
        contact = self.coop['contact']
        top = HEIGHT - 316
        rows = [('合作联系人', contact['name'] or '待公布'),
                ('联系邮箱', contact['email'] or '待公布'),
                ('联系微信', contact['wechat'] or '待公布')]
        for index, (label, value) in enumerate(rows):
            self.line(top, color=colors.HexColor('#3E5449'))
            self.text(label, MARGIN, top - 31, 10, ICE)
            self.text(value, MARGIN, top - 62, 19, WHITE, 'HanMedium')
            if index == 0 and contact['isDemo']:
                self.badge('示例联系人', MARGIN + 87, top - 61, width=82, dark=True)
            if index == 1 and contact['email']:
                self.c.linkURL('mailto:' + contact['email'], (MARGIN, top - 69, WIDTH - MARGIN, top - 42), relative=0)
            top -= 102
        self.paragraph(self.coop['demoNotice'], MARGIN, top - 17,
                       size=10, leading=18, color=ICE, max_height=44)
        self.text(self.book['title'], MARGIN, 133, 10, WHITE, 'HanMedium')
        self.text(self.book['versionLabel'] + ' / ' + self.book['updatedAt'], MARGIN, 112, 9, ICE)
        self.footer()

    def build(self):
        self.cover()
        self.qualifications()
        for index, project in enumerate(self.projects):
            self.project(project, index)
        self.benefits()
        self.process()
        self.contact()
        self.c.save()


def main():
    args = parse_args()
    data = json.load(sys.stdin)
    if not data.get('cooperation'):
        raise ValueError('缺少合作页共享内容。')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    typography, latin = register_fonts(args.root, args.font)
    document = Handbook(args.root, args.output, data, latin)
    document.build()
    reader = PdfReader(args.output)
    if len(reader.pages) != document.total:
        raise ValueError('生成后的 PDF 页数与全部公开项目不一致。')
    all_text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    compact_text = ''.join(all_text.split())
    required = [project['title'] for project in data['projects']]
    required.extend(item['name'] for item in data['cooperation']['qualifications'])
    required.extend(item['qualification'] for item in data['cooperation']['qualifications'])
    required.extend(item['direction'] for item in data['cooperation']['benefits'])
    required.extend(item['title'] for item in data['cooperation']['process'])
    required.append(data['cooperation']['qualificationDescription'])
    required.extend(data['cooperation']['trainingFocus'])
    required.extend(item['description'] for item in data['cooperation']['qualifications'])
    required.extend(item['title'] for item in data['cooperation']['supportWays'])
    required.extend(item['description'] for item in data['cooperation']['supportWays'])
    required.extend(item['content'] for item in data['cooperation']['benefits'])
    required.extend(item['confirmation'] for item in data['cooperation']['benefits'])
    required.extend(item['description'] for item in data['cooperation']['process'])
    for project in data['projects']:
        required.extend(project[key] for key in ['title', 'mountain', 'summary', 'description', 'trainingPlan', 'supportNeeds', 'cooperationValue'] if project[key])
    required.extend(['合作手册', '联系邮箱', '联系微信', data['cooperation']['demoNotice']])
    missing = [text for text in required if ''.join(text.split()) not in compact_text]
    if missing:
        raise ValueError(f'PDF 文本校验缺少条目：{missing}')
    if any(abs(float(page.mediabox.width) - WIDTH) > .1 or abs(float(page.mediabox.height) - HEIGHT) > .1 for page in reader.pages):
        raise ValueError('PDF 页面不是 A4 尺寸。')
    print(json.dumps({'pageCount': len(reader.pages), 'typography': typography}, ensure_ascii=False))


if __name__ == '__main__':
    main()
