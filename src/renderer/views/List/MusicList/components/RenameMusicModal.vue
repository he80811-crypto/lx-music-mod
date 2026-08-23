<template>
  <material-modal :show="show" teleport="#view" @close="handleClose" @after-enter="$refs.input.focus()">
    <main :class="$style.main">
      <h2>{{ type === 'album' ? $t('music_rename__title_album') : type === 'singer' ? $t('music_rename__title_singer') : $t('music_rename__title') }}</h2>
      <base-input
        ref="input"
        v-model="newName"
        :class="$style.input"
        :placeholder="type === 'album' ? $t('music_rename__input_tip_album') : type === 'singer' ? $t('music_rename__input_tip_singer') : $t('music_rename__input_tip')"
        @submit="handleSubmit"
      />
      <div :class="$style.footer">
        <base-btn :class="$style.btn" @click="handleSubmit">{{ $t('btn_confirm') }}</base-btn>
      </div>
    </main>
  </material-modal>
</template>

<script>
export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    musicInfo: {
      type: Object,
      default() {
        return {}
      },
    },
    type: {
      type: String,
      default: 'name',
    },
  },
  emits: ['update:show', 'confirm'],
  data() {
    return {
      newName: '',
    }
  },
  watch: {
    show(n) {
      if (n) {
        this.newName = (this.type === 'album'
          ? this.musicInfo.meta?.albumName || ''
          : this.type === 'singer' ? this.musicInfo.singer : this.musicInfo.name) || ''
      }
    },
  },
  methods: {
    handleClose() {
      this.$emit('update:show', false)
    },
    handleSubmit() {
      if (!this.newName.trim()) return
      this.handleClose()
      this.$emit('confirm', this.newName.trim())
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 0 15px;
  max-width: 530px;
  min-width: 280px;
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  h2 {
    font-size: 13px;
    color: var(--color-font);
    line-height: 1.3;
    word-break: break-all;
    padding: 15px 0 8px;
  }
}

.input {
  padding: 8px 8px;
}
.footer {
  margin: 20px 0 15px auto;
}
.btn {
  min-width: 70px;

  +.btn {
    margin-left: 10px;
  }
}


</style>
