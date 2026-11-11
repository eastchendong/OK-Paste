"""Inspect a complete live PPTX snapshot and prepare image-only previews.

Unchanged ZIP entries stay byte-for-byte identical. Model input never supplies
Python, filesystem paths, slide XML, or new arbitrary target coordinates.
"""
import base64
import copy
import hashlib
import io
import json
import math
import posixpath
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'rel': 'http://schemas.openxmlformats.org/package/2006/relationships'}
for prefix in ('p', 'a', 'r'):
    ET.register_namespace(prefix, NS[prefix])


def relationships(archive, part):
    relpath = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')
    if relpath not in archive.namelist():
        return relpath, ET.Element('Relationships', xmlns=NS['rel']), {}
    tree = ET.fromstring(archive.read(relpath))
    links = {r.attrib['Id']: (posixpath.normpath(posixpath.join(posixpath.dirname(part), r.attrib['Target'])).lstrip('/'), r.attrib.get('Type', ''))
             for r in tree if r.attrib.get('TargetMode') != 'External'}
    return relpath, tree, links


def texts(element):
    return '\n'.join(node.text or '' for node in element.findall('.//a:t', NS))


def open_deck(archive):
    presentation = ET.fromstring(archive.read('ppt/presentation.xml'))
    _, _, links = relationships(archive, 'ppt/presentation.xml')
    pages = [links[slide.attrib['{' + NS['r'] + '}id']][0] for slide in presentation.findall('p:sldIdLst/p:sldId', NS)]
    return presentation, pages


def shape_id(element):
    node = element.find('.//p:cNvPr', NS)
    return node.attrib.get('id') if node is not None else None


def inspect(archive):
    presentation, pages = open_deck(archive)
    size = presentation.find('p:sldSz', NS)
    slides = []
    for index, part in enumerate(pages):
        tree = ET.fromstring(archive.read(part))
        _, _, links = relationships(archive, part)
        shapes = []
        for element in tree.find('p:cSld/p:spTree', NS):
            sid = shape_id(element)
            if not sid or sid == '0':
                continue
            fact = {'id': sid, 'text': texts(element), 'type': element.tag.split('}')[-1]}
            images = []
            for blip in element.findall('.//a:blip', NS):
                resource = links.get(blip.attrib.get('{' + NS['r'] + '}embed', ''))
                if resource:
                    images.append({'sha256': hashlib.sha256(archive.read(resource[0])).hexdigest()})
            if images:
                fact['images'] = images
            shapes.append(fact)
        notes = '\n'.join(texts(ET.fromstring(archive.read(target))) for target, kind in links.values() if kind.endswith('/notesSlide'))
        charts = [{'cachedLabelsAndValues': [node.text or '' for node in ET.fromstring(archive.read(target)).iter() if node.tag.split('}')[-1] in ('t', 'v')]}
                  for target, kind in links.values() if kind.endswith('/chart')]
        slides.append({'index': index, 'shapes': shapes, 'notes': notes, 'charts': charts})
    return {'slideCount': len(pages), 'slides': slides, 'width': int(size.attrib['cx']) / 12700, 'height': int(size.attrib['cy']) / 12700,
            'scope': '全部幻灯片的文字（含组合内文字和表格）、备注、图表标签及图片资源标识；嵌入文件、音视频和母版内部内容不做语义解析'}


