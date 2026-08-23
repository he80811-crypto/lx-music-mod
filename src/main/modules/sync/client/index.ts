import {
  connectServer as supabaseConnectServer,
  disconnectServer as supabaseDisconnectServer,
  getStatus as supabaseGetStatus,
} from '../supabase'
import { sendClientStatus } from '@main/modules/winMain'
import { SYNC_CODE } from '@common/constants_sync'
import log from '../log'

let connectId = 0

const connectServer = async(host: string, publishableKey: string, secret: string) => {
  const id = connectId
  sendClientStatus({
    status: false,
    message: SYNC_CODE.connecting,
    address: [host],
  })
  await supabaseDisconnectServer()
  if (id != connectId) return
  return supabaseConnectServer(host, publishableKey, secret).catch(err => {
    if (id != connectId) return
    sendClientStatus({
      status: false,
      message: err.message,
      address: [host],
    })
    log.r_warn(err.message)
    return Promise.reject(err)
  })
}

const disconnectServer = async(isResetStatus = true) => {
  await supabaseDisconnectServer(isResetStatus)
  if (isResetStatus) connectId++
  log.info('disconnect...')
}

export {
  connectServer,
  disconnectServer,
}

export {
  supabaseGetStatus as getStatus,
}
