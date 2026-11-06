/* =========================================================
 * 카메라 / 효과음 / 사진 처리
 * ========================================================= */
const Camera = {
  stream: null,

  async start(video) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    video.srcObject = this.stream;
    await video.play();
  },

  stop() {
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  },

  /** 현재 화면을 캡처하고 워터마크를 새깁니다 */
  capture(video, lines) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(1, CONFIG.photoMaxSide / Math.max(vw, vh));
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    this.watermark(ctx, w, h, lines);
    return c;
  },

  watermark(ctx, w, h, lines) {
    const fs = Math.max(14, Math.round(Math.min(w, h) * 0.045));
    const lh = fs * 1.35, padd = fs * 0.6;
    const boxH = lines.length * lh + padd * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - boxH, w, boxH);
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.font = `${i === 0 ? '' : 'bold '}${i === 0 ? Math.round(fs * 0.8) : fs}px sans-serif`;
      ctx.fillStyle = i === 0 ? '#ffd76a' : '#ffffff';
      ctx.fillText(l, padd, h - boxH + padd + i * lh);
    });
  },

  /** 약 500KB 이하가 되도록 JPEG 품질을 조절 */
  async toBlob(canvas) {
    let q = 0.88, blob = null;
    for (let i = 0; i < 7; i++) {
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
      if (blob.size <= CONFIG.photoMaxBytes) break;
      q -= 0.1;
    }
    return blob;
  },
};

/* 효과음: 파일 없이 Web Audio 로 생성 (무리 없이 동작) */
const Sound = {
  ctx: null,
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.ctx = null; }
  },
  beep(freq = 880, dur = 0.12) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur);
  },
  shutter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, len = Math.floor(this.ctx.sampleRate * 0.12);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = i < len * 0.3 ? 1 : Math.pow(1 - (i - len * 0.3) / (len * 0.7), 3);
      data[i] = (Math.random() * 2 - 1) * env * (i < len * 0.08 || (i > len * 0.4 && i < len * 0.5) ? 1 : 0.35);
    }
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf; g.gain.value = 0.6;
    src.connect(g).connect(this.ctx.destination); src.start(t);
  },
  chime() {
    [784, 988, 1175].forEach((f, i) => setTimeout(() => this.beep(f, 0.25), i * 140));
  },
};

/* 사진 공유/저장 도우미 */
async function photoFiles(atts) {
  const files = [];
  for (const a of atts) {
    if (!a.hasPhoto) continue;
    const b = await Store.getPhoto(a.id);
    if (b) files.push(new File([b], safeFileName(a.fileName) + '.jpg', { type: 'image/jpeg' }));
  }
  return files;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function downloadFiles(files) {
  for (const f of files) { downloadBlob(f, f.name); await sleep(350); }
}

/** 안드로이드 공유창(Gmail 등)으로 본문 + 사진 개별 첨부 */
async function shareReport(title, text, files) {
  const data = { title, text, files };
  if (navigator.canShare && files.length && navigator.canShare({ files })) {
    try { await navigator.share(data); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  } else if (navigator.share && !files.length) {
    try { await navigator.share({ title, text }); return true; } catch (e) { return false; }
  }
  // 공유 미지원 기기: 본문 복사 + 사진 개별 다운로드
  try { await navigator.clipboard.writeText(text); } catch (e) { /* 무시 */ }
  await Modal.alert('이 기기는 공유 기능을 지원하지 않아요.<br>본문은 클립보드에 복사했고, 사진은 개별 파일로 내려받습니다.');
  await downloadFiles(files);
  return false;
}
