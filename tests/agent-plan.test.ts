import {describe, expect, it} from 'vitest';
import {PlanSchema, parseAgentPlan} from '../src/agent-client';

describe('Agent Plan responses', () => {
 it('accepts a clarification with independent suggestions and no execution steps', () => {
  const plan=PlanSchema.parse({title:'参考图调整（待确认）',summary:'已有物体，先选一个方向',suggestions:['只调材质','复制一份'],questions:['希望怎么调整？'],needsClarification:true});
  expect(plan.actions).toEqual([]);
  expect(plan.suggestions).toEqual(['只调材质','复制一份']);
  expect(plan.needsClarification).toBe(true);
 });
 it('accepts the provider returning each action in a step object', () => {
  const plan=parseAgentPlan({title:'按笔记调整',summary:'保留已有物体',actions:[{step:'桌面改蓝'},{step:'创建绿色立方体'}],questions:[],needsClarification:false});
  expect(plan.actions).toEqual(['桌面改蓝','创建绿色立方体']);
 });
 it('keeps tool JSON out of readable plans and reads suggestion labels', () => {
  const plan=parseAgentPlan({title:'补全完成率',summary:'在 D2:D4 写入引用现有数据的公式',actions:[{type:'write_cells',sheet:'研究计划',startCell:'D2',values:[['=C2/B2']]}],suggestions:[{label:'为完成率列设置百分比',action:'format_cells'}],questions:[],needsClarification:false});
  expect(plan.actions).toEqual([]);expect(plan.suggestions).toEqual(['为完成率列设置百分比']);
 });
 it('repairs a usable Office plan with a missing summary and extra suggestions', () => {
  const plan=parseAgentPlan({title:'为空白选区规划内容',actions:['选择一条建议'],questions:['希望填入什么内容？'],needsClarification:true,suggestions:['写入表头','列出待验证项','填入状态汇总','增加统计公式']});
  expect(plan.summary).toBe('为空白选区规划内容');
  expect(plan.suggestions).toEqual(['写入表头','列出待验证项','填入状态汇总']);
  expect(plan.needsClarification).toBe(true);
 });
});
