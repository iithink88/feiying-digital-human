# 飞影数字人视频生成技能（feiying-digital-human）

把 Coze「数字人2」工作流逆向成本地技能。输入口播文案 + 数字人ID + 声音ID + 飞影 Token，
调用飞影开放平台 API V2 生成对口型数字人视频，自动轮询进度，返回可预览/下载的视频链接。

## 快速开始

1. 双击 `启动.bat`（Windows）。本机 Node 启动本地服务并自动打开浏览器。
2. 右上角 ⚙ 填入飞影 API Token（仅存本机 `.env`，不联网不分享）。
3. 填写 数字人ID、声音ID、口播文案 → 点「生成数字人视频」。
4. 等待 1–5 分钟，页面自动轮询，完成后可预览 / 复制链接 / 下载。

## 参数获取

| 参数 | 飞影后台位置 | 示例 |
|------|-------------|------|
| API Token | 个人中心 | — |
| 数字人ID（avatar） | 数字人 菜单 → 复制素材ID | `av_abc123xyz` |
| 声音ID（voice） | 声音克隆 菜单 → 复制声音ID | `voice_abc123` |

> 免费版生成带水印，会员可去水印（勾选「关闭 AIGC 水印」需会员权限）。

## 接口对照（与原 Coze 工作流）

- `create_lipsync_video2` → `POST /api/v2/hifly/video/create_by_tts`
- `inspect_video_creation_status` → `GET /api/v2/hifly/video/task?task_id=`

## 目录结构

```
feiying-digital-human/
├── SKILL.md
├── 启动.bat
├── gui/
│   ├── server.js      # 本地服务 + 飞影 API 代理
│   ├── index.html     # 图形界面
│   ├── js/app.js
│   └── css/styles.css
├── config/example.env
└── output/            # 结果记录（last_task.json / 结果.md）
```

## 命令行调用

```bash
node gui/server.js
curl -X POST http://127.0.0.1:8787/api/generate -H "Content-Type: application/json" \
  -d '{"token":"YOUR","avatar":"av_xxx","voice":"voice_xxx","text":"文案"}'
curl "http://127.0.0.1:8787/api/task?token=YOUR&task_id=上面的task_id"
```

零外部依赖，仅需 Node.js ≥ 18。
