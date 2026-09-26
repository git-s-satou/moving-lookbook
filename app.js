(() => {
  "use strict";

  const videos = {
    a: document.querySelector("#videoA"),
    ab: document.querySelector("#videoAToB"),
    b: document.querySelector("#videoB"),
    ba: document.querySelector("#videoBToA"),
  };
  const sources = {
    a: "assets/a-loop.mp4",
    ab: "assets/a-to-b.mp4",
    b: "assets/b-loop.mp4",
    ba: "assets/b-to-a.mp4",
  };
  const status = document.querySelector("#videoStatus");
  const title = document.querySelector("#statusTitle");
  const detail = document.querySelector("#statusText");
  const live = document.querySelector("#liveRegion");
  const retry = document.querySelector("#retryBtn");
  const retryInline = document.querySelector("#retryInline");
  const start = document.querySelector("#startBtn");
  const toggle = document.querySelector("#playToggle");
  const caption = document.querySelector("#lookCaption");
  const radios = [...document.querySelectorAll('input[name="top"]')];
  const labels = Object.fromEntries(["a", "b"].map(key => [key, document.querySelector(`[data-state-for="${key}"]`)]));
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const image of document.querySelectorAll(".thumb img")) {
    const loaded = () => image.closest(".thumb").classList.toggle("has-image", image.naturalWidth > 0);
    image.addEventListener("load", loaded);
    image.addEventListener("error", loaded);
    if (image.complete) loaded();
  }
  const ready = { a: false, ab: false, b: false, ba: false };
  let current = "a";
  let desired = "a";
  let active = null;
  let phase = "loading"; // loading, loop, transition, manual, error
  let paused = false;
  let failed = false;
  let requestAt = 0;
  let transitionAt = 0;
  let playVersion = 0;
  let manualTarget = "a";

  function announce(message) { live.textContent = message; }
  function overlay(heading, message, retryable = false, startable = false) {
    title.textContent = heading;
    detail.textContent = message;
    retry.hidden = !retryable;
    start.hidden = !startable;
    status.classList.add("is-shown");
  }
  function hideOverlay() { status.classList.remove("is-shown"); }
  function visible(key) {
    for (const [name, video] of Object.entries(videos)) video.classList.toggle("is-visible", name === key);
    active = key;
  }
  function render() {
    const changing = phase === "transition";
    for (const radio of radios) {
      radio.disabled = phase === "loading" || phase === "error" || changing;
      radio.checked = radio.value === desired;
    }
    for (const key of ["a", "b"]) {
      labels[key].textContent = phase === "loading" || phase === "error" ? "" :
        changing && key === desired ? "着替え中" :
        key === current && key === desired ? "✓ 着用中" :
        key === current ? "着用中" : key === desired ? "選択中" : "";
    }
    toggle.disabled = phase === "loading" || phase === "error";
    toggle.textContent = paused || phase === "manual" ? "再生" : "一時停止";
    retryInline.hidden = !failed || phase === "error";
    caption.textContent = current === "a" ? "LOOK 01 / IVORY" : "LOOK 02 / INK NAVY";
  }
  function ensure(key, force = false) {
    const video = videos[key];
    if (video.src && !force) return;
    ready[key] = false;
    video.src = sources[key] + (force ? `?retry=${Date.now()}` : "");
    video.load();
  }
  function needed() { return desired === "b" ? ["ab", "b"] : ["ba", "a"]; }
  function prepare() {
    if (desired === current) return;
    for (const key of needed()) ensure(key);
    if (!needed().every(key => ready[key])) announce("選択中・まもなく着替えます。動画を準備しています。");
    else announce("選択中・まもなく着替えます。");
  }
  async function play(key) {
    const version = ++playVersion;
    try {
      await videos[key].play();
      if (videos[key].requestVideoFrameCallback) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 300);
          videos[key].requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
        });
      }
      if (version !== playVersion) { videos[key].pause(); return false; }
      return true;
    } catch (error) {
      if (version === playVersion && error.name !== "AbortError") console.warn("動画を再生できません", key, error);
      return false;
    }
  }
  async function beginLoop(key, reset = false) {
    if (reset) videos[key].currentTime = 0;
    const played = await play(key);
    if (!played) {
      phase = "manual";
      paused = true;
      manualTarget = key;
      overlay("再生を開始してください", "自動再生が許可されていません。", false, true);
      announce("再生を開始してください。");
      render();
      return;
    }
    if (active && active !== key) videos[active].pause();
    visible(key);
    current = key;
    phase = "loop";
    paused = false;
    hideOverlay();
    if (transitionAt) {
      const end = performance.now();
      console.info(`着替え完了: 選択から ${Math.round(end - requestAt)}ms、開始から ${Math.round(end - transitionAt)}ms`);
      transitionAt = 0;
      failed = false;
    }
    announce("着用中です。");
    render();
    ensure(key === "a" ? "ab" : "ba");
    ensure(key === "a" ? "b" : "a");
    if (desired !== current && !failed) prepare();
  }
  async function beginTransition() {
    const target = desired;
    const key = target === "b" ? "ab" : "ba";
    phase = "transition";
    render();
    videos[key].currentTime = 0;
    if (!await play(key)) {
      phase = "loop";
      failed = true;
      announce("着替え動画を再生できません。再試行してください。");
      render();
      await beginLoop(current, true);
      return;
    }
    if (active) videos[active].pause();
    visible(key);
    transitionAt = performance.now();
    console.info(`着替え開始: 選択から ${Math.round(transitionAt - requestAt)}ms`);
    announce("着替え中です。");
  }
  async function onLoopEnd(key) {
    if (phase !== "loop" || active !== key) return;
    if (desired !== current && !failed && needed().every(name => ready[name])) await beginTransition();
    else {
      if (desired !== current && !failed) prepare();
      await beginLoop(current, true);
    }
  }
  async function onTransitionEnd(key) {
    if (phase !== "transition" || active !== key) return;
    const target = key === "ab" ? "b" : "a";
    videos[target].currentTime = 0;
    await beginLoop(target);
  }
  function mediaError(key) {
    ready[key] = false;
    if (key === "a" && phase === "loading") {
      phase = "error";
      overlay("動画素材を読み込めません", `${sources[key]} を配置して再試行してください。`, true);
      announce("動画素材を読み込めません。再試行してください。");
    } else if (key === active || (desired !== current && needed().includes(key))) {
      failed = true;
      announce(`${sources[key]} を読み込めません。再試行してください。`);
    }
    render();
  }
  for (const [key, video] of Object.entries(videos)) {
    video.addEventListener("loadeddata", () => {
      ready[key] = true;
      if (key === "a" && phase === "loading") {
        visible("a");
        if (reducedMotion) {
          phase = "manual";
          paused = true;
          overlay("再生待ち", "動きを抑える設定が有効です。再生を開始してください。", false, true);
          announce("再生待ちです。");
          render();
        } else beginLoop("a");
      } else if (desired !== current && needed().every(name => ready[name]) && !failed) {
        announce("選択中・まもなく着替えます。");
      }
    });
    video.addEventListener("error", () => mediaError(key));
    video.addEventListener("ended", () => key === "a" || key === "b" ? onLoopEnd(key) : onTransitionEnd(key));
  }
  for (const radio of radios) radio.addEventListener("change", () => {
    if (!radio.checked || phase === "transition") return;
    desired = radio.value;
    failed = false;
    if (desired !== current) {
      requestAt = performance.now();
      prepare();
    } else announce("着用中です。");
    render();
  });
  async function resume() {
    if (phase === "manual") {
      if (!ready[manualTarget]) return;
      await beginLoop(manualTarget);
    } else if (active && paused) {
      if (await play(active)) { paused = false; hideOverlay(); announce("再生中です。"); render(); }
      else overlay("再生できません", "再生を開始してください。", false, true);
    }
  }
  toggle.addEventListener("click", () => {
    if (paused || phase === "manual") resume();
    else if (active) {
      ++playVersion;
      videos[active].pause();
      paused = true;
      announce("一時停止中です。");
      render();
    }
  });
  start.addEventListener("click", resume);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && active && !paused && videos[active].paused) play(active);
  });
  function retryMedia() {
    failed = false;
    if (phase === "error") {
      phase = "loading";
      overlay("動画を読み込んでいます", "しばらくお待ちください。");
      ensure("a", true);
    } else {
      for (const key of needed()) if (!ready[key]) ensure(key, true);
      prepare();
    }
    render();
  }
  retry.addEventListener("click", retryMedia);
  retryInline.addEventListener("click", retryMedia);
  render();
  ensure("a");
})();
