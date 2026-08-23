import { httpFetch } from '../../request'
import musicSearch from './musicSearch'
import lyric from './lyric'
import pic from './pic'

const biliHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
}

const bili = {
  musicSearch,

  // 以下功能 B站源不支持，置 null 以跳过歌单/排行榜/热搜入口
  songList: null,
  leaderboard: null,
  hotSearch: null,
  tipSearch: null,
  comment: null,

  getMusicUrl(songInfo, type) {
    // First get the video's cid, then use it to get play URL
    const requestObj = httpFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${songInfo.songmid}`, {
      headers: biliHeaders,
    })

    return {
      promise: requestObj.promise.then(({ body }) => {
        if (body?.code !== 0 || !body.data) return Promise.reject(new Error('获取视频信息失败'))

        const cid = body.data.cid
        // Use lowest quality (16 = 360P) for faster loading; audio-only not directly available
        const qn = 16

        return httpFetch(
          `https://api.bilibili.com/x/player/playurl?bvid=${songInfo.songmid}&cid=${cid}&qn=${qn}&fnver=0&fnval=4048&fourk=1`,
          {
            headers: biliHeaders,
          },
        ).promise.then(({ body: playBody }) => {
          if (playBody?.code !== 0) return Promise.reject(new Error('获取播放地址失败'))

          const data = playBody.data
          // Try to get audio-only stream first, then fallback to video
          let url = null

          if (data.dash?.audio?.length) {
            // Prefer audio-only stream (DASH)
            const audio = data.dash.audio.sort((a, b) => b.bandwidth - a.bandwidth)
            url = audio[0].baseUrl || audio[0].base_url
            if (Array.isArray(url)) url = url[0]
            // Use backup URL if base fails
            if (!url && audio[0].backupUrl?.length) url = audio[0].backupUrl[0]
            if (!url && audio[0].backup_url?.length) url = audio[0].backup_url[0]
          } else if (data.durl?.length) {
            // Fallback to video stream
            url = data.durl[0].url
          }

          if (!url) return Promise.reject(new Error('找不到可播放的音频'))
          return { url, type, size: '' }
        })
      }),
      cancelHttp() {
        requestObj.cancelHttp()
      },
    }
  },

  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },

  getPic(songInfo) {
    return pic.getPic(songInfo)
  },

  getMusicDetailPageUrl(songInfo) {
    return `https://www.bilibili.com/video/${songInfo.songmid}`
  },
}

export default bili
