import { httpFetch } from '../../request'

const biliHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
}

export default {
  getLyric(songInfo) {
    // Bilibili doesn't have standard lyrics; use video subtitle/CC if available
    const requestObj = httpFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${songInfo.songmid}`, {
      headers: biliHeaders,
    })

    return {
      promise: requestObj.promise.then(({ body }) => {
        if (body?.code !== 0 || !body.data) return Promise.reject(new Error('获取歌词失败'))

        const { cid } = body.data
        if (!cid) return Promise.reject(new Error('没有字幕'))

        // Try to get subtitle/CC list
        return httpFetch(
          `https://api.bilibili.com/x/player/v2?bvid=${songInfo.songmid}&cid=${cid}`,
          {
            headers: biliHeaders,
          },
        ).promise.then(({ body: subBody }) => {
          if (subBody?.code !== 0) return Promise.reject(new Error('没有字幕'))

          const subtitleUrls = subBody.data?.subtitle?.subtitles
          if (!subtitleUrls || subtitleUrls.length === 0) return Promise.reject(new Error('没有字幕'))

          // Pick the first subtitle (prefer Chinese)
          const subtitleUrl = subtitleUrls.find(s => s.lang_key === 'zh-CN') || subtitleUrls[0]
          const url = subtitleUrl.subtitle_url.startsWith('http')
            ? subtitleUrl.subtitle_url
            : `https:${subtitleUrl.subtitle_url}`

          return httpFetch(url, {
            headers: biliHeaders,
          }).promise.then(({ body: subtitleBody }) => {
            if (!subtitleBody?.body) return Promise.reject(new Error('字幕解析失败'))

            // Convert subtitle JSON to LRC format
            const lrcLines = []
            for (const item of subtitleBody.body) {
              const start = item.from
              const content = item.content
              const m = Math.floor(start / 60)
              const s = Math.floor(start % 60)
              const ms = Math.floor((start - Math.floor(start)) * 100)
              const timeTag = `[${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}]`
              lrcLines.push(`${timeTag}${content}`)
            }

            return {
              lyric: lrcLines.join('\n'),
              lxlyric: '',
              tlyric: '',
            }
          })
        })
      }),
      cancelHttp() {
        requestObj.cancelHttp()
      },
    }
  },
}
