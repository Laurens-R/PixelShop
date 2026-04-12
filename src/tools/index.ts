import type { Tool } from '@/types'
import type { ToolDefinition } from './types'
import { pencilTool } from './pencil'
import { brushTool } from './brush'
import { eraserTool } from './eraser'
import { selectTool } from './select'
import { lassoTool } from './lasso'
import { magicWandTool } from './magicWand'
import { fillTool } from './fill'
import { eyedropperTool } from './eyedropper'
import { zoomTool } from './zoom'
import { cropTool } from './crop'
import { noopTool } from './noop'

export const TOOL_REGISTRY: Record<Tool, ToolDefinition> = {
  pencil:       pencilTool,
  brush:        brushTool,
  eraser:       eraserTool,
  select:       selectTool,
  lasso:        lassoTool,
  'magic-wand': magicWandTool,
  fill:         fillTool,
  eyedropper:   eyedropperTool,
  zoom:         zoomTool,
  // ── Not yet implemented ────────────────────────────────────────────────────
  move:         noopTool,
  crop:         cropTool,
  frame:        noopTool,
  gradient:     noopTool,
  dodge:        noopTool,
  burn:         noopTool,
  text:         noopTool,
  shape:        noopTool,
  hand:         noopTool,
}

export type { ToolDefinition, ToolHandler, ToolContext, ToolPointerPos, ToolOptionsStyles } from './types'
