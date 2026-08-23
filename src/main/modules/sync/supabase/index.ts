// Supabase 云同步传输层
// 替代原 WebSocket + message2call 传输；数据协议（ActionList / md5 / 快照 / 模式选择）与原版保持一致
// 增量同步：本地动作 -> lx_sync_actions 表；轮询消费 id > cursor 的远端动作
// 全量同步：lx_sync_snapshots 表（md5 冲突检测 -> 弹窗选模式）

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { toMD5 } from '@common/utils/nodejs'
import { File } from '@common/constants_sync'
import { sendClientStatus, sendSelectMode } from '@main/modules/winMain'
import log from '../log'
import { getComputerName } from '../utils'
import { startRealtime, stopRealtime, sendRealtimeNotify } from './realtime'
import {
  registerListActionEvent,
  handleRemoteListAction,
  getLocalListData,
  setLocalListData,
} from '../listEvent'
import {
  registerDislikeActionEvent,
  handleRemoteDislikeAction,
  getLocalDislikeData,
  setLocalDislikeData,
} from '../dislikeEvent'

const POLL_INTERVAL_MAX = 180000
const ACTION_BATCH_LIMIT = 200
const PUSH_BATCH_SIZE = 50
const SNAPSHOT_DELAY = 5000
const SELECT_MODE_TIMEOUT = 60000

type DataType = 'list' | 'dislike'

interface SupabaseConfig {
  url: string
  publishableKey: string
  secret: string
}

class SupabaseApi {
  private readonly headers: Record<string, string>

  constructor(private readonly config: SupabaseConfig) {
    this.headers = {
      apikey: config.publishableKey,
      Authorization: `Bearer ${config.publishableKey}`,
      'x-sync-secret': config.secret,
      'Content-Type': 'application/json',
    }
  }

