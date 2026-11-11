import {ClipboardStore} from '../src/clipboard/store';

const directory = process.argv[2];
if (!directory) {
  console.error('缺少剪贴板目录');
  process.exit(2);
}
const store = new ClipboardStore(directory);
const items = store.list().map(item => ({
  type: item.type,
  url: item.source.url ?? '',
  title: item.source.title ?? '',
  text: typeof item.body.text === 'string' ? item.body.text : '',
  resourceUrl: typeof item.body.resourceUrl === 'string' ? item.body.resourceUrl : '',
  bytes: store.readContent(item.id)?.length ?? 0,
}));
console.log(JSON.stringify(items));
if (!items.some(item => item.type === 'text' && item.text.includes('把这段话选中'))) process.exit(3);
