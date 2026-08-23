# LX Music Mod（桌面版 + 手机版）

**魔改自 [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)**

支持 **Supabase 云同步**，桌面版与手机版数据互通。

---

## 功能

- 完整 lx-music 桌面版功能
- Supabase 云同步（歌单、设置、 dislike 列表等）
- 手机版 APK 已魔改（功能与桌面版一致）
- 多设备同步（PC ↔ Android）

---

## 快速开始

### 桌面版

1. 下载 [最新 Release](https://github.com/he80811-crypto/lx-music-mod/releases) 中的安装包
2. 安装并运行

### 手机版

1. 下载 [lx-music-android.apk](./lx-music-android.apk)
2. 安装到 Android 设备

### Supabase 云同步（推荐）

1. 前往 [Supabase Dashboard](https://supabase.com/dashboard/new) 创建免费项目
2. 打开项目的 **SQL Editor**
3. 复制粘贴 [supabase_setup.sql](./supabase_setup.sql) 内容，点击 **Run**
4. 在桌面版/手机版的 **设置 → 数据同步** 中填写：
   - **Supabase URL**：项目设置页面的 Project URL
   - **Anon Key**：项目设置页面的 anon public key
   - **Sync Secret**：保持默认 `YOUR_SYNC_SECRET_HERE`，或自定义密钥

> 其他用户 fork 本仓库后，**需要自己创建 Supabase 项目**，不能直接用你的。

---

## 目录结构

```
lx-music-mod/
├── src/                    # 桌面版源码（基于 v2.12.2）
│   ├── main/               # 主进程代码
│   ├── renderer/           # 渲染进程代码
│   └── common/             # 公共模块
├── supabase_setup.sql      # Supabase 建表脚本
├── lx-music-android.apk    # 手机版 APK（魔改版）
├── README.md
└── LICENSE
```

---

## 修改说明

- 新增 Supabase 云同步支持（替代官方自建同步服务）
- 手机版 APK 添加相同功能
- 保留原版所有功能

---

## 许可证

- 源码：**Apache License 2.0**（跟随上游）
- 手机版 APK：**仅限个人使用**

---

## 常见问题

**Q: 手机和电脑能同步吗？**  
A: 可以，两端配置同一个 Supabase 项目即可。

**Q: 其他人能用我的 Supabase 项目吗？**  
A: 可以，但会消耗你的额度。建议各自创建独立项目。

**Q: 如何更新到最新版？**  
A: 从 GitHub Releases 下载最新安装包/APK。

---

## 源码编译（开发者）

```bash
cd src
npm install
npm run pack
```

详见 [上游文档](https://lyswhut.github.io/lx-music-doc/desktop/use-source-code)。

---

*本项目仅供学习交流，请遵守当地法律法规。*
