import { execFileSync } from 'node:child_process'
import { ProxyAgent, type Dispatcher } from 'undici'
import * as tunnel from 'tunnel'
import log from '../log'

// 云同步网络代理适配层
// 背景：云同步走主进程 Node 的 fetch / WebSocket，既不读 Electron 会话代理，也不读系统代理，
// 因此在需要代理才能访问 Supabase 的网络下会直接 fetch failed。
// 本模块按以下优先级解析代理，并同时兼容「开代理」与「不开代理」两种场景：
//   1. 应用内设置 network.proxy（用户显式配置，优先级最高）
//   2. 环境变量 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY（含小写形式）
//   3. 系统代理（Windows 注册表 / macOS scutil）—— 代理软件开启时会自动写入，关闭时自动清除
// 未解析到代理时走直连；解析到代理时若代理连接失败会自动回退直连。

export interface SyncProxy {
  host: string
  port: number
  protocol: string
}

const RESOLVE_TTL = 10_000

const parsePort = (port?: string | number | null): number | null => {
  const value = parseInt(String(port ?? ''), 10)
  return Number.isFinite(value) && value > 0 && value < 65536 ? value : null
}

const parseProxyUrl = (raw?: string | null): SyncProxy | null => {
  if (!raw || typeof raw != 'string') return null
  let value = raw.trim()
  if (!value) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`
  try {
    const url = new URL(value)
    if (!url.hostname) return null
    const protocol = (url.protocol || 'http:').replace(/:$/, '').toLowerCase() || 'http'
    const defaultPort = protocol.startsWith('https') ? 443 : protocol.startsWith('socks') ? 1080 : 80
    return {
      host: url.hostname,
      port: parsePort(url.port) ?? defaultPort,
      protocol,
    }
  } catch {
    return null
  }
}

const fromAppSetting = (): SyncProxy | null => {
  try {
    const setting = global.lx?.appSetting
    if (setting && setting['network.proxy.enable'] && setting['network.proxy.host']) {
      return parseProxyUrl(`http://${setting['network.proxy.host']}:${setting['network.proxy.port'] || 80}`)
    }
  } catch {
    // 忽略
  }
  return null
}

const fromEnv = (): SyncProxy | null => {
  const env = process.env
  return parseProxyUrl(
    env.HTTPS_PROXY || env.https_proxy ||
    env.HTTP_PROXY || env.http_proxy ||
    env.ALL_PROXY || env.all_proxy,
  )
}

const fromWindowsRegistry = (): SyncProxy | null => {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf-8', windowsHide: true },
    )
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)) return null
    const matched = out.match(/ProxyServer\s+REG_SZ\s+(.+)/i)
    if (!matched) return null
    // 可能是 "http=host:port;https=host:port" 或 "host:port"
    for (const part of matched[1].trim().split(';')) {
      const eq = part.indexOf('=')
      const scheme = eq >= 0 ? part.slice(0, eq).trim().toLowerCase() : ''
      const addr = eq >= 0 ? part.slice(eq + 1).trim() : part.trim()
      if (eq >= 0 && scheme && !scheme.startsWith('http')) continue
      const parsed = parseProxyUrl(addr)
      if (parsed) return parsed
    }
    return null
  } catch {
    return null
  }
}

const fromMacOS = (): SyncProxy | null => {
  try {
    const out = execFileSync('scutil', ['--proxy'], { encoding: 'utf-8' })
    const scheme = /HTTPSEnable\s*:\s*1/.test(out) ? 'HTTPS' : /HTTPEnable\s*:\s*1/.test(out) ? 'HTTP' : ''
    if (!scheme) return null
    const host = out.match(new RegExp(`${scheme}Proxy\\s*:\\s*(\\S+)`))?.[1]
    const port = out.match(new RegExp(`${scheme}Port\\s*:\\s*(\\d+)`))?.[1]
    if (!host) return null
    return {
      host,
      port: parsePort(port) ?? (scheme === 'HTTPS' ? 443 : 80),
      protocol: scheme.toLowerCase(),
    }
  } catch {
    return null
  }
}

