<template lang="pug">
dd
  h3 {{ $t('setting__sync_client_mode') }}
  div
    .p.small {{ $t('setting__sync_client_status', { status: clientStatus }) }}
    .p
      .p.small {{ $t('setting__sync_client_host') }}
      div
        base-input.gap-left(:class="$style.input" :model-value="appSetting['sync.client.host']" :disabled="sync.enable" :placeholder="$t('setting__sync_client_host_tip')" @update:model-value="setSyncClientHost")
    .p
      .p.small {{ $t('setting__sync_client_publishable_key') }}
      div
        base-input.gap-left(:class="$style.input" :model-value="appSetting['sync.client.publishableKey']" :disabled="sync.enable" :placeholder="$t('setting__sync_client_publishable_key_tip')" @update:model-value="setSyncClientPublishableKey")
    .p
      .p.small {{ $t('setting__sync_client_secret') }}
      div
        base-input.gap-left(:class="$style.input" type="password" :model-value="appSetting['sync.client.secret']" :disabled="sync.enable" :placeholder="$t('setting__sync_client_secret_tip')" @update:model-value="setSyncClientSecret")
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { sync } from '@renderer/store'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { debounce } from '@common/utils/common'
import { SYNC_CODE } from '@common/constants_sync'

export default {
  name: 'SettingSyncClient',
  setup() {
    const t = useI18n()

    const clientStatus = computed(() => {
      let status
      switch (sync.client.status.message) {
        case SYNC_CODE.msgBlockedIp:
          status = t('setting__sync_code_blocked_ip')
          break
        case SYNC_CODE.authFailed:
          status = t('setting__sync_code_fail')
          break
        default:
          status = sync.client.status.message
            ? sync.client.status.message
            : sync.client.status.status
              ? t('setting_sync_status_enabled')
              : t('sync_status_disabled')
          break
      }
      return status
    })

    const setSyncClientHost = debounce(host => {
      updateSetting({ 'sync.client.host': host.trim() })
    }, 500)

    const setSyncClientPublishableKey = debounce(key => {
      updateSetting({ 'sync.client.publishableKey': key.trim() })
    }, 500)

    const setSyncClientSecret = debounce(secret => {
      updateSetting({ 'sync.client.secret': secret.trim() })
    }, 500)

    return {
      appSetting,
      sync,
      setSyncClientHost,
      setSyncClientPublishableKey,
      setSyncClientSecret,
      clientStatus,
    }
  },
}
</script>

<style lang="less" module>
.input[disabled] {
  opacity: .8 !important;
}

.input {
  min-width: 380px;
}
</style>