def png(data, width, height, fit='cover', crop=None, geometry='rect'):
    from PIL import Image, ImageDraw, ImageOps
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert('RGBA')
    if crop is not None:
        w, h = image.size
        left, top, right, bottom = [int(crop.get(key, '0')) / 100000 for key in ('l', 't', 'r', 'b')]
        image = image.crop((round(w * left), round(h * top), round(w * (1-right)), round(h * (1-bottom))))
    scale = min(2, 1600 / max(width, height))
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    if fit == 'cover':
        image = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)
    else:
        if geometry == 'ellipse':
            # Fit all four image corners inside the ellipse, not only its box.
            factor = 1 / math.hypot(image.width / size[0], image.height / size[1])
            resized = image.resize((max(1, int(image.width * factor)), max(1, int(image.height * factor))), Image.Resampling.LANCZOS)
        else:
            resized = ImageOps.contain(image, size, method=Image.Resampling.LANCZOS)
        image = Image.new('RGBA', size)
        image.alpha_composite(resized, ((size[0]-resized.width)//2, (size[1]-resized.height)//2))
    if geometry == 'ellipse':
        mask = Image.new('L', size); ImageDraw.Draw(mask).ellipse((0, 0, size[0]-1, size[1]-1), fill=255)
        from PIL import ImageChops
        image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    output = io.BytesIO(); image.save(output, format='PNG'); return output.getvalue()


def prepare(archive, request):
    _, pages = open_deck(archive)
    part = pages[request['slideIndex']]
    tree = ET.fromstring(archive.read(part)); shape_tree = tree.find('p:cSld/p:spTree', NS)
    relpath, reltree, links = relationships(archive, part)
    updates = {}; images = []; originals = []
    for change in request.get('texts', []):
        element = next((shape for shape in shape_tree if shape_id(shape) == change['shapeId']), None)
        if element is None or element.tag.split('}')[-1] != 'sp':
            raise ValueError('文字修改只支持直接选中的普通文字框')
        if tree.find(f'.//p:timing//p:spTgt[@spid="{change["shapeId"]}"]', NS) is not None:
            raise ValueError('文字对象带有动画，当前版本不自动编辑')
        paragraphs = element.findall('p:txBody/a:p', NS)
        if len(paragraphs) != 1 or element.find('.//a:hlinkClick', NS) is not None or element.find('.//a:fld', NS) is not None:
            raise ValueError('首版仅支持无链接、无字段的单段文字；多段和复杂富文本请在 PowerPoint 中编辑')
        paragraph = paragraphs[0]
        runs = paragraph.findall('a:r', NS)
        def style_key(run):
            properties = copy.deepcopy(run.find('a:rPr', NS))
            if properties is None:
                return b''
            for attribute in ('lang', 'altLang', 'dirty', 'err', 'smtClean'):
                properties.attrib.pop(attribute, None)
            return ET.tostring(properties)
        styles = {style_key(run) for run in runs}
        if not runs or len(styles) != 1 or paragraph.find('a:br', NS) is not None:
            raise ValueError('文字框存在混合字样或换行，当前版本不自动改写以免丢失格式')
        if any('\u2e80' <= c <= '\u9fff' for c in texts(element) + change['text']):
            east_asian_font = runs[0].find('a:rPr/a:ea', NS)
            default_east_asian = paragraph.find('a:pPr/a:defRPr/a:ea', NS)
            if east_asian_font is None and default_east_asian is None:
                raise ValueError('文字框尚未固定中文字体；请先在 PowerPoint 中设置中文字体，再使用文字修改，避免宿主切换默认字体')
        if any(token in change['text'] for token in ('\r', '\n')):
            raise ValueError('当前文字修改不能增加段落')
        runs[0].find('a:t', NS).text = change['text']
        for run in runs[1:]:
            paragraph.remove(run)
    next_id = max(int(node.attrib['id']) for node in tree.findall('.//p:cNvPr', NS)) + 1
    for index, replacement in enumerate(request.get('replacements', [])):
        sid = replacement['shapeId']
        element = next((shape for shape in shape_tree if shape_id(shape) == sid), None)
        if element is None:
            raise ValueError('无法映射选中对象，或对象位于组合内部；请直接选择普通图片或空白头像框')
        if tree.find(f'.//p:timing//p:spTgt[@spid="{sid}"]', NS) is not None:
            raise ValueError('选中对象带有动画，当前版本不会自动替换以免丢失动画')
        kind = element.tag.split('}')[-1]
        if kind not in ('pic', 'sp') or (kind == 'sp' and texts(element).strip()):
            raise ValueError('只允许替换图片或没有文字的空白形状')
        props = element.find('p:spPr', NS)
        if kind == 'sp' and props.find('a:blipFill', NS) is not None:
            raise ValueError('图片填充形状不属于空位，请选择普通图片或无图片填充的空白形状')
        if element.find('.//a:hlinkClick', NS) is not None:
            raise ValueError('图片带有链接，当前版本不自动替换以免丢失跳转')
        geometry_node = props.find('a:prstGeom', NS)
        geometry = geometry_node.attrib.get('prst', 'rect') if geometry_node is not None else 'rect'
        if geometry not in ('rect', 'ellipse') or props.find('a:custGeom', NS) is not None:
            raise ValueError('当前图片形状需要普通矩形或椭圆；复杂遮罩请先在 PowerPoint 中处理')
        if kind == 'pic' and replacement.get('geometry') in ('rect', 'ellipse'):
            geometry = replacement['geometry']
        xfrm = props.find('a:xfrm', NS)
        if xfrm is None or xfrm.attrib.get('flipH') in ('1', 'true') or xfrm.attrib.get('flipV') in ('1', 'true'):
            raise ValueError('当前对象变换不受支持，请先取消翻转或选择普通图片')
        if kind == 'pic' and (len(props.find('a:effectLst', NS) or []) or props.find('a:ln', NS) is not None):
            raise ValueError('图片带有独立描边或效果，当前版本不自动替换以免破坏样式')
        point = xfrm.find('a:off', NS); size = xfrm.find('a:ext', NS)
        name = element.find('.//p:cNvPr', NS).attrib.get('name', '图片')
        placement = {'shapeId': sid, 'name': name, 'left': int(point.attrib['x'])/12700, 'top': int(point.attrib['y'])/12700,
                     'width': int(size.attrib['cx'])/12700, 'height': int(size.attrib['cy'])/12700, 'rotation': int(xfrm.attrib.get('rot', '0'))/60000,
                     'retainOriginal': kind == 'sp', 'geometry': geometry}
        data = png(Path(replacement['imagePath']).read_bytes(), placement['width'], placement['height'], replacement.get('fit', 'cover'), geometry=geometry)
        images.append({**placement, 'base64': base64.b64encode(data).decode()})
        if kind == 'pic':
            blip = element.find('p:blipFill/a:blip', NS)
            if any(child.tag.split('}')[-1] != 'extLst' for child in blip):
                raise ValueError('图片含有颜色或透明度效果，当前版本不自动替换以免破坏样式')
            source = links.get(blip.attrib.get('{' + NS['r'] + '}embed', ''))
            if not source:
                raise ValueError('链接图片未嵌入文稿，暂不自动替换')
            crop = element.find('p:blipFill/a:srcRect', NS)
            original = png(archive.read(source[0]), placement['width'], placement['height'], crop=crop.attrib if crop is not None else None, geometry=geometry)
            originals.append({**placement, 'base64': base64.b64encode(original).decode()})
        rid = 'tuotieImage' + str(index)
        while rid in links:
            rid += '_'
        resource = 'ppt/media/tuotie-' + hashlib.sha256(data).hexdigest() + '.png'
        updates[resource] = data
        ET.SubElement(reltree, '{' + NS['rel'] + '}Relationship', {'Id': rid, 'Type': NS['r'] + '/image', 'Target': '../media/' + posixpath.basename(resource)})
        picture = ET.Element('{' + NS['p'] + '}pic')
        nv = ET.SubElement(picture, '{' + NS['p'] + '}nvPicPr')
        ET.SubElement(nv, '{' + NS['p'] + '}cNvPr', {'id': str(next_id) if kind == 'sp' else sid, 'name': name})
        next_id += 1
        ET.SubElement(nv, '{' + NS['p'] + '}cNvPicPr'); ET.SubElement(nv, '{' + NS['p'] + '}nvPr')
        fill = ET.SubElement(picture, '{' + NS['p'] + '}blipFill')
        ET.SubElement(fill, '{' + NS['a'] + '}blip', {'{' + NS['r'] + '}embed': rid})
        ET.SubElement(ET.SubElement(fill, '{' + NS['a'] + '}stretch'), '{' + NS['a'] + '}fillRect')
        picture_props = ET.SubElement(picture, '{' + NS['p'] + '}spPr'); picture_props.append(copy.deepcopy(xfrm))
        ET.SubElement(ET.SubElement(picture_props, '{' + NS['a'] + '}prstGeom', {'prst': 'rect'}), '{' + NS['a'] + '}avLst')
        position = list(shape_tree).index(element)
        if kind == 'pic':
            shape_tree.remove(element); shape_tree.insert(position, picture)
        else:
            shape_tree.insert(position + 1, picture)
    updates[part] = ET.tostring(tree, encoding='utf-8', xml_declaration=True)
    updates[relpath] = ET.tostring(reltree, encoding='utf-8', xml_declaration=True)
    content = ET.fromstring(archive.read('[Content_Types].xml'))
    if not any(node.attrib.get('Extension') == 'png' for node in content):
        ET.SubElement(content, '{http://schemas.openxmlformats.org/package/2006/content-types}Default', {'Extension': 'png', 'ContentType': 'image/png'})
        updates['[Content_Types].xml'] = ET.tostring(content, encoding='utf-8', xml_declaration=True)
    with zipfile.ZipFile(request['previewPath'], 'w', zipfile.ZIP_DEFLATED) as output:
        for info in archive.infolist():
            output.writestr(info, updates.pop(info.filename, archive.read(info.filename)))
        for filename, data in updates.items():
            output.writestr(filename, data)
    return {'images': images, 'originals': originals}


def main():
    request = json.load(sys.stdin)
    with zipfile.ZipFile(request['path']) as archive:
        return inspect(archive) if request['action'] == 'read' else prepare(archive, request)


if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, 'result': main()}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error) or type(error).__name__}, ensure_ascii=False))
        sys.exit(1)
