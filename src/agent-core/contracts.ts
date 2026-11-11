export type AgentMessage={
 role:string;
 content?:unknown;
 tool_calls?:AgentToolCall[];
 tool_call_id?:string;
 reasoning_content?:string;
};

export type AgentToolCall={
 id:string;
 function?:{name?:string;arguments?:string};
};

export type AgentAnswer={
 content?:string|null;
 reasoning_content?:string;
 tool_calls?:AgentToolCall[];
};

export type AgentToolDefinition={
 name:string;
 description:string;
 inputSchema:unknown;
};

export type ModelTool={
 type:'function';
 function:{name:string;description:string;parameters:unknown};
};

export type ExecutionMode='single-pass'|'bounded-react';

export type ExecutionPolicy={
 mode:ExecutionMode;
 maxTurns:number;
 requiresVisualVerification:boolean;
};
