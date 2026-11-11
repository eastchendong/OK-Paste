"""Small real Office files for local adapter integration checks."""
from pathlib import Path
from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from pptx import Presentation
from pptx.util import Inches
import sys

root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
doc=Document()
doc.styles['Normal'].font.name='PingFang SC'
doc.styles['Normal'].font.size=Pt(11)
doc.add_paragraph('妥帖用户研究',style='Title')
p=doc.add_paragraph()
p.add_run('目标用户希望复制来源后，').bold=True
p.add_run('在目标应用里得到合适的操作建议。')
doc.add_paragraph('下一步需要结合目标上下文验证复制与执行流程。')
doc.save(root/'research.docx')

book=Workbook();sheet=book.active;sheet.title='研究计划'
sheet.append(['任务','计划人次','已完成人次','完成率'])
sheet.append(['原型访谈',8,2,None]);sheet.append(['交互测试',6,3,None]);sheet.append(['场景验证',4,1,None])
for c in sheet[1]:
    c.font=Font(name='PingFang SC',bold=True,color='FFFFFF')
    c.fill=PatternFill('solid',fgColor='113B66')
for column in ['A','B','C','D']:sheet.column_dimensions[column].width=22
sheet.freeze_panes='A2'
sheet.sheet_view.selection[0].activeCell='D2';sheet.sheet_view.selection[0].sqref='D2'
book.save(root/'research.xlsx')

slides=Presentation();slides.slide_width=Inches(13.333);slides.slide_height=Inches(7.5)
page=slides.slides.add_slide(slides.slide_layouts[1]);page.shapes.title.text='妥帖交互原型'
page.placeholders[1].text='来源内容与目标上下文共同决定可执行的操作。\n保留现有内容，先预览再应用。'
for shape in page.shapes:
    if shape.has_text_frame:
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs:run.font.name='PingFang SC'
slides.save(root/'research.pptx')
print(root)
