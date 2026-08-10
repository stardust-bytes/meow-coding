const STORAGE_KEY = 'meowBridge'
const DEFAULT_PORT = 3927

function $(id: string): HTMLElement {
  return document.getElementById(id)!
}

function refreshStatus(): void {
  void chrome.runtime.sendMessage({ kind: 'status' }).then((res: { paired?: boolean; connected?: boolean }) => {
    const dot = $('dot')
    const text = $('statusText')
    if (res?.paired) {
      dot.className = 'dot green'
      text.textContent = 'Paired & connected'
    } else if (res?.connected) {
      dot.className = 'dot amber'
      text.textContent = 'Connected (chưa pair)'
    } else {
      dot.className = 'dot red'
      text.textContent = 'Disconnected'
    }
  }).catch(() => {
    $('dot').className = 'dot red'
    $('statusText').textContent = 'Disconnected'
  })
}

async function detect(): Promise<void> {
  const portInput = $('port') as HTMLInputElement
  try {
    const res = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/api/status`)
    if (res.ok) {
      const body = await res.json() as { port?: number }
      if (typeof body.port === 'number') portInput.value = String(body.port)
      $('hint').textContent = `Detected Meow bridge on port ${body.port}.`
    } else {
      $('hint').textContent = 'Không tìm thấy bridge tại port mặc định.'
    }
  } catch {
    $('hint').textContent = 'Meow chưa chạy? Không kết nối được bridge.'
  }
}

void chrome.storage.local.get(STORAGE_KEY).then((res: Record<string, { port?: number; code?: string } | undefined>) => {
  const cur = res[STORAGE_KEY]
  if (cur?.port) ($('port') as HTMLInputElement).value = String(cur.port)
  if (cur?.code) ($('code') as HTMLInputElement).value = cur.code
  refreshStatus()
})

$('detectBtn').addEventListener('click', () => void detect())
$('saveBtn').addEventListener('click', () => {
  const port = Number(($('port') as HTMLInputElement).value) || DEFAULT_PORT
  const code = ($('code') as HTMLInputElement).value.trim()
  void chrome.storage.local.set({ [STORAGE_KEY]: { port, code } }).then(() => {
    void chrome.runtime.sendMessage({ kind: 'pair', code }).then(() => {
      $('hint').textContent = 'Saved. Đang kết nối...'
      setTimeout(refreshStatus, 800)
    })
  })
})
