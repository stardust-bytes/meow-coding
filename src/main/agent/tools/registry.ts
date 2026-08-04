import type { ToolDefinition } from './types'
import { bashTool } from './bash'
import { readTool } from './read'
import { writeTool } from './write'
import { editTool } from './edit'
import { globTool } from './glob'
import { grepTool } from './grep'
import { applyPatchTool } from './apply-patch'
import { todowriteTool } from './todowrite'
import { questionTool } from './question'
import { webfetchTool } from './webfetch'
import { websearchTool } from './websearch'
import { createSkillTool } from './skill'
import { gitTool } from './git'

export interface DefaultToolsOptions {
  getUserSkillsDir?: () => string | undefined
}

export function createDefaultTools(opts: DefaultToolsOptions = {}): Map<string, ToolDefinition> {
  const tools = [
    bashTool,
    readTool,
    writeTool,
    editTool,
    globTool,
    grepTool,
    applyPatchTool,
    todowriteTool,
    questionTool,
    webfetchTool,
    websearchTool,
    createSkillTool(opts.getUserSkillsDir ?? (() => undefined)),
    gitTool
  ]
  return new Map(tools.map(t => [t.name, t]))
}
