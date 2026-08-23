import { updateListMusics } from '@renderer/store/list/action'
import { ref, nextTick } from '@common/utils/vueTools'

export default ({ props, list }) => {
  const isShowMusicRenameModal = ref(false)
  const musicInfo = ref(null)
  const renameType = ref('name')

  const showRenameModal = (index, type) => {
    musicInfo.value = list.value[index]
    renameType.value = type
    nextTick(() => {
      isShowMusicRenameModal.value = true
    })
  }

  const handleRenameMusic = (index) => {
    showRenameModal(index, 'name')
  }

  const handleRenameSinger = (index) => {
    showRenameModal(index, 'singer')
  }

  const handleRenameAlbum = (index) => {
    showRenameModal(index, 'album')
  }

  const renameMusic = (newValue) => {
    const minfo = musicInfo.value
    if (!minfo) return
    const patch = renameType.value === 'album'
      ? { meta: { ...(minfo.meta || {}), albumName: newValue } }
      : renameType.value === 'singer'
        ? { singer: newValue }
        : { name: newValue }
    updateListMusics([{
      id: props.listId,
      musicInfo: {
        ...minfo,
        ...patch,
      },
    }])
    isShowMusicRenameModal.value = false
  }

  return {
    isShowMusicRenameModal,
    selectedRenameMusicInfo: musicInfo,
    renameType,
    handleRenameMusic,
    handleRenameSinger,
    handleRenameAlbum,
    renameMusic,
  }
}