  private async request(pathName: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.config.url}/rest/v1${pathName}`, {
      ...init,
      headers: { ...this.headers, ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`supabase ${pathName} failed: ${res.status} ${await res.text()}`)
    return res
  }

  private getJson<T>(pathName: string): Promise<T> {
    return this.request(pathName).then(res => res.json()) as Promise<T>
  }

  private post(pathName: string, body: unknown, prefer: string): Promise<Response> {
    return this.request(pathName, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Prefer: prefer },
    })
  }

  upsertDevice(id: string, name: string, platform: string) {
    return this.post('/lx_sync_devices', { id, name, platform }, 'resolution=merge-duplicates,return=minimal')
  }

  getDeviceName(id: string) {
    return this.getJson<{ name: string }[]>(`/lx_sync_devices?id=eq.${id}&select=name`).then(rows => rows[0]?.name ?? '')
  }

  getSnapshot<D>(dataType: DataType) {
    return this.getJson<{ md5: string; data: D; device_id: string }[]>(`/lx_sync_snapshots?data_type=eq.${dataType}&select=md5,data,device_id`)
      .then(rows => rows[0] ?? null)
  }

  upsertSnapshot(dataType: DataType, md5: string, data: unknown, deviceId: string) {
    return this.post('/lx_sync_snapshots', { data_type: dataType, md5, data, device_id: deviceId }, 'resolution=merge-duplicates,return=minimal')
  }

  insertActions(rows: { data_type: DataType; device_id: string; action: unknown }[]) {
    return this.post('/lx_sync_actions', rows, 'return=minimal')
  }

  getActions<A>(dataType: DataType, cursor: number) {
    return this.getJson<{ id: number; device_id: string; action: A }[]>(
      `/lx_sync_actions?data_type=eq.${dataType}&id=gt.${cursor}&order=id.asc&limit=${ACTION_BATCH_LIMIT}&select=id,device_id,action`,
    )
  }

  getCursor(deviceId: string, dataType: DataType) {
    return this.getJson<{ last_action_id: number }[]>(`/lx_sync_cursors?device_id=eq.${deviceId}&data_type=eq.${dataType}&select=last_action_id`)
      .then(rows => rows[0]?.last_action_id ?? 0)
  }

  upsertCursor(deviceId: string, dataType: DataType, lastActionId: number) {
    return this.post('/lx_sync_cursors', { device_id: deviceId, data_type: dataType, last_action_id: lastActionId }, 'resolution=merge-duplicates,return=minimal')
  }
}

let api: SupabaseApi | null = null
let hostRef = ''
let deviceId = ''
let runId = 0
let pollTimer: NodeJS.Timeout | null = null
let snapshotTimers = new Map<DataType, NodeJS.Timeout>()
let actionQueue: { data_type: DataType; device_id: string; action: unknown }[] = []
let flushing = false
let cursors: Record<DataType, number> = { list: 0, dislike: 0 }
let unregisterList: (() => void) | null = null
let unregisterDislike: (() => void) | null = null

const getOrCreateDeviceId = () => {
  const filePath = path.join(global.lxDataPath, File.clientDataPath, 'deviceId.json')
  if (existsSync(filePath)) {
    try {
      const { deviceId: existed } = JSON.parse(readFileSync(filePath, 'utf-8'))
      if (typeof existed == 'string' && existed) return existed
    } catch {
      // 文件损坏则重新生成
    }
  }
  const id = randomUUID()
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify({ deviceId: id }), 'utf-8')
  return id
}

const getSyncModeStoragePath = () => path.join(global.lxDataPath, File.clientDataPath, 'syncMode.json')

const getSavedSyncMode = (dataType: DataType): string | null => {
  try {
    const filePath = getSyncModeStoragePath()
    if (!existsSync(filePath)) return null
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return data[dataType] ?? null
  } catch {
    return null
  }
}

const setSavedSyncMode = (dataType: DataType, mode: string) => {
  try {
    const filePath = getSyncModeStoragePath()
    let data: Record<string, string> = {}
    if (existsSync(filePath)) data = JSON.parse(readFileSync(filePath, 'utf-8'))
    data[dataType] = mode
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(data), 'utf-8')
  } catch {
    // 忽略
  }
}

const selectSyncMode = (dataType: DataType, remoteDeviceId: string) => new Promise<LX.Sync.ModeTypes[DataType] | null>(resolve => {
  let settled = false
  const timeoutId = setTimeout(() => finish(null), SELECT_MODE_TIMEOUT)
  const finish = (mode: LX.Sync.ModeTypes[DataType] | null) => {
    if (settled) return
    settled = true
    clearTimeout(timeoutId)
    if (mode != null && mode != 'cancel') setSavedSyncMode(dataType, mode)
    resolve(mode)
  }
  void api!.getDeviceName(remoteDeviceId)
    .then(name => sendSelectMode(name || '云同步', dataType, finish))
    .catch(() => sendSelectMode('云同步', dataType, finish))
})

const initDataType = async<A, B>(
  dataType: DataType,
  getLocalData: () => Promise<A>,
  setLocalData: (data: A) => Promise<void>,
  registerActionEvent: (sendAction: (action: B) => (void | Promise<void>)) => () => void,
) => {
  const localData = await getLocalData()
  const md5 = toMD5(JSON.stringify(localData))
  const snapshot = await api!.getSnapshot<A>(dataType)
  if (!snapshot) {
    await api!.upsertSnapshot(dataType, md5, localData, deviceId)
    log.info(`[supabase] ${dataType}: first upload`)
  } else if (snapshot.md5 !== md5) {
    const savedMode = getSavedSyncMode(dataType)
    const mode = savedMode ?? await selectSyncMode(dataType, snapshot.device_id)
    if (mode == null || mode == 'cancel') throw new Error('已取消同步')
    if (mode.includes('remote_local')) {
      await setLocalData(snapshot.data)
      log.info(`[supabase] ${dataType}: pulled from cloud`)
    } else {
      await api!.upsertSnapshot(dataType, md5, localData, deviceId)
      log.info(`[supabase] ${dataType}: pushed to cloud`)
    }
  }
  cursors[dataType] = await api!.getCursor(deviceId, dataType)
  const unregister = registerActionEvent(action => void queueAction(dataType, action))
  if (dataType == 'list') unregisterList = unregister
  else unregisterDislike = unregister
}

const initListData = () => initDataType(
  'list',
  getLocalListData,
  setLocalListData,
  registerListActionEvent,
)

const initDislikeData = () => initDataType(
  'dislike',
  getLocalDislikeData,
  setLocalDislikeData,
  registerDislikeActionEvent,
)

const queueAction = (dataType: DataType, action: unknown) => {
  if (!api) return
  actionQueue.push({ data_type: dataType, device_id: deviceId, action })
  void flushActions()
  scheduleSnapshot(dataType)
}

const flushActions = async() => {
  if (!api || flushing) return
  flushing = true
  try {
    while (actionQueue.length) {
      const batch = actionQueue.splice(0, PUSH_BATCH_SIZE)
      try {
        await api.insertActions(batch)
        sendRealtimeNotify()
      } catch (err) {
        actionQueue.unshift(...batch)
        log.warn(`[supabase] push actions failed: ${(err as Error).message}`)
        break
      }
    }
  } finally {
    flushing = false
  }
}

const scheduleSnapshot = (dataType: DataType) => {
  const timer = snapshotTimers.get(dataType)
  if (timer) clearTimeout(timer)
  snapshotTimers.set(dataType, setTimeout(() => {
    snapshotTimers.delete(dataType)
    void updateSnapshot(dataType)
  }, SNAPSHOT_DELAY))
}

const updateSnapshot = async(dataType: DataType) => {
  if (!api) return
  try {
    const localData = dataType == 'list'
      ? await getLocalListData()
      : await getLocalDislikeData()
    await api.upsertSnapshot(dataType, toMD5(JSON.stringify(localData)), localData, deviceId)
  } catch (err) {
    log.warn(`[supabase] snapshot ${dataType} failed: ${(err as Error).message}`)
  }
}

const pollList = async(): Promise<boolean> => {
  const rows = await api!.getActions<LX.Sync.List.ActionList>('list', cursors.list)
  let maxId = cursors.list
  let hasNew = false
  for (const row of rows) {
    if (row.device_id !== deviceId) {
      hasNew = true
      try {
        await handleRemoteListAction(row.action)
      } catch (err) {
        log.warn(`[supabase] apply list action #${row.id} failed: ${(err as Error).message}`)
      }
    }
    maxId = Math.max(maxId, row.id)
  }
  if (maxId > cursors.list) {
    cursors.list = maxId
    await api!.upsertCursor(deviceId, 'list', maxId)
  }
  return hasNew
}

