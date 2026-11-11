"""Saved Office file context and atomic edits for the Tuotie preview adapter.

This bridge edits only the file passed by the local host. It does not read an
unsaved editor window or execute model-authored Python.
"""
import copy
import json
import re
import sys
from pathlib import Path


def load(filename):
    suffix = Path(filename).suffix.lower()
    if suffix == '.docx':
        from docx import Document
        return suffix, Document(filename)
    if suffix == '.xlsx':
        from openpyxl import load_workbook
        return suffix, load_workbook(filename)
    if suffix == '.pptx':
        from pptx import Presentation
        return suffix, Presentation(filename)
    raise ValueError('请选择 docx、pptx 或 xlsx 文件')


def inspect(suffix, doc, selection=None):
    selection = selection or {}
    start = max(0, int(selection.get('start', 0)))
    limit = min(120, max(1, int(selection.get('count', 50))))
    if suffix == '.docx':
        section = doc.sections[0]
        return {'kind': 'document', 'paragraphCount': len(doc.paragraphs),
                'paragraphs': [{'index': i, 'text': p.text[:2400], 'style': p.style.name} for i, p in enumerate(doc.paragraphs) if start <= i < start + limit],
                'tables': [{'index': i, 'rows': [[c.text[:600] for c in row.cells] for row in table.rows[:12]]} for i, table in enumerate(doc.tables[:8])],
                'styles': [s.name for s in doc.styles if s.type == 1][:60],
                'imageCount': len(doc.inline_shapes),
                'page': {'widthCm': section.page_width.cm, 'heightCm': section.page_height.cm, 'contentWidthCm': (section.page_width-section.left_margin-section.right_margin)/360000},
                'truncated': start + limit < len(doc.paragraphs)}
    if suffix == '.xlsx':
        from openpyxl.utils.cell import range_boundaries
        sheet = doc[selection['sheet']] if selection.get('sheet') else doc.active
        area = selection.get('range')
        if area:
            left, top, right, bottom = range_boundaries(area)
            if (right-left+1)*(bottom-top+1) > 5000:
                raise ValueError('一次读取不超过 5000 个单元格，请缩小区域')
        else:
            left, top, right, bottom = 1, 1, min(sheet.max_column, 12), min(sheet.max_row, 24)
        cells = []
        styles = {}
        def color_value(color):
            if color is None:return None
            if color.type == 'rgb':return color.rgb
            if color.type == 'theme':return {'theme':color.theme,'tint':color.tint}
            return {'indexed':color.indexed} if color.type == 'indexed' else None
        for row in sheet.iter_rows(min_row=top, max_row=bottom, min_col=left, max_col=right):
            for cell in row:
                if cell.value is not None:
                    value = cell.value if isinstance(cell.value, (str, int, float, bool)) else str(cell.value)
                    cells.append({'cell': cell.coordinate, 'value': value, 'numberFormat': cell.number_format, 'styleId':cell.style_id})
                    styles[cell.style_id]={'bold':bool(cell.font.bold),'fontColor':color_value(cell.font.color),'fill':color_value(cell.fill.fgColor) if cell.fill.patternType == 'solid' else None}
        return {'kind': 'spreadsheet', 'sheets': [{'name': s.title, 'rows': s.max_row, 'columns': s.max_column, 'charts': len(s._charts)} for s in doc],
                'activeSheet': sheet.title, 'savedSelection': sheet.sheet_view.selection[0].activeCell if sheet.sheet_view.selection else None,
                'cells': cells, 'styles':styles, 'mergedRanges': [str(r) for r in sheet.merged_cells.ranges][:30],
                'readRange': f'{sheet.cell(top,left).coordinate}:{sheet.cell(bottom,right).coordinate}',
                'truncated': not area and (sheet.max_row > bottom or sheet.max_column > right),
                'formulaNote': '公式是真实单元格公式；预览读取不计算公式，打开表格应用后重算'}
    slides = []
    indices = [int(selection['slide'])] if 'slide' in selection else range(start, min(len(doc.slides), start + min(limit, 20)))
    for index in indices:
        page = doc.slides[index]
        shapes = []
        for shape in page.shapes:
            fact = {'id': shape.shape_id, 'name': shape.name, 'type': str(shape.shape_type),
                    'leftCm': shape.left.cm, 'topCm': shape.top.cm, 'widthCm': shape.width.cm, 'heightCm': shape.height.cm}
            if shape.has_text_frame:
                fact['text'] = shape.text[:2400]
            shapes.append(fact)
        slides.append({'index': index, 'shapes': shapes})
    return {'kind': 'presentation', 'slideCount': len(doc.slides), 'slides': slides,
            'widthCm': doc.slide_width.cm, 'heightCm': doc.slide_height.cm,
            'layouts': [{'index': i, 'name': layout.name} for i, layout in enumerate(doc.slide_layouts)],
            'truncated': len(slides) < len(doc.slides)}


