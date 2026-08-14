/* ============================================================
 * server.js — 飞影数字人 图形界面本地服务器
 * 纯 Node 内置模块，零外部依赖（Node 18+ 自带 fetch）
 * 形态参照「语文智能体 / music-dance-video」：本地 http 静态服务 + 端口自动重试 + 自动开浏览器
 * 功能：
 *   - 代理飞影开放平台 API V2（create_by_tts / video/task / voice/list）
 *   - /api/generate 创建数字人视频任务
 *   - /api/task 轮询任务状态
 *   - /api/voices 列出声音（辅助选 voice id）
 *   - /api/keys 读取、/api/set-keys 保存本机 .env 中的 Token（脱敏）
 *   - /files/* 回看 output 目录下的结果文件
 * ============================================================ */

const http = require("http");
const fs = require("fs");
const path = require("path");

const APP_DIR = __dirname;                                  // gui/
const SKILL_DIR = path.resolve(APP_DIR, "..");              // 技能根
const OUTPUT_DIR = path.join(SKILL_DIR, "output");
const ENV_FILE = path.join(SKILL_DIR, ".env");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const PORT = parseInt(process.env.PORT || "8787", 10);
const HIFLY_BASE = "https://hfw-api.hifly.cc/api/v2/hifly";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".md": "text/markdown; charset=utf-8",
};

/* ---------- 读取技能根 .env（可选，仅用户自己放置的密钥） ---------- */
function loadDotEnv() {
  const extra = {};
  try {
    if (fs.existsSync(ENV_FILE)) {
      const txt = fs.readFileSync(ENV_FILE, "utf-8");
      txt.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m) extra[m[1]] = m[2].replace(/^["']|["']$/g, "");
      });
    }
  } catch (e) { /* 忽略 */ }
  return extra;
}

/* ---------- 通用：解析 body（JSON 或 text） ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/json")) {
        try { resolve(JSON.parse(buf.toString("utf-8"))); }
        catch (e) { reject(e); }
      } else {
        resolve(buf.toString("utf-8"));
      }
    });
    req.on("error", reject);
  });
}

/* ---------- 飞影 API 代理 ---------- */
async function hifly(method, subPath, { token, body, params } = {}) {
  let url = HIFLY_BASE + subPath;
  if (params) {
    const q = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
      .join("&");
    if (q) url += (url.includes("?") ? "&" : "?") + q;
  }
  const headers = { "Authorization": "Bearer " + (token || ""), "Content-Type": "application/json" };
  const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: resp.status, json };
}

/* ---------- API: 创建数字人视频任务 ---------- */
async function apiGenerate(body, res) {
  const token = body.token || loadDotEnv().HIFLY_API_TOKEN || "";
  const avatar = (body.avatar || "").trim();
  const voice = (body.voice || "").trim();
  const text = (body.text || "").trim();
  if (!token) return sendJson(res, 400, { ok: false, error: "缺少飞影 API Token（右上角 ⚙ 设置，或在请求体传 token）" });
  if (!avatar) return sendJson(res, 400, { ok: false, error: "缺少数字人ID（avatar）" });
  if (!voice) return sendJson(res, 400, { ok: false, error: "缺少声音ID（voice）" });
  if (!text) return sendJson(res, 400, { ok: false, error: "缺少口播文案（text）" });

  const title = (body.title && body.title.trim()) || text.slice(0, 30);
  const payload = { title, text, voice, avatar };
  // 可选字幕/水印参数
  if (body.hasOwnProperty("subtitle")) payload.subtitle = body.subtitle ? 1 : 0;
  if (body.aigc_flag !== undefined) payload.aigc_flag = Number(body.aigc_flag) || 0;

  const r = await hifly("POST", "/video/create_by_tts", { token, body: payload });
  if (r.json && r.json.code === 0 && r.json.task_id) {
    // 落盘一份结果记录（便于本地查看 / 分享）
    try {
      const rec = { createdAt: new Date().toISOString(), avatar, voice, text, task_id: r.json.task_id, request_id: r.json.request_id };
      fs.writeFileSync(path.join(OUTPUT_DIR, "last_task.json"), JSON.stringify(rec, null, 2), "utf-8");
    } catch (e) { /* 忽略 */ }
    sendJson(res, 200, { ok: true, task_id: r.json.task_id, request_id: r.json.request_id });
  } else {
    sendJson(res, r.status === 200 ? 502 : r.status, { ok: false, error: (r.json && (r.json.message || r.json.msg)) || "飞影接口返回异常", detail: r.json });
  }
}