const pollDislike = async(): Promise<boolean> => {
  const rows = await api!.getActions<LX.Sync.Dislike.ActionList>('dislike', cursors.dislike)
  let maxId = cursors.dislike
  let hasNew = false
  for (const row of rows) {
    if (row.device_id !== deviceId) {
      hasNew = true
      try {
        await handleRemoteDislikeAction(row.action)
      } catch (err) {
        log.warn(`[supabase] apply dislike action #${row.id} failed: ${(err as Error).message}`)
      }
    }
    maxId = Math.max(maxId, row.id)
  }
  if (maxId > cursors.dislike) {
    cursors.dislike = maxId
    await api!.upsertCursor(deviceId, 'dislike', maxId)
  }
  return hasNew
}

const doPoll = async() => {
  if (runId == 0 || !api) return
  await flushActions()
  let hasNew = false
  try {
    hasNew = await pollList()
  } catch (err) {
    log.warn(`[supabase] poll list failed: ${(err as Error).message}`)
  }
  try {
    hasNew = (await pollDislike()) || hasNew
  } catch (err) {
    log.warn(`[supabase] poll dislike failed: ${(err as Error).message}`)
  }
  return hasNew
}

const startPolling = () => {
  pollTimer = setTimeout(async() => {
    if (runId == 0 || !api) return
    await doPoll()
    if (runId != 0) startPolling()
  }, POLL_INTERVAL_MAX)
}

const notifyRealtimeData = () => {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  void doPoll().then(() => {
    if (runId != 0) startPolling()
  })
}

export const connectServer = async(host: string, publishableKey: string, secret: string) => {
  if (!host || !publishableKey || !secret) throw new Error('请填写完整的云同步配置（地址 / Publishable Key / 同步密钥）')
  const id = ++runId
  await disconnectServer(true, false)
  if (id != runId) return
  api = new SupabaseApi({ url: host.replace(/\/+$/, ''), publishableKey, secret })
  hostRef = host
  sendClientStatus({ status: false, message: 'connecting', address: [host] })
  try {
    deviceId = getOrCreateDeviceId()
    await api.upsertDevice(deviceId, getComputerName(), 'desktop')
    await initListData()
    await initDislikeData()
    if (id != runId) return
    startPolling()
    startRealtime(host.replace(/^https?:\/\//, '').replace(/\/+$/, ''), publishableKey, notifyRealtimeData)
    log.info('[supabase] connected')
    sendClientStatus({ status: true, message: '', address: [host] })
  } catch (err) {
    if (id != runId) return
    const message = (err as Error).message
    sendClientStatus({ status: false, message, address: [host] })
    log.r_warn(`[supabase] connect error: ${message}`)
    throw err
  }
}

export const disconnectServer = async(isResetStatus = true, isIncrementRunId = true) => {
  if (isIncrementRunId) runId++
  stopRealtime()
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  for (const [, timer] of snapshotTimers) clearTimeout(timer)
  snapshotTimers.clear()
  actionQueue = []
  if (unregisterList) {
    unregisterList()
    unregisterList = null
  }
  if (unregisterDislike) {
    unregisterDislike()
    unregisterDislike = null
  }
  api = null
  if (isResetStatus) sendClientStatus({ status: false, message: '', address: [] })
}

export const getStatus = (): LX.Sync.ClientStatus => {
  return { status: !!api, message: '', address: hostRef ? [hostRef] : [] }
}