const resolveProxy = (): SyncProxy | null => {
  const proxy = fromAppSetting() ?? fromEnv()
  if (proxy) return proxy
  if (process.platform == 'win32') return fromWindowsRegistry()
  if (process.platform == 'darwin') return fromMacOS()
  return null
}

let cachedProxy: SyncProxy | null | undefined
let cachedAt = 0

export const getSyncProxy = (): SyncProxy | null => {
  const now = Date.now()
  if (cachedProxy !== undefined && now - cachedAt < RESOLVE_TTL) return cachedProxy
  cachedProxy = resolveProxy()
  cachedAt = now
  return cachedProxy
}

export const invalidateSyncProxy = () => {
  cachedProxy = undefined
  cachedAt = 0
  dispatcher = null
  dispatcherKey = ''
}

const proxyUrl = (proxy: SyncProxy) => `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`

const isSocks = (proxy: SyncProxy) => /^socks/i.test(proxy.protocol || '')

let dispatcher: Dispatcher | null = null
let dispatcherKey = ''

// 返回 undici 的 Dispatcher（REST 请求用），无代理时返回 undefined 表示直连
export const getSyncDispatcher = (): Dispatcher | undefined => {
  const proxy = getSyncProxy()
  const key = proxy ? proxyUrl(proxy) : ''
  if (key == dispatcherKey) return dispatcher ?? undefined
  dispatcherKey = key
  dispatcher = null
  if (proxy) {
    if (isSocks(proxy)) {
      log.warn(`[supabase] socks 代理暂不支持 REST 直连代理，将直连: ${key}`)
    } else {
      try {
        dispatcher = new ProxyAgent(key)
      } catch (err) {
        log.warn(`[supabase] 创建代理失败，将直连: ${(err as Error).message}`)
        dispatcher = null
      }
    }
  }
  return dispatcher ?? undefined
}

// 返回 ws 用的 tunnel agent，无代理时返回 undefined 表示直连
export const getSyncWsAgent = () => {
  const proxy = getSyncProxy()
  if (!proxy || isSocks(proxy)) return undefined
  try {
    const options = { proxy: { host: proxy.host, port: proxy.port } }
    return (proxy.protocol || '').startsWith('https')
      ? tunnel.httpsOverHttps(options)
      : tunnel.httpsOverHttp(options)
  } catch (err) {
    log.warn(`[supabase] 创建 WebSocket 代理失败，将直连: ${(err as Error).message}`)
    return undefined
  }
}

const isConnectError = (err: unknown) => {
  const error = err as { code?: string, message?: string, cause?: { code?: string, message?: string } }
  const detail = [
    error?.code,
    error?.cause?.code,
    error?.cause?.message,
    error?.message,
  ].filter(Boolean).join(' ')
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNABORTED|UND_ERR_CONNECT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|fetch failed|socket hang up/i.test(detail)
}

// 带代理的 fetch：优先走代理，代理连接失败时自动回退直连
export const syncFetch = async(url: string, init?: RequestInit): Promise<Response> => {
  const candidates: { label: string, dispatcher?: Dispatcher }[] = []
  const proxyDispatcher = getSyncDispatcher()
  if (proxyDispatcher) candidates.push({ label: 'proxy', dispatcher: proxyDispatcher })
  candidates.push({ label: 'direct' })

  let lastError: unknown
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      const options: RequestInit & { dispatcher?: Dispatcher } = { ...init }
      if (candidate.dispatcher) options.dispatcher = candidate.dispatcher
      return await fetch(url, options)
    } catch (err) {
      lastError = err
      if (i < candidates.length - 1 && isConnectError(err)) {
        log.warn(`[supabase] ${candidate.label} 请求失败(${(err as Error).message})，尝试下一个通道`)
        continue
      }
      throw err
    }
  }
  throw lastError
}
