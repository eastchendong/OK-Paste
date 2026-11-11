// Small Office.js feasibility probe. No model calls, file writes or bridge yet.
const title = '妥帖 Word 接口测试';
const original = '【待替换】这里是发展背景的测试文字。';
const replacement = '【已替换】妥帖已通过 Word 接口更新这一段文字。';
const output = document.querySelector('#output');
const buttons = [...document.querySelectorAll('button[data-action]')];

async function inspect(context) {
  const body = context.document.body;
  const selection = context.document.getSelection();
  body.load('text');
  body.paragraphs.load('items/text,items/style');
  selection.load('text');
  await context.sync();
  // Every operation is restricted to the synthetic probe document.
  if (!body.text.startsWith(title)) throw new Error('请先打开指定测试文档，保留首行“妥帖 Word 接口测试”。');
  return {
    bodyText: body.text,
    paragraphs: body.paragraphs.items.map((item, index) => ({index, text: item.text, style: item.style})),
    selectedText: selection.text,
  };
}

const actions = {
  read: inspect,
  async locate(context) {
    await inspect(context);
    const matches = context.document.body.search(original, {matchCase: true, matchWholeWord: false});
    matches.load('items');
    await context.sync();
    if (matches.items.length !== 1) throw new Error('测试文字必须恰好出现一次；请检查文稿或先撤销上次修改。');
    matches.items[0].select();
    await context.sync();
    return inspect(context);
  },
  async replace(context) {
    const before = await inspect(context);
    if (before.selectedText !== original) throw new Error('当前选区不是测试文字，请先点击“定位测试段落”。');
    context.document.getSelection().insertText(replacement, 'Replace');
    await context.sync();
    const after = await inspect(context);
    const expected = before.bodyText.replace(original, replacement);
    if (after.bodyText !== expected) throw new Error('写入后正文与预期不一致，请检查 Word 中的结果，不要重复执行。');
    return {...after, verified: true};
  },
};

for (const button of buttons) button.addEventListener('click', async () => {
  buttons.forEach(item => { item.disabled = true; });
  try {
    const result = await Word.run(context => actions[button.dataset.action](context));
    output.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    buttons.forEach(item => { item.disabled = false; });
  }
});

Office.onReady(info => {
  const supported = info.host === Office.HostType.Word && Office.context.requirements.isSetSupported('WordApi', '1.1');
  output.textContent = supported ? 'WordApi 1.1 已就绪。请在指定测试文稿中依次读取、定位、替换。' : '当前宿主尚未提供 WordApi 1.1，不能执行测试。';
  buttons.forEach(button => { button.disabled = !supported; });
});
