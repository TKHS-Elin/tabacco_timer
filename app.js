const INTERVAL_MS = 10 * 60 * 1000;
const app = document.querySelector("#timer-app");
const timerStatus = document.querySelector("#timer-status");
const timeMain = document.querySelector("#time-main");
const phaseName = document.querySelector("#phase-name");
const tapHint = document.querySelector("#tap-hint");
const availabilityNote = document.querySelector("#availability-note");

let isRunning = false;
let phase = "buzzer";
let phaseEndsAt = 0;
let frameId = 0;
let wakeLock = null;
let wakeLockRequest = null;
let audioContext = null;
let hasStarted = false;

function formatTime(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function setPhase(nextPhase) {
  phase = nextPhase;
  app.classList.toggle("phase-buzzer", phase === "buzzer");
  app.classList.toggle("phase-chime", phase === "chime");
  phaseName.textContent = phase === "buzzer" ? "ブザーのカウント" : "チャイムのカウント";
}

function renderTime(now = performance.now()) {
  const remaining = isRunning ? phaseEndsAt - now : INTERVAL_MS;
  timeMain.textContent = formatTime(Math.max(0, remaining));
}

function playBuzzer() {
  if (!audioContext || audioContext.state !== "running") return;

  const now = audioContext.currentTime;
  for (const [frequency, volume] of [[220, 0.055], [224, 0.035]]) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.04);
    gain.gain.setValueAtTime(volume, now + 1.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 1.22);
  }
}

function playChime() {
  if (!audioContext || audioContext.state !== "running") return;

  const now = audioContext.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const startAt = now + index * 0.23;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(0.16, startAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.72);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.74);
  });
}

function playPhaseSound(completedPhase) {
  if (completedPhase === "buzzer") playBuzzer();
  else playChime();
}

async function enableAudio() {
  try {
    if (!("AudioContext" in window)) {
      throw new Error("このブラウザーはWeb Audio APIに対応していません");
    }

    audioContext ??= new AudioContext();
    if (audioContext.state !== "running") await audioContext.resume();
    if (audioContext.state !== "running") {
      throw new Error(`音声コンテキストの状態: ${audioContext.state}`);
    }
    if (availabilityNote.textContent.startsWith("音声")) availabilityNote.textContent = "";
  } catch (error) {
    console.error("タイマー音を有効にできませんでした:", error);
    availabilityNote.textContent = "音声を再生できません。端末の音量とブラウザー設定を確認してください。";
  }
}

async function requestWakeLock() {
  if (document.hidden || wakeLock || wakeLockRequest) return;
  let request;

  try {
    if (!("wakeLock" in navigator)) {
      availabilityNote.textContent = "このブラウザーでは画面のスリープを抑止できません。";
      return;
    }

    request = navigator.wakeLock.request("screen");
    wakeLockRequest = request;
    const lock = await request;
    if (wakeLockRequest === request) wakeLockRequest = null;
    if (document.hidden) {
      await lock.release();
      return;
    }

    wakeLock = lock;
    lock.addEventListener("release", () => {
      if (wakeLock !== lock) return;
      wakeLock = null;
      if (!document.hidden) void requestWakeLock();
    });
    if (availabilityNote.textContent.startsWith("このブラウザー") ||
        availabilityNote.textContent.startsWith("画面の点灯")) {
      availabilityNote.textContent = "";
    }
  } catch (error) {
    if (wakeLockRequest === request) wakeLockRequest = null;
    console.error("画面のスリープを抑止できませんでした:", error);
    availabilityNote.textContent = "画面の点灯を維持できません。端末の設定を確認してください。";
  }
}

function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock) {
    lock.release().catch((error) => {
      console.error("画面のスリープ抑止を解除できませんでした:", error);
    });
  }
}

function updateInterface() {
  app.classList.toggle("is-running", isRunning);
  timerStatus.textContent = isRunning
    ? phase === "buzzer" ? "ブザーまで" : "チャイムまで"
    : "待機中";
  tapHint.textContent = isRunning ? "画面をタップして停止・リセット" : "画面をタップして開始";
  app.setAttribute(
    "aria-label",
    `10分タイマー。${isRunning ? `${phase === "buzzer" ? "ブザー" : "チャイム"}のカウント中。画面をタップして停止` : "画面をタップして開始"}`
  );
}

function tick() {
  if (!isRunning) return;

  const now = performance.now();
  if (now >= phaseEndsAt) {
    const transitions = Math.floor((now - phaseEndsAt) / INTERVAL_MS) + 1;
    phaseEndsAt += transitions * INTERVAL_MS;
    const otherPhase = phase === "buzzer" ? "chime" : "buzzer";
    const completedPhase = transitions % 2 === 1 ? phase : otherPhase;
    if (transitions % 2 === 1) setPhase(otherPhase);
    playPhaseSound(completedPhase);
    updateInterface();
  }

  renderTime(now);
  frameId = requestAnimationFrame(tick);
}

function startTimer() {
  isRunning = true;
  hasStarted = true;
  setPhase("buzzer");
  phaseEndsAt = performance.now() + INTERVAL_MS;
  updateInterface();
  renderTime();
  frameId = requestAnimationFrame(tick);
  void enableAudio();
  void requestWakeLock();
}

function stopTimer() {
  isRunning = false;
  cancelAnimationFrame(frameId);
  setPhase("buzzer");
  updateInterface();
  renderTime();
}

function handleTap() {
  if (isRunning) stopTimer();
  else startTimer();
}

app.addEventListener("click", handleTap);
app.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleTap();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(frameId);
  } else {
    if (hasStarted) void requestWakeLock();
    if (isRunning) {
      void enableAudio();
      cancelAnimationFrame(frameId);
      tick();
    }
  }
});

window.addEventListener("pagehide", releaseWakeLock);
window.addEventListener("pageshow", () => {
  if (hasStarted && !document.hidden) void requestWakeLock();
});

setPhase("buzzer");
updateInterface();
renderTime();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("オフライン利用の設定に失敗しました:", error);
      availabilityNote.textContent = "オフライン利用の設定に失敗しました。";
    });
  });
}
