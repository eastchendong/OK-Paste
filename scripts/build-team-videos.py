"""Package verified recordings and an explicitly labelled development update.

Needs Pillow + ffmpeg/ffprobe. No browser automation, new screen recording,
model calls, or access to personal app state. Source recordings stay local.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
W, H = 1920, 1080
NAVY, MUTED, BG, LINE = '#19314D', '#63758A', '#F3F6FA', '#DDE5EF'
parser = argparse.ArgumentParser()
parser.add_argument('--recordings', type=Path, required=True)
args = parser.parse_args()
source = args.recordings / '妥帖-Blender-完整演示-精简.mp4'
work = ROOT / '.local/team-video-build'
output = ROOT / 'docs/progress/2026-10-28'
work.mkdir(parents=True, exist_ok=True)
output.mkdir(parents=True, exist_ok=True)


def run(cmd):
    subprocess.run(cmd, check=True)


def font(size):
    return ImageFont.truetype(FONT, size)


def text(draw, xy, message, size=34, color=NAVY):
    draw.text(xy, message, font=font(size), fill=color)


def base(title, subtitle, footer='妥帖 / OK Paste · 2026.10.28'):
    image = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(image)
    text(draw, (80, 44), title, 42)
    text(draw, (80, 106), subtitle, 26, MUTED)
    draw.line((80, 164, 1840, 164), fill=LINE, width=2)
    text(draw, (80, 1008), footer, 25, MUTED)
    return image


def save(image, name):
    file = work / f'{name}.png'
    image.save(file)
    return file


def slide(title, description, rows, name, label='开发更新说明 · 不是跨应用操作录像'):
    image = base(title, description, label)
    draw = ImageDraw.Draw(image)
    y = 280
    for heading, detail in rows:
        text(draw, (120, y), heading, 46)
        text(draw, (120, y + 70), detail, 32, MUTED)
        y += 200
    return save(image, name)


def encode_still(image, seconds, file):
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', '15', '-i', str(image), '-t', str(seconds), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '15', '-movflags', '+faststart', str(file)])


def concat(files, destination):
    listing = work / f'{destination.stem}.txt'
    listing.write_text(''.join(f"file '{p.as_posix()}'\n" for p in files))
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-c', 'copy', '-movflags', '+faststart', str(destination)])


def recording_segment(start, end, heading, subheading, name):
    frame = base(heading, subheading, '真实屏幕录像 · 仅裁切、遮挡通知及移除等待，原速播放 · 界面早于 0.3')
    frame_path = save(frame, f'{name}-frame')
    destination = work / f'{name}.mp4'
    # Remove browser tabs/system menubar. Hide the unrelated assistant overlay
    # at bottom-right; the left Tuotie package and Blender result stay visible.
    filters = '[0:v]drawbox=x=752:y=850:w=760:h=132:color=0xE9EEF4:t=fill,crop=1512:860:0:122,scale=1410:802:flags=lanczos[screen];[1:v][screen]overlay=255:184:shortest=1,setsar=1[v]'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(start), '-i', str(source), '-loop', '1', '-framerate', '15', '-i', str(frame_path), '-t', str(end-start), '-filter_complex', filters, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '15', '-movflags', '+faststart', str(destination)])
    return destination


intro = slide('从参考图片，到真实 Blender 修改', '已验证的端到端流程 · 真实 Agent Plan + Blender MCP', [
    ('复制参考，结合场景提出方向', '图片以缩略图进入内容包，点击一条推荐发起任务。'),
    ('独立预览，确认后才应用', '取消保留正式场景；应用后可以撤回。'),
    ('这段录像早于 0.3 界面', '包归档、双入口和新版状态反馈请看第三段更新说明。'),
], 'full-intro', '真实流程回放 · 未生成或替换操作画面')
end = slide('预览、应用、撤回已真实走通', '同一任务的场景指纹检查确认：撤回后精确恢复原状态。', [
    ('仅原速剪去等待片段', '原始录像 149 秒；本段操作画面 65 秒。'),
    ('当前 0.3 已进一步迭代', '原生 Magic Copy、目标标记、整包上下文、成功后归档。'),
], 'full-end', '开发者操作验证 · 不是新增用户验收')
full_intro, full_end = work/'full-intro.mp4', work/'full-end.mp4'
encode_still(intro, 3, full_intro)
encode_still(end, 3, full_end)
segments = [
    recording_segment(0,20,'01 复制参考与选择推荐','网页图片 → 内容包缩略图 → 结合目标场景提出操作方向','copy'),
    recording_segment(20,32,'02 执行所选方向','模型通过真实 Blender 工具生成独立预览','working'),
    recording_segment(32,45,'03 查看独立预览','苹果移到篮外桌面；正式场景仍保持独立','preview'),
    recording_segment(45,54,'04 确认应用','点击应用，把已检查的预览提交到正式场景','apply'),
    recording_segment(54,65,'05 撤回与检查','苹果回到篮内；结构化检查确认场景恢复','undo'),
]
concat([full_intro,*segments,full_end],output/'01-blender-full-flow.mp4')
short_intro = slide('只看关键结果：预览 → 应用 → 撤回','真实录像节选 · 界面早于 0.3',[
    ('预览先独立，提交由用户决定','同一个苹果移到篮外，再撤回到原场景。'),
], 'short-intro', '真实结果节选 · 没有合成场景或加速操作')
short_intro_file=work/'short-intro.mp4'
encode_still(short_intro,2,short_intro_file)
concat([short_intro_file,*segments[2:],full_end],output/'02-preview-apply-undo.mp4')

cards=[]
card=base('妥帖 / OK Paste','0.3 开发进展 · 参考内容 + 目标上下文 → 可确认的动作','开发更新说明 · 不代表所有功能已完成原生端到端验收')
draw=ImageDraw.Draw(card)
text(draw,(120,300),'先理解参考，也理解要修改哪里。',64)
text(draw,(120,430),'保持轻量浮窗，先预览，再确认。',46,MUTED)
text(draw,(120,680),'代码已推送 dev · 功能提交 25edf61',34)
cards.append(save(card,'update-1'))
card=base('两个入口，各做一件事','Magic Copy 与 Start from here','实际 AppKit 组件渲染 · 新版原生完整点击流程仍待验收')
toolbar=Image.open(ROOT/'docs/evidence/selection-toolbar-2026-10-28.png').convert('RGBA')
toolbar=toolbar.resize((1168,160),Image.Resampling.LANCZOS)
card.paste(toolbar,(376,285),toolbar)
draw=ImageDraw.Draw(card)
text(draw,(160,540),'Magic Copy',44);text(draw,(160,615),'复制选中的参考，加入内容包。',34,MUTED)
text(draw,(990,540),'Start from here',44);text(draw,(990,615),'先标记修改位置，再去找参考。',34,MUTED)
text(draw,(160,820),'没有复制内容，也能先标记可读取的空白编辑位置。',36)
cards.append(save(card,'update-2'))
cards.append(slide('参考给谁用，要说清楚','推荐基于整个活动内容包与真实目标上下文',[
    ('默认跟随当前聚焦应用','切到 ChatGPT 时隐藏后台 Blender 的旧建议。'),
    ('明确标记后，参考服务于那个位置','切出去找素材时保留修改目标；可以主动取消。'),
    ('内容包或上下文变化，刷新推荐','迟到的旧计划不能覆盖新建议；空包不推荐。'),
], 'update-3'))
cards.append(slide('任务完成后，内容包归档','工作阶段和来源生命周期已经接通',[
    ('成功应用或复制生成结果后，归档整包','保留本机历史；撤回不会把旧素材塞回活动包。'),
    ('取消、失败保留来源','复制失败也保留预览，可以直接重试。'),
    ('工作中新复制的素材，留给下一次任务','空包保持收起，不用一堆旧内容占位置。'),
], 'update-4'))
cards.append(slide('接入更多目标，边界保持真实','已有实现与已验证范围分开说明',[
    ('Blender + 已保存的 DOCX / XLSX / PPTX','Blender 有真实操作录像；Office 文件事务已有集成检查。'),
    ('剪映 MCP：独立复刻草稿','使用真实转场／特效资源；原生效果播放仍待验收。'),
    ('普通应用：准备待粘贴文字','不会自动发送消息，也不宣称已写入在线文档。'),
], 'update-5'))
cards.append(slide('下一步验证什么','当前功能提交：25edf61 · dev',[
    ('67 项逻辑测试 + 16 项组件检查通过','TypeScript、前端与 Swift 构建通过。'),
    ('补齐双入口原生完整点击与剪映效果播放','完成前不把组件渲染或草稿结构测试称为实机验收。'),
    ('继续缩短反馈和修正流程','保持当前极简 UI，以真实任务结果推进。'),
], 'update-6'))
parts=[]
for index,card in enumerate(cards):
    clip=work/f'update-{index+1}.mp4';encode_still(card,5,clip);parts.append(clip)
concat(parts,output/'03-v0.3-progress.mp4')

manifest={'date':'2026-10-28','featureCommit':'25edf61','recordedSource':{'name':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'previousEvidence':'../../evidence/desktop-full-flow-2026-10-28.json'},'editing':{'newScreenRecording':False,'speed':'original','sourceCrop':[0,122,1512,860],'notificationMask':[752,850,760,132],'notice':'The first two videos show verified footage from before the 0.3 UI; the third is a labelled update using actual component art, not a claimed native end-to-end recording.'},'videos':[]}
for file in sorted(output.glob('*.mp4')):
    data=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,width,height,r_frame_rate','-of','json',str(file)]))
    manifest['videos'].append({'name':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),**data})
(output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{'file':v['name'],'duration':v['format']['duration'],'bytes':v['format']['size']} for v in manifest['videos']],ensure_ascii=False))
