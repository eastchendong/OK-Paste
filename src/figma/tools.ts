import {z} from 'zod';
const id=z.string().min(1),color=z.string().regex(/^#[0-9a-f]{6}$/i);
const position={x:z.number(),y:z.number(),width:z.number().positive(),height:z.number().positive()};
export const figmaTools={
 figma_inspect_preview:{description:'开始编辑前先读取本次副本的实际节点 ID 和结构。原选区 ID 只作参考，不能直接编辑；后续修改必须使用此工具返回的副本 ID。',schema:z.object({})},
 figma_create_frame:{description:'在当前独立预览内创建布局容器，返回真实节点 ID。',schema:z.object({parentId:id.optional(),name:id,...position})},
 figma_create_rectangle:{description:'在当前预览创建矩形。颜色使用 #RRGGBB。',schema:z.object({parentId:id.optional(),name:id,color,...position,cornerRadius:z.number().nonnegative().optional()})},
 figma_create_text:{description:'在预览内创建文字；自动加载可用字体。',schema:z.object({parentId:id.optional(),text:id,x:z.number(),y:z.number(),width:z.number().positive(),fontSize:z.number().positive(),color})},
 figma_set_text:{description:'修改预览中的文字，保留原字体；不能修改原稿。',schema:z.object({nodeId:id,text:z.string()})},
 figma_set_fill:{description:'修改预览节点填充色，不能修改原稿。',schema:z.object({nodeId:id,color})},
 figma_move_resize:{description:'修改预览节点的位置和尺寸。',schema:z.object({nodeId:id,...position})},
 figma_add_image:{description:'使用内容包的真实 imageId 在预览中放置图片，不生成图片、不使用虚构 URL。',schema:z.object({parentId:id.optional(),imageId:id,name:id,...position})},
};
export const figmaControlSchemas={
 figma_begin_preview:z.object({sourceId:id.optional()}),figma_preview_status:z.object({}),figma_export_preview:z.object({}),
 figma_commit_preview:z.object({}),figma_cancel_preview:z.object({}),figma_undo:z.object({}),
};
