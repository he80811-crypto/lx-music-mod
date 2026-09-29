import WebSocket from 'ws'
import log from '../log'
import { getSyncWsAgent } from './proxy'

let socket: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let refCount = 0
let stopped = false
let reconnectDelay = 1000
let onNotify: (() => void) | null = null
let hostRef = ''
let keyRef = ''

const buildUrl = (host: string, key: string) => {
  const h = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `wss://${h}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`
}

const buildJoin = () => JSON.stringify({
  topic: 'realtime:lx_sync_notify',
  event: 'phx_join',
  payload: {
    config: {
      broadcast: { ack: false, self: false },
      presence: { enabled: false },
      private: false,
    },
  },
  ref: String(++refCount),
  join_ref: String(refCount),
})

const buildHeartbeat = () => JSON.stringify({
  topic: 'phoenix',
  event: 'heartbeat',
  payload: {},
  ref: String(++refCount),
})

const stopHeartbeat = () => {
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
  heartbeatTimer = null
}

const startHeartbeat = () => {
  stopHeartbeat()
  heartbeatTimer = setTimeout(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(buildHeartbeat())
      startHeartbeat()
    }
  }, 15000)
}

const connect = () => {
  if (stopped || !hostRef || !keyRef) return
  stopHeartbeat()
  log.info('[supabase] realtime connecting: ' + hostRef)
  const wsAgent = getSyncWsAgent()
  const ws = new WebSocket(buildUrl(hostRef, keyRef), wsAgent ? { agent: wsAgent } : undefined)
  socket = ws
  ws.on('open', () => {
    if (stopped || ws !== socket) return
    log.info('[supabase] realtime connected')
    reconnectDelay = 1000
    ws.send(buildJoin())
    startHeartbeat()
  })
  ws.on('message', (data) => {
    if (stopped || ws !== socket) return
    try {
      const msg = JSON.parse(data.toString())
      if (msg.event == 'phx_reply' && msg.payload?.status === 'ok') {
        log.info('[supabase] realtime joined broadcast channel')
      } else if (msg.event == 'broadcast') {
        onNotify?.()
      }
    } catch {
      // ignore
    }
  })
  ws.on('close', () => {
    if (ws !== socket) return
    socket = null
    stopHeartbeat()
    if (stopped) return
    log.info('[supabase] realtime closed, reconnect in ' + reconnectDelay + 'ms')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  })
  ws.on('error', () => {
    if (ws === socket) ws.close()
  })
}

export const sendRealtimeNotify = () => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      topic: 'realtime:lx_sync_notify',
      event: 'broadcast',
      payload: { type: 'broadcast', event: 'new_actions', payload: { at: Date.now() } },
      ref: String(++refCount),
    }))
  }
}

export const startRealtime = (host: string, key: string, notify: () => void) => {
  stopRealtime()
  stopped = false
  reconnectDelay = 1000
  onNotify = notify
  hostRef = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  keyRef = key
  connect()
}

export const stopRealtime = () => {
  stopped = true
  onNotify = null
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  stopHeartbeat()
  if (socket) {
    const ws = socket
    socket = null
    ws.removeAllListeners()
    ws.close()
  }
}