def all_paragraphs(doc):
    yield from doc.paragraphs
    def tables(items):
        for table in items:
            for row in table.rows:
                for cell in row.cells:
                    yield from cell.paragraphs
                    yield from tables(cell.tables)
    yield from tables(doc.tables)


def replace_in_paragraph(paragraph, old, new):
    """Replace across run boundaries while keeping the surrounding formatting."""
    if not old:
        raise ValueError('查找文字不能为空')
    matches = list(re.finditer(re.escape(old), paragraph.text))
    for match in reversed(matches):
        start, end = match.span()
        offset = 0
        touched = []
        for run in paragraph.runs:
            next_offset = offset + len(run.text)
            if next_offset > start and offset < end:
                touched.append((run, offset))
            offset = next_offset
        if not touched:
            raise ValueError('该段落包含当前适配器无法修改的文本节点')
        first, first_offset = touched[0]
        last, last_offset = touched[-1]
        prefix = first.text[:start-first_offset]
        suffix = last.text[end-last_offset:]
        if first is last:
            first.text = prefix + new + suffix
        else:
            first.text = prefix + new
            last.text = suffix
            for run, _ in touched[1:-1]:run.text = ''
    return len(matches)


def place_after(doc, element, after):
    if after is None:
        return
    paragraphs = [p for p in doc.paragraphs if p._p is not element]
    if int(after) == -1:
        if paragraphs:
            paragraphs[0]._p.addprevious(element)
        return
    paragraphs[int(after)]._p.addnext(element)


def set_slide_text(frame, text, normalize_list=False):
    from pptx.enum.text import MSO_AUTO_SIZE
    from pptx.oxml.xmlchemy import OxmlElement
    first = frame.paragraphs[0]
    ppr = copy.deepcopy(first._p.pPr)
    rpr = copy.deepcopy(first.runs[0]._r.rPr) if first.runs else None
    frame.clear()
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    lines = text.split('\n')
    if normalize_list:
        lines = [line for line in lines if line.strip()]
    for i, line in enumerate(lines):
        paragraph = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        if ppr is not None:
            if paragraph._p.pPr is not None:
                paragraph._p.remove(paragraph._p.pPr)
            paragraph._p.insert(0, copy.deepcopy(ppr))
        marker = re.match(r'^\s*(?:[•●▪·]|[-*]\s)\s*', line) if normalize_list else None
        if marker:
            # Use one native bullet instead of a literal marker plus the layout bullet.
            line = line[marker.end():]
            properties = paragraph._p.get_or_add_pPr()
            for tag in ('a:buNone', 'a:buChar', 'a:buAutoNum'):
                for child in list(properties.findall(tag, properties.nsmap)):
                    properties.remove(child)
            bullet = OxmlElement('a:buChar')
            bullet.set('char', '•')
            properties.append(bullet)
        run = paragraph.add_run()
        run.text = line
        if rpr is not None:
            run._r.insert(0, copy.deepcopy(rpr))