/* ---------- API: 查询任务状态 ---------- */
async function apiTask(req, url, res) {
  const token = url.searchParams.get("token") || loadDotEnv().HIFLY_API_TOKEN || "";
  const task_id = url.searchParams.get("task_id") || "";
  const raw = url.searchParams.get("raw") === "1";
  if (!token) return sendJson(res, 400, { ok: false, error: "缺少飞影 API Token" });
  if (!task_id) return sendJson(res, 400, { ok: false, error: "缺少 task_id" });

  const r = await hifly("GET", "/video/task", { token, params: { task_id } });
  if (raw) return sendJson(res, r.status, { ok: r.status === 200, ...r.json });

  // 归一化状态：1等待 2处理中 3完成 4失败
  const st = r.json && r.json.status;
  const statusText = { 1: "排队中", 2: "生成中", 3: "已完成", 4: "失败" }[st] || ("状态" + st);
  // 注意：飞影 API 返回的字段名是 video_Url（大写 U），不是 video_url
  const rawVideoUrl = (r.json && r.json.video_Url) || (r.json && r.json.video_url) ||
                      (r.json && r.json.data && r.json.data.video_Url) || (r.json && r.json.data && r.json.data.video_url) || "";
  const out = {
    ok: r.status === 200,
    status: st,
    statusText,
    video_url: rawVideoUrl,
    progress: st === 3 ? 100 : (st === 2 ? 60 : (st === 1 ? 10 : 0)),
    error: (r.json && (r.json.error_msg || r.json.message || r.json.msg)) || "",
    code: r.json && r.json.code,
  };
  // 完成时把结果追加保存到 md
  if (st === 3 && out.video_url) {
    try {
      const md = path.join(OUTPUT_DIR, "结果.md");
      const line = `- [${new Date().toLocaleString("zh-CN")}] ${text_preview(url)} → ${out.video_url}\n`;
      fs.appendFileSync(md, line, "utf-8");
    } catch (e) { /* 忽略 */ }
  }
  sendJson(res, r.status === 200 ? 200 : (r.status || 500), out);
}

function text_preview(url) {
  // 从 query 无法拿到 text，这里仅占位；真正的文案记录在 last_task.json
  return "数字人视频";
}

/* ---------- API: 列出声音（辅助） ---------- */
async function apiVoices(req, url, res) {
  const token = url.searchParams.get("token") || loadDotEnv().HIFLY_API_TOKEN || "";
  if (!token) return sendJson(res, 400, { ok: false, error: "缺少飞影 API Token" });
  const r = await hifly("GET", "/voice/list", { token, params: { page: 1, size: 50, kind: url.searchParams.get("kind") || 1 } });
  sendJson(res, r.status === 200 ? 200 : (r.status || 500), { ok: r.status === 200, raw: r.json });
}

/* ---------- API: 读取 / 保存 Key ---------- */
function apiGetKeys(res) {
  const extra = loadDotEnv();
  const masked = {};
  for (const [k, v] of Object.entries(extra)) {
    masked[k] = v.length > 8 ? v.slice(0, 4) + "****" : "****";
  }
  sendJson(res, 200, { ok: true, keys: masked });
}

function apiSetKeys(body, res) {
  try {
    const keys = body.keys || {};
    if (typeof keys !== "object" || Array.isArray(keys)) {
      return sendJson(res, 400, { ok: false, error: "keys 必须是对象 { ENV_NAME: value }" });
    }
    let existing = "";
    try { if (fs.existsSync(ENV_FILE)) existing = fs.readFileSync(ENV_FILE, "utf-8"); } catch (_) {}
    const lines = existing.split(/\r?\n/);
    const updated = [];
    const written = new Set();
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m && keys[m[1]] !== undefined) {
        const val = String(keys[m[1]]);
        updated.push(`${m[1]}="${val}"`);
        written.add(m[1]);
      } else {
        updated.push(line);
      }
    }
    for (const [k, v] of Object.entries(keys)) {
      if (!written.has(k) && v) updated.push(`${k}="${String(v)}"`);
    }
    fs.writeFileSync(ENV_FILE, updated.join("\r\n") + "\r\n", "utf-8");
    console.log("[Key 设置] 已写入 " + Object.keys(keys).join(", ") + " 到 " + ENV_FILE);
    sendJson(res, 200, { ok: true, saved: Object.keys(keys) });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
}

/* ---------- 视频代理（解决飞影 CDN 防盗链/CORS 导致浏览器无法直接播放） ---------- */

// 任务结果缓存：task_id → { video_url, cached_at, localPath }
const _taskCache = new Map();

