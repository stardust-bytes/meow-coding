import type { ModelMessage } from 'ai'
import type { ToolDefinition } from '../agent/tools/types'

export const CHATGPT_WEB_TOOL_CALL_FENCE = 'tool_call'

interface PromptInput {
  system: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
}

function toolSummary(tools: ToolDefinition[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.schema
  }))
}

export function compileChatGptWebPrompt(opts: PromptInput): string {
  const toolsJson = JSON.stringify(toolSummary(opts.tools), null, 2)
  const messagesJson = JSON.stringify(opts.messages, null, 2)

  return [
    '# System',
    opts.system,
    '',
    '# Tools available to you',
    'You are acting as the LLM backend for a coding agent. The tools below are executed',
    'locally by the agent, not by you — you never run them yourself.',
    toolsJson,
    '',
    '# Conversation so far',
    messagesJson,
    '',
    '# How to respond',
    'Reply normally in Markdown for plain text/explanations.',
    `When you need to call a tool, output a fenced code block tagged \`${CHATGPT_WEB_TOOL_CALL_FENCE}\``,
    'containing a single JSON object with "name" and "input" keys, for example:',
    '```' + CHATGPT_WEB_TOOL_CALL_FENCE,
    '{"name": "bash", "input": {"command": "ls"}}',
    '```',
    'Do not execute the tool yourself and do not fabricate its result — the agent will run it',
    'and send you the real result in the next turn. Only include a tool_call block when you',
    'actually need to call a tool; otherwise just answer in plain text.'
  ].join('\n')
}
