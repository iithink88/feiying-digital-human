/* app.js — 飞影数字人 前端逻辑（纯原生 JS，无框架） */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clock = $("clock");
  setInterval(() => { clock.textContent = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }, 1000);

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- 设置弹窗 ----------
  const overlay = $("setOverlay");
  $("settingsBtn").addEventListener("click", openSettings);
  $("setClose").addEventListener("click", () => overlay.classList.remove("show"));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("show"); });

  function openSettings() {
    // 拉取已保存的 key（脱敏），填充到表单
    fetch("/api/keys").then((r) => r.json()).then((d) => {
      const keys = (d && d.keys) || {};
      const wrap = $("keyFields");
      wrap.innerHTML = "";
      const row = document.createElement("div");
      row.className = "key-row";
      row.innerHTML = '<label>飞影 API Token（写入 .env 的 HIFLY_API_TOKEN）</label>' +
        '<input class="field" id="envToken" placeholder="粘贴 Token，留空则不修改">';
      wrap.appendChild(row);
      const inp = $("envToken");
      if (keys.HIFLY_API_TOKEN) inp.placeholder = "当前已保存：" + keys.HIFLY_API_TOKEN + "（留空保留）";
      overlay.classList.add("show");
    }).catch(() => overlay.classList.add("show"));
  }

  $("setSave").addEventListener("click", () => {
    const v = $("envToken").value.trim();
    const keys = {};
    if (v) keys.HIFLY_API_TOKEN = v;
    fetch("/api/set-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }).then((r) => r.json()).then((d) => {
      if (d.ok) {
        toast("已保存，刷新环境");
        overlay.classList.remove("show");
        checkEnv();
        if (v) $("tokenInput").value = v;
      } else {
        toast("保存失败：" + (d.error || ""));
      }
    }).catch((e) => toast("保存失败：" + e.message));
  });

  // ---------- 环境/Tiken 状态检测 ----------
  function checkEnv() {
    const dot = $("envState");
    const tok = $("tokenInput").value.trim();
    if (tok) { dot.classList.add("ok"); dot.title = "Token 已填"; }
    else {
      fetch("/api/keys").then((r) => r.json()).then((d) => {
        const saved = d && d.keys && d.keys.HIFLY_API_TOKEN;
        if (saved) { dot.classList.add("ok"); dot.title = "已保存 Token：" + saved; }
        else { dot.classList.remove("ok"); dot.title = "未配置飞影 Token"; }
      }).catch(() => { dot.classList.remove("ok"); });
    }
  }
  $("tokenInput").addEventListener("input", checkEnv);
  checkEnv();

  // ---------- 进度辅助 ----------
  function setProgress(pct, label) {
    $("progressBar").style.width = Math.max(0, Math.min(100, pct)) + "%";
    if (label) $("stepLabel").textContent = label;
  }
  function log(msg) {
    const box = $("genLog");
    box.classList.remove("hidden");
    box.textContent += (box.textContent ? "\n" : "") + msg;
    box.scrollTop = box.scrollHeight;
  }

  // ---------- 生成流程 ----------
  let polling = false;
  let pollTimer = null;

  async function generate() {
    if (polling) return;
    const token = $("tokenInput").value.trim();
    const avatar = $("avatarInput").value.trim();
    const voice = $("voiceInput").value.trim();
    const text = $("textInput").value.trim();
    if (!token) { toast("请先填飞影 API Token"); return; }
    if (!avatar) { toast("请填数字人ID"); return; }
    if (!voice) { toast("请填声音ID"); return; }
    if (!text) { toast("请填口播文案"); return; }

    $("genBtn").disabled = true;
    $("videoWrap").classList.add("hidden");
    $("genLog").textContent = "";
    $("genLog").classList.remove("hidden");
    setProgress(5, "正在提交任务…");
    log("提交参数：avatar=" + avatar + " voice=" + voice);

    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, avatar, voice, text,
          subtitle: $("subtitleChk").checked ? 1 : 0,
          aigc_flag: $("aigcChk").checked ? 2 : 0,
        }),
      });
      const d = await resp.json();
      if (!d.ok) {
        log("❌ " + (d.error || "创建失败"));
        setProgress(0, "创建失败");
        $("genBtn").disabled = false;
        return;
      }
      log("✅ 任务已创建，task_id=" + d.task_id);
      setProgress(12, "生成中（轮询状态）…");
      pollLoop(token, d.task_id);
    } catch (e) {
      log("❌ 网络错误：" + e.message);
      setProgress(0, "出错");
      $("genBtn").disabled = false;
    }
  }

  function pollLoop(token, taskId) {
    polling = true;
    let n = 0;
    const tick = async () => {
      n++;
      try {
        const resp = await fetch("/api/task?token=" + encodeURIComponent(token) + "&task_id=" + encodeURIComponent(taskId));
        const d = await resp.json();
        if (!d.ok) {
          log("轮询#" + n + " 异常：" + (d.error || ""));
          setProgress(40, "查询异常，重试中…");
        } else {
          setProgress(d.progress || 0, d.statusText + "（轮询 #" + n + "）");
          log("轮询#" + n + " → " + d.statusText + (d.video_url ? " 拿到链接" : ""));
          if (d.status === 3) { finish(d.video_url, taskId, token); return; }
          if (d.status === 4) {
            log("❌ 生成失败：" + (d.error || ""));
            setProgress(0, "生成失败");
            stopPoll();
            return;
          }
        }
      } catch (e) {
        log("轮询#" + n + " 网络错误：" + e.message);
      }
      pollTimer = setTimeout(tick, 8000); // 每 8 秒，对应原工作流循环 10s
    };
    tick();
  }

  function stopPoll() {
    polling = false;
    if (pollTimer) clearTimeout(pollTimer);
    $("genBtn").disabled = false;
  }

  function finish(videoUrl, taskId, token) {
    stopPoll();
    setProgress(100, "已完成 🎉");
    log("🎉 完成：" + (videoUrl || "(链接获取中…)"));
    const wrap = $("videoWrap");
    wrap.classList.remove("hidden");

    // 构造代理 URL（后端代理解决飞影 CDN 防盗链/CORS）
    const proxyUrl = "/api/video-proxy?task_id=" + encodeURIComponent(taskId) + "&token=" + encodeURIComponent(token);
    // 下载专用 URL（加 download=1 触发 attachment 响应头）
    const downloadUrl = proxyUrl + "&download=1";
    // 官网作品管理页（终极兜底：代理失败时用户可以去官网看/下载）
    const officialPage = "https://hifly.cc/video";

    // <video> 播放源：走后端代理（inline 模式）
    $("videoEl").src = proxyUrl;
    // 监听视频加载失败，提示用户用兜底方案
    $("videoEl").onerror = function() {
      log("⚠️ 本地播放加载失败，请点击「去官网查看」");
      toast("播放失败，请用「去官网查看」按钮");
    };

    // "新窗口打开" → 官网作品页（CDN 直链可能有防盗链）
    $("openLink").href = officialPage;
    $("openLink").target = "_blank";

    // "复制链接" → 复制官网地址
    $("copyLink").dataUrl = officialPage;

    // 下载区域：代理下载(attachment) + 官网兜底
    const dl = $("dlWrap");
    dl.innerHTML = "";
    // 代理下载按钮（download=1 → 服务端返回 Content-Disposition: attachment）
    const aProxy = document.createElement("a");
    aProxy.className = "btn-main";
    aProxy.style.textDecoration = "none";
    aProxy.textContent = "下载视频";
    aProxy.href = downloadUrl;
    aProxy.setAttribute("download", "digital_human_" + (taskId || "video") + ".mp4");
    aProxy.target = "_blank";
    dl.appendChild(aProxy);
    // 兜底：去官网查看/下载
    const aOfficial = document.createElement("a");
    aOfficial.className = "btn-main";
    aOfficial.style.textDecoration = "none";
    aOfficial.style.marginLeft = "8px";
    aOfficial.style.fontSize = "13px";
    aOfficial.textContent = "去官网查看 ↗";
    aOfficial.href = officialPage;
    aOfficial.target = "_blank";
    dl.appendChild(aOfficial);

    toast("数字人视频已生成 ✅");
  }

  $("copyLink").addEventListener("click", () => {
    const url = $("copyLink").dataUrl || "https://hifly.cc/video";
    if (!url) { toast("还没有链接"); return; }
    navigator.clipboard.writeText(url).then(() => toast("已复制官网链接")).catch(() => toast("复制失败，请手动复制"));
  });

  $("genBtn").addEventListener("click", generate);

  $("resetBtn").addEventListener("click", () => {
    $("tokenInput").value = "";
    $("avatarInput").value = "";
    $("voiceInput").value = "";
    $("textInput").value = "";
    $("genLog").textContent = "已清空。";
    setProgress(0, "等待开始…");
    $("videoWrap").classList.add("hidden");
    checkEnv();
  });
})();
