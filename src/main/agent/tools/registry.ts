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
import { OfficeCliBinary } from '../../officecli/binary-manager'
import { createOfficeTool } from './office'

export interface DefaultToolsOptions {
  getUserSkillsDir?: () => string | undefined
  getBuiltinSkillsDir?: () => string | undefined
  getUserDataDir?: () => string | undefined
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
    createSkillTool(opts.getUserSkillsDir ?? (() => undefined), opts.getBuiltinSkillsDir),
    gitTool
  ]
  const userDataDir = opts.getUserDataDir?.()
  if (userDataDir) {
    const binary = new OfficeCliBinary({ userDataDir })
    tools.push(createOfficeTool({ resolveBinary: () => binary.resolveBinaryPath() }))
  }
  return new Map(tools.map(t => [t.name, t]))
}
