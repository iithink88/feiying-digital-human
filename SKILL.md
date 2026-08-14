---
name: feiying-digital-human
description: 飞影数字人视频生成（数字人/口播视频/avatar）。把一段口播文案一键生成对口型数字人视频。输入文案、数字人ID、声音ID与飞影API Token，调用飞影开放平台 API 创建并轮询任务，返回无水印（会员）或可下载的数字人视频链接。本技能由 Coze「数字人2」工作流逆向而来，纯本地 Node 服务 + 图形界面，不依赖 Coze。
---

# 飞影数字人视频生成技能

把「扣子（Coze）工作流：数字人2」逆向成本地可运行技能。原工作流用「飞影数字人」插件的
`create_lipsync_video2` + `inspect_video_creation_status` 两个节点，本技能直接调用飞影开放平台
**API V2**，等价实现，且带图形界面。

## 原工作流映射

| Coze 节点 | 本技能实现 |
|-----------|-----------|
| 开始：neirong / api_token_fy / speaker_id_fy / sucai_id_fy | GUI 表单四个输入 |
| 通过音频生成数字人（create_lipsync_video2） | `POST https://hfw-api.hifly.cc/api/v2/hifly/video/create_by_tts` |
| 循环：inspect_video_creation_status | 前端每 8 秒轮询 `GET .../video/task?task_id=` |
| 结束：output（视频链接） | 返回 video_url，页面内可预览/复制/下载 |

## 参数对照

| 原 Coze 变量 | 含义 | 飞影 API 字段 |
|--------------|------|---------------|
| `api_token_fy` | 飞影访问令牌（注册号） | `Authorization: Bearer <token>` |
| `sucai_id_fy` | 数字人素材 ID（克隆的数字人） | `avatar`（形如 `av_xxx`） |
| `speaker_id_fy` | 克隆声音 ID | `voice`（形如 `voice_xxx`） |
| `neirong` | 口播文案 | `text` / `title` |

> 说明：飞影开放平台 API V2 的 `avatar` / `voice` 为字符串 ID（形如 `av_abc123` / `voice_abc123`），
> 请到飞影后台「数字人」与「声音克隆」菜单复制对应 ID。免费版生成会带水印，会员可去水印。

## 环境要求

- Node.js ≥ 18（本机自带 managed Node 22 即可，**无需 npm install**，零外部依赖）
- 一个飞影（hifly.cc）账号与 API Token（个人中心获取）

## 使用方法

### 方式一：图形界面（推荐）

双击技能根目录下的 `启动.bat`：
1. 自动用本机 Node 启动本地服务并打开浏览器
2. 右上角 ⚙ 设置 API Token（仅存本机 `.env`，不联网、不分享）
3. 填入 数字人ID、声音ID、口播文案，点「生成数字人视频」
4. 页面实时轮询进度，完成后直接预览 / 复制链接 / 下载

### 方式二：命令行 / 被其它技能调用

```bash
# 1. 启动服务
node gui/server.js
# 2. 调用接口
curl -X POST http://127.0.0.1:8787/api/generate \
  -H "Content-Type: application/json" \
  -d '{"token":"YOUR_TOKEN","avatar":"av_xxx","voice":"voice_xxx","text":"大家好，今天聊一聊AI数字人"}'
# 返回 {"ok":true,"task_id":"...","request_id":"..."}
# 3. 轮询
curl "http://127.0.0.1:8787/api/task?token=YOUR_TOKEN&task_id=上面的task_id"
# 返回 {"ok":true,"status":3,"video_url":"https://..."}  status=3 即完成
```

## API 接口

- `POST /api/generate` — 创建任务（转发 create_by_tts）
- `GET  /api/task?token=&task_id=` — 查询任务状态
- `GET  /api/voices?token=` — 列出已克隆/公共声音（辅助选声音ID）
- `GET  /api/keys` / `POST /api/set-keys` — 读写本机 `.env` 中的 Token（脱敏）

## 注意事项

- Token 仅保存在技能根 `.env`，打包分享给朋友时请先删除（本技能默认不把 `.env` 打进分享包）。
- 生成耗时通常 1–5 分钟，页面会自动轮询，请勿关闭浏览器标签。
- 原 Coze 工作流末尾有一个「创建飞书文档」节点（把结果写进指定飞书文件夹），该动作依赖 Coze/飞书
  上下文，本地技能不包含；本技能改为把结果链接保存到 `output/结果.md` 供本地查看。
- 飞影 API 基础地址：`https://hfw-api.hifly.cc/api/v2/hifly`
