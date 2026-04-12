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
import { moveTool } from './move'
import { gradientTool } from './gradient'
import { dodgeTool, burnTool } from './dodge'
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
  move:         moveTool,
  crop:         cropTool,
  frame:        noopTool,
  gradient:     gradientTool,
  dodge:        dodgeTool,
  burn:         burnTool,
  text:         noopTool,
  shape:        noopTool,
  hand:         noopTool,
}

export type { ToolDefinition, ToolHandler, ToolContext, ToolPointerPos, ToolOptionsStyles } from './types'