/**
 * GET /api/video-proxy?task_id=xxx&token=xxx&download=0|1
 * 后端拉取飞影 CDN 视频，流式转发给浏览器（解决跨域/防盗链）。
 *   download=0（默认）：inline，给 <video> 播放用
 *   download=1：attachment，触发浏览器"另存为"下载
 * 同时异步缓存一份 mp4 到 output/ 目录。
 */
async function apiVideoProxy(req, url, res) {
  const token = url.searchParams.get("token") || loadDotEnv().HIFLY_API_TOKEN || "";
  const task_id = url.searchParams.get("task_id") || "";
  const forceDownload = url.searchParams.get("download") === "1";
  if (!token) return sendJson(res, 400, { ok: false, error: "缺少 Token" });
  if (!task_id) return sendJson(res, 400, { ok: false, error: "缺少 task_id" });

  // 1) 先从缓存或 API 获取 video_url（注意：飞影返回 video_Url 大写 U）
  let videoUrl = (_taskCache.get(task_id) && _taskCache.get(task_id).video_url) || "";
  if (!videoUrl) {
    const r = await hifly("GET", "/video/task", { token, params: { task_id } });
    const st = r.json && r.json.status;
    videoUrl = (r.json && r.json.video_Url) || (r.json && r.json.video_url) ||
              (r.json && r.json.data && r.json.data.video_Url) || (r.json && r.json.data && r.json.data.video_url) || "";
    if (st === 3 && videoUrl) {
      _taskCache.set(task_id, { video_url: videoUrl, cached_at: Date.now() });
    } else if (!videoUrl) {
      return sendJson(res, 404, { ok: false, error: "任务未完成或无视频链接", status: st, raw: r.json });
    }
  }

  // 2) 如果本地已有缓存文件，直接走文件服务（支持 Range/断点续传）
  const rec = _taskCache.get(task_id);
  const cachedPath = (rec && rec.localPath) || path.join(OUTPUT_DIR, task_id + ".mp4");
  if (fs.existsSync(cachedPath)) {
    const stat = fs.statSync(cachedPath);
    if (stat.size > 10000) { // 大于 10KB 视为有效缓存
      console.log("[视频代理] 命中本地缓存: " + cachedPath + " (" + (stat.size / 1024 / 1024).toFixed(1) + " MB)");
      return serveVideoFile(res, cachedPath, task_id, forceDownload);
    }
  }

  // 3) 流式转发：从 CDN 拉 → 边写浏览器边存本地（不缓冲全量到内存）
  try {
    console.log("[视频代理] 正在流式拉取视频: " + videoUrl.slice(0, 120) + "...");
    const vidResp = await fetch(videoUrl, {
      headers: {
        // CDN 公开链接不需要 Authorization；加了反而可能被 CDN 拦截返回 401/403
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(180_000), // 3 分钟总超时（视频可能较大）
    });

    if (!vidResp.ok) {
      console.error("[视频代理] 飞影 CDN 返回 HTTP " + vidResp.status);
      const errText = await vidResp.text().catch(() => "");
      return sendJson(res, 502, { ok: false, error: "视频源返回 HTTP " + vidResp.status, detail: errText.slice(0, 200) });
    }

    const contentType = vidResp.headers.get("content-type") || "video/mp4";
    const totalSize = parseInt(vidResp.headers.get("content-length") || "0", 10);

    // 响应头
    const headers = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
      "Accept-Ranges": "bytes",
    };
    if (forceDownload) {
      headers["Content-Disposition"] = 'attachment; filename="digital_human_' + task_id + '.mp4"';
    } else {
      headers["Content-Disposition"] = 'inline; filename="digital_human_' + task_id + '.mp4"';
    }
    if (totalSize > 0) headers["Content-Length"] = String(totalSize);
    res.writeHead(200, headers);

    // 流式转发：读 CDN → 写浏览器 + 同时写本地文件
    const reader = vidResp.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    // 打开本地缓存文件（同步，确保存在）
    const cacheDir = OUTPUT_DIR;
    const localPath = path.join(cacheDir, task_id + ".mp4");
    let fd = null;
    try { fd = fs.openSync(localPath, "w"); } catch (e) { /* 缓存写入不影响播放 */ }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // 写入浏览器响应
        res.write(value);
        // 累积用于日志
        chunks.push(value);
        totalBytes += value.length;
        // 同步写入本地缓存
        if (fd !== null) {
          try { fs.writeSync(fd, value); } catch (_) { /* 忽略 */ }
        }
      }
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch (_) {}
      }
    }

    res.end();

    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    console.log("[视频代理] 流式传输完成 (" + mb + " MB)");

    // 更新内存缓存记录
    if (_taskCache.has(task_id)) {
      _taskCache.get(task_id).localPath = localPath;
    } else {
      _taskCache.set(task_id, { video_url: videoUrl, cached_at: Date.now(), localPath: localPath });
    }

    // 清理 chunks 引用释放内存
    chunks.length = 0;
  } catch (e) {
    console.error("[视频代理] 拉取视频异常:", e.message);
    // 如果响应头还没发，发 JSON 错误
    if (!res.headersSent) {
      sendJson(res, 502, { ok: false, error: "视频代理失败: " + e.message });
    } else {
      res.end(); // 已经在传了，只能强制结束
    }
  }
}

