import { httpFetch } from '../../request'

const biliHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
}

export default {
  getPic(songInfo) {
    // Use video thumbnail from search results, or fetch from API
    if (songInfo.img) return Promise.resolve(songInfo.img)

    const requestObj = httpFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${songInfo.songmid}`, {
      headers: biliHeaders,
    })

    return requestObj.promise.then(({ body }) => {
      if (body?.code !== 0 || !body.data) return Promise.reject(new Error('获取封面失败'))
      const pic = body.data.pic
      return pic || null
    })
  },
}
