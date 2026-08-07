import { readFileSync, writeFileSync } from 'node:fs'
const CRLF = '\r\n'
const path = 'src/renderer/src/App.tsx'
let content = readFileSync(path, 'utf8')
const old1 = [
  '    const offBg = window.api.onAgentBackground(({ agentId, background }) => {',
  '      setBackgrounds(prev => ({ ...prev, [agentId]: background }))',
  '    })',
  '    return () => {',
  '      offData()',
  '      offState()',
  '      offGit()',
  '      offBg()',
  '    }',
  '  }, [])'
].join(CRLF)
const new1 = [
  '    const offBg = window.api.onAgentBackground(({ agentId, background }) => {',
  '      setBackgrounds(prev => ({ ...prev, [agentId]: background }))',
  '    })',
  '    const offChallenge = window.api.onChatGptWebChallenge((e) => {',
  '      setChallenge(e)',
  '    })',
  '    return () => {',
  '      offData()',
  '      offState()',
  '      offGit()',
  '      offBg()',
  '      offChallenge()',
  '    }',
  '  }, [])'
].join(CRLF)
const old2 = [
  '  return (',
  '    <div className="app">',
  '      <TitleBar onOpenSettings={() => setShowSettings(true)} />'
].join(CRLF)
const new2 = [
  '  return (',
  '    <div className="app">',
  '      <ChallengeToast challenge={challenge} onDismiss={() => setChallenge(null)} />',
  '      <TitleBar onOpenSettings={() => setShowSettings(true)} />'
].join(CRLF)
if (!content.includes(old1)) { console.error('OLD1 NOT FOUND'); process.exit(1) }
if (!content.includes(old2)) { console.error('OLD2 NOT FOUND'); process.exit(1) }
content = content.replace(old1, new1).replace(old2, new2)
writeFileSync(path, content)
console.log('OK')