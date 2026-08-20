import { describe, expect, it } from 'vitest'
import { highlightCode } from '../../src/renderer/src/components/chat/highlight'

describe('highlightCode smoke', () => {
  it('produces shiki HTML with token colors for tsx', async () => {
    const html = await highlightCode('const x: number = 42', 'tsx')
    expect(html).not.toBeNull()
    expect(html).toContain('shiki')
    expect(html).toContain('dark-plus')
    expect(html).toContain('style="')
  }, 30000)

  it('highlights java and vue', async () => {
    const java = await highlightCode('public class A { int x = 1; }', 'java')
    expect(java).toContain('shiki')
    const vue = await highlightCode('<template><p>{{ msg }}</p></template>', 'vue')
    expect(vue).toContain('shiki')
  }, 30000)
})
