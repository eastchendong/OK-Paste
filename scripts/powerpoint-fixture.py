"""Synthetic presentation for live image-replacement verification; no user content."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt
from pptx.oxml.xmlchemy import OxmlElement

root = Path(sys.argv[1]); root.mkdir(parents=True, exist_ok=True)
for name, color, label in [('original', '#183c70', '01'), ('old', '#ed954d', 'OLD'), ('source-a', '#20836d', 'A'), ('source-b', '#a54f87', 'B')]:
    image = Image.new('RGB', (400, 320), color)
    ImageDraw.Draw(image).text((150, 140), label, fill='white', stroke_width=2)
    image.save(root / (name + '.png'))

deck = Presentation(); deck.slide_width = Inches(12); deck.slide_height = Inches(6.75)
slide = deck.slides.add_slide(deck.slide_layouts[6])
title = slide.shapes.add_textbox(Inches(.6), Inches(.35), Inches(10), Inches(.7))
title.text = '妥帖 · PowerPoint 图片替换测试'
original = slide.shapes.add_picture(str(root / 'original.png'), Inches(.8), Inches(1.8), width=Inches(2.5), height=Inches(2.5))
old = slide.shapes.add_picture(str(root / 'old.png'), Inches(4.5), Inches(1.8), width=Inches(2.5), height=Inches(2.5))
slot = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(8.2), Inches(1.8), Inches(2.5), Inches(2.5))
slot.fill.solid(); slot.fill.fore_color.rgb = RGBColor.from_string('E6EBEF')
for x, label in [(.8, '01 · 原头像保留'), (4.5, '02 · 替换成资料 A'), (8.2, '03 · 空位放入资料 B')]:
    caption = slide.shapes.add_textbox(Inches(x), Inches(4.6), Inches(3), Inches(.5)); caption.text = label
for index in range(1, 25):
    page = deck.slides.add_slide(deck.slide_layouts[1])
    page.shapes.title.text = f'第 {index + 1} 页 · 全文读取验证'
    page.placeholders[1].text = f'合成研究上下文第 {index + 1} 页。' + ('最终页标记：FULL-DECK-25' if index == 24 else '')
    if index == 24:
        page.notes_slide.notes_text_frame.text = '完整备注标记：NOTES-25'
for page in deck.slides:
    for shape in page.shapes:
        if shape.has_text_frame:
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    run.font.name = 'PingFang SC'; run.font.size = Pt(20)
                    properties = run._r.get_or_add_rPr()
                    east_asian = OxmlElement('a:ea'); east_asian.set('typeface', 'PingFang SC'); properties.append(east_asian)
filename = root / '妥帖-PowerPoint-测试.pptx'; deck.save(filename)
print(json.dumps({'file': str(filename), 'preservedShapeId': str(original.shape_id), 'imageShapeId': str(old.shape_id), 'slotShapeId': str(slot.shape_id)}, ensure_ascii=False))