def edit(suffix, doc, op):
    name = op['type']
    if suffix == '.docx':
        from docx.shared import Cm
        if name == 'insert_paragraph':
            p = doc.add_paragraph(op['text'])
            after = op.get('after')
            if op.get('style'):
                p.style = op['style']
            elif after is not None and after >= 0:
                p.style = doc.paragraphs[after].style
            place_after(doc, p._p, after)
        elif name == 'replace_text':
            paragraphs = [doc.paragraphs[op['paragraph']]] if 'paragraph' in op else list(all_paragraphs(doc))
            count = sum(replace_in_paragraph(p, op['find'], op['replace']) for p in paragraphs)
            if count == 0:
                raise ValueError('目标中没有找到要替换的文字，请读取后再修改')
        elif name == 'insert_image':
            p = doc.add_paragraph()
            content_width = (doc.sections[0].page_width-doc.sections[0].left_margin-doc.sections[0].right_margin)/360000
            width = op.get('widthCm', min(8, content_width))
            if width <= 0 or width > content_width + 0.01:
                raise ValueError('图片宽度超出文档正文区域')
            p.add_run().add_picture(op['imagePath'], width=Cm(width))
            place_after(doc, p._p, op.get('after'))
        elif name == 'insert_table':
            rows = op['rows']
            if not rows or not rows[0]:
                raise ValueError('表格不能为空')
            table = doc.add_table(rows=len(rows), cols=max(len(row) for row in rows))
            table.style = doc.tables[0].style if len(doc.tables) > 1 else 'Table Grid'
            for i, row in enumerate(rows):
                for j, value in enumerate(row):
                    table.cell(i,j).text = str(value)
            place_after(doc, table._tbl, op.get('after'))
        else:
            raise ValueError('这个操作不适用于文档')
    elif suffix == '.xlsx':
        from openpyxl.utils.cell import coordinate_to_tuple, range_boundaries
        from openpyxl.styles import PatternFill
        from openpyxl.chart import BarChart, LineChart, Reference
        if name == 'add_sheet':
            if op['name'] in doc.sheetnames:
                raise ValueError('工作表已存在')
            doc.create_sheet(op['name'])
            return
        sheet = doc[op['sheet']]
        if name == 'write_cells':
            row, col = coordinate_to_tuple(op['startCell'])
            for r, values in enumerate(op['values']):
                for c, value in enumerate(values):
                    sheet.cell(row+r, col+c).value = value
        elif name == 'format_cells':
            left, top, right, bottom = range_boundaries(op['range'])
            if (right-left+1)*(bottom-top+1) > 10000:
                raise ValueError('一次格式调整不超过 10000 个单元格')
            for row in sheet.iter_rows(min_row=top, max_row=bottom, min_col=left, max_col=right):
                for cell in row:
                    if 'numberFormat' in op: cell.number_format = op['numberFormat']
                    if 'bold' in op or 'fontColor' in op:
                        font = copy.copy(cell.font)
                        if 'bold' in op: font.bold = op['bold']
                        if 'fontColor' in op: font.color = op['fontColor'].lstrip('#')
                        cell.font = font
                    if 'fill' in op: cell.fill = PatternFill('solid', fgColor=op['fill'].lstrip('#'))
        elif name == 'add_chart':
            left, top, right, bottom = range_boundaries(op['range'])
            if right <= left or bottom <= top:
                raise ValueError('图表区域需包括首行标题、首列分类及至少一列数据')
            chart = LineChart() if op['kind'] == 'line' else BarChart()
            chart.title = op['title']
            chart.add_data(Reference(sheet, min_col=left+1, max_col=right, min_row=top, max_row=bottom), titles_from_data=True)
            chart.set_categories(Reference(sheet, min_col=left, min_row=top+1, max_row=bottom))
            sheet.add_chart(chart, op.get('anchor', 'H2'))
        else:
            raise ValueError('这个操作不适用于表格')
        from openpyxl.workbook.properties import CalcProperties
        doc.calculation = CalcProperties(fullCalcOnLoad=True, forceFullCalc=True)
    else:
        from pptx.util import Cm
        if name == 'add_slide':
            slide = doc.slides.add_slide(doc.slide_layouts[op.get('layoutIndex', 1)])
            if slide.shapes.title:
                set_slide_text(slide.shapes.title.text_frame, op['title'])
            else:
                title = slide.shapes.add_textbox(Cm(1.2), Cm(0.6), doc.slide_width-Cm(2.4), Cm(1.5))
                set_slide_text(title.text_frame, op['title'])
            body = next((s for s in slide.placeholders if s != slide.shapes.title and s.has_text_frame), None)
            if body is None:
                body = slide.shapes.add_textbox(Cm(1.2), Cm(2.5), doc.slide_width-Cm(2.4), doc.slide_height-Cm(3.5))
            set_slide_text(body.text_frame, op['body'], normalize_list=True)
            return
        slide = doc.slides[op['slide']]
        if name in ('set_shape_text', 'remove_shape', 'set_shape_geometry'):
            shape = next(s for s in slide.shapes if s.shape_id == op['shapeId'])
            if name == 'remove_shape': shape._element.getparent().remove(shape._element)
            elif name == 'set_shape_text': set_slide_text(shape.text_frame, op['text'])
            else:
                for field, attr in [('leftCm','left'),('topCm','top'),('widthCm','width'),('heightCm','height')]:
                    if field in op:setattr(shape,attr,Cm(op[field]))
                if shape.left+shape.width > doc.slide_width+1000 or shape.top+shape.height > doc.slide_height+1000:
                    raise ValueError('形状超出幻灯片，请按实际页面尺寸调整')
        elif name == 'insert_image':
            left, top, width = op['leftCm'], op['topCm'], op['widthCm']
            if min(left,top) < 0 or width <= 0:
                raise ValueError('图片位置或尺寸无效')
            picture = slide.shapes.add_picture(op['imagePath'], Cm(left), Cm(top), width=Cm(width), height=Cm(op['heightCm']) if op.get('heightCm') else None)
            if picture.left+picture.width > doc.slide_width+1000 or picture.top+picture.height > doc.slide_height+1000:
                raise ValueError('图片超出幻灯片，请按真实页面尺寸调整')
        else:
            raise ValueError('这个操作不适用于幻灯片')


def main():
    request = json.load(sys.stdin)
    suffix, doc = load(request['path'])
    if request['action'] == 'edit':
        for operation in request['operations']:
            edit(suffix, doc, operation)
        doc.save(request['path'])
        # Inspect a reopened file, so returned facts prove what was saved.
        suffix, doc = load(request['path'])
    return inspect(suffix, doc, request.get('selection'))


if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, 'context': main()}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error) or type(error).__name__}, ensure_ascii=False))
        sys.exit(1)