/**
 * 从本地文件提供视频服务（支持 <video> 播放和下载）。
 * 注意：简化实现，不支持 Range 请求（对大多数场景够用）。
 */
function serveVideoFile(res, filePath, taskId, forceDownload) {
  const ext = path.extname(filePath).toLowerCase();
  let stat;
  try { stat = fs.statSync(filePath); } catch (e) {
    return sendJson(res, 404, { ok: false, error: "缓存文件不存在" });
  }
  const fileSize = stat.size;
  const mimeType = MIME[ext] || "video/mp4";

  const disp = forceDownload
    ? 'attachment; filename="digital_human_' + taskId + '.mp4"'
    : 'inline; filename="digital_human_' + taskId + '.mp4"';

  res.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": fileSize,
    "Content-Disposition": disp,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    "Access-Control-Allow-Origin": "*",
  });

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", () => {
    res.end();
  });
}

/* ---------- 工具 ---------- */
function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
}

function safeJoin(base, urlPath) {
  const target = path.normalize(path.join(base, urlPath));
  if (!target.startsWith(base)) return null;
  return target;
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(data);
  });
}

/* ---------- 主路由 ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (url.pathname === "/health" || url.pathname === "/api/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  // Key 管理
  if (url.pathname === "/api/keys" && req.method === "GET") return apiGetKeys(res);
  if (url.pathname === "/api/set-keys" && req.method === "POST") {
    return readBody(req).then((b) => apiSetKeys(b, res)).catch((e) => sendJson(res, 400, { ok: false, error: e.message }));
  }

  // 创建任务
  if (url.pathname === "/api/generate" && req.method === "POST") {
    return readBody(req).then((b) => apiGenerate(b, res)).catch((e) => sendJson(res, 400, { ok: false, error: e.message }));
  }

  // 查询任务状态
  if (url.pathname === "/api/task" && req.method === "GET") return apiTask(req, url, res);

  // 列出声音
  if (url.pathname === "/api/voices" && req.method === "GET") return apiVoices(req, url, res);

  // 视频代理（后端转发飞影 CDN 视频，解决跨域/防盗链）
  if (url.pathname === "/api/video-proxy" && req.method === "GET") return apiVideoProxy(req, url, res);

  // 视频本地缓存文件服务
  if (url.pathname === "/api/video-local" && req.method === "GET") return apiVideoLocal(req, url, res);

  // /files/* → output 目录
  if (url.pathname.startsWith("/files/")) {
    const fp = safeJoin(OUTPUT_DIR, url.pathname.slice("/files/".length));
    if (!fp) { res.writeHead(403); res.end("Forbidden"); return; }
    return serveFile(res, fp);
  }

  // 默认静态服务（gui/）
  const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const fullPath = safeJoin(APP_DIR, filePath);
  if (!fullPath) { res.writeHead(403); res.end("Forbidden"); return; }
  serveFile(res, fullPath);
});

/* ---------- 启动（端口被占用自动 +1，最多 10 次） ---------- */
let attempts = 0;
function startServer(port) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attempts < 10) {
      attempts++;
      console.log(`[提示] 端口 ${port} 被占用，尝试 ${port + 1} ...`);
      startServer(port + 1);
    } else {
      console.error("[错误] 服务器启动失败:", err.message);
      process.exit(1);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log("================================================");
    console.log("  飞影数字人 · 本地图形界面已启动");
    console.log("  " + url);
    console.log("  关闭本窗口即停止服务");
    console.log("================================================");
    const cmd =
      process.platform === "win32" ? `start "" "${url}"`
      : process.platform === "darwin" ? `open "${url}"`
      : `xdg-open "${url}"`;
    const { exec } = require("child_process");
    exec(cmd, (e) => { if (e) console.log("(请手动打开浏览器访问 " + url + ")"); });
  });
}
startServer(PORT);
