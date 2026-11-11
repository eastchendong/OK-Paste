import {expect,it,vi} from 'vitest';
import {InputLiveTarget} from '../src/targets/input-live';

function setup(role='keyboard-input',manual=false){
 const copy=vi.fn();
 const target=new InputLiveTarget({id:crypto.randomUUID(),manual,focus:{appName:'测试输入框',bundleId:'example.editor',role}},copy);
 const prepare=async(text:string)=>{target.begin();await target.invoke('prepare_text',{text});};
 const accept=async()=>{
  const commit=target.commit(),command=target.exchange(target.capture.id).command!;
  expect(command).toBeTruthy();target.exchange(target.capture.id,{id:command.id,ok:true});await commit;
 };
 return {target,copy,prepare,accept};
}

it.each([
 ['长邮件','项目资料。'.repeat(1500)+'完整末尾🙂'],
 ['多行邮件','你好：\n第一项。\n第二项。\n谢谢。'],
 ['CRLF邮件','你好\r\n请查收。'],
 ['制表符','事项\t进展'],
 ['Unicode换行','事项\u2028进展\u2029结尾'],
])('%s is copied intact before any keyboard write',async(_,text)=>{
 const {target,copy,prepare}=setup();await prepare(text);
 expect(target.previewText).toBe(text);expect(target.inputDelivery).toBe('direct');
 await expect(target.commit()).resolves.toMatchObject({summary:expect.stringContaining('⌘V')});
 expect(copy).toHaveBeenCalledExactlyOnceWith(text);
 expect(target.exchange(target.capture.id).command).toBeUndefined();
 expect(target.inputDelivery).toBe('clipboard');expect(target.revision).toBe(1);expect(target.canUndo).toBe(false);
 expect(await target.read()).toMatchObject({currentFragment:text,inputDelivery:'clipboard'});
 await target.dispose();
});

it('uses the native 1200-grapheme boundary, including complex emoji',async()=>{
 const {target,copy,prepare,accept}=setup();const text='👩🏽‍💻'.repeat(1200);
 await prepare(text);await accept();expect(copy).not.toHaveBeenCalled();expect(target.canUndo).toBe(true);
 await prepare(text+'🙂');await target.commit();expect(copy).toHaveBeenCalledExactlyOnceWith(text+'🙂');
 expect(target.inputDelivery).toBe('clipboard');expect(target.canUndo).toBe(false);
 await target.dispose();
});

it('keeps clipboard revisions off the native range after switching from a short direct draft',async()=>{
 const {target,copy,prepare,accept}=setup();await prepare('原生短稿');await accept();
 await prepare('长稿\n第二段');await target.commit();
 await prepare('再次缩短');await target.commit();
 expect(copy.mock.calls.map(([text])=>text)).toEqual(['长稿\n第二段','再次缩短']);
 expect(target.exchange(target.capture.id).command).toBeUndefined();
 expect(target.revision).toBe(3);expect(target.previewText).toBe('再次缩短');
 await expect(target.undo()).rejects.toThrow('不可撤销');await target.dispose();
});

it('preserves a complete draft for explicit recovery when clipboard writing fails',async()=>{
 const {target,copy,prepare}=setup();const text='完整邮件\n'+'内容'.repeat(2000);
 copy.mockImplementation(()=>{throw new Error('系统复制失败');});await prepare(text);
 await expect(target.commit()).rejects.toThrow('系统复制失败');target.cancel();
 expect(target.previewText).toBe(text);expect(target.revision).toBe(0);expect(target.inputDelivery).toBe('direct');
 expect(target.exchange(target.capture.id).command).toBeUndefined();expect(target.mutationUncertain).toBe(false);
 target.begin();expect(target.previewText).toBe('');await target.dispose();
});

it('keeps multiline AX editors on their native range and never recopies an uncertain delivery',async()=>{
 const {target,copy,prepare}=setup('AXTextArea');const text='较长正文。'.repeat(600)+'\n末段';
 await prepare(text);const commit=target.commit(),command=target.exchange(target.capture.id).command!;
 expect(command.text).toBe(text);
 const rejection=expect(commit).rejects.toThrow('无法回读');
 target.exchange(target.capture.id,{id:command.id,ok:false,error:'无法回读',mutationStarted:true});await rejection;
 expect(copy).not.toHaveBeenCalled();expect(target.mutationUncertain).toBe(true);expect(target.inputDelivery).toBe('direct');
 await target.dispose();
});
