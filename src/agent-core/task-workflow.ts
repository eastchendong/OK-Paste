export type TaskPhase='idle'|'planning'|'ready'|'running'|'preview'|'done'|'error';

const transitions:Record<TaskPhase,readonly TaskPhase[]>={
 idle:['planning','ready','error'],
 planning:['idle','ready','running','error'],
 ready:['idle','planning','running','error'],
 running:['ready','preview','done','error'],
 preview:['idle','ready','running','done','error'],
 done:['idle','ready','running','error'],
 error:['idle','planning','ready','running','done','error'],
};

/** Deterministic product workflow. Agent output cannot invent task states. */
export class TaskWorkflow{
 #phase:TaskPhase='idle';
 get phase(){return this.#phase;}
 move(next:TaskPhase){
  if(next===this.#phase)return next;
  if(!transitions[this.#phase].includes(next))throw new Error(`无效任务状态：${this.#phase} → ${next}`);
  this.#phase=next;return next;
 }
 reset(){this.#phase='idle';}
}
