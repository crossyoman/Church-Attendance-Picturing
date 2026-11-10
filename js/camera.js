/* =========================================================
 * 카메라 / 효과음 / 사진 처리
 * ========================================================= */
const Camera = {
  stream: null,

  async start(video) {
    this.stop();
    // 센서 원본 화각(최대 광각/줌아웃)을 그대로 쓰기 위해 강제 해상도 크롭 없이 전면 카메라 요청
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
      },
      audio: false,
    });
    // 기기가 줌(화각) 제어를 지원하면 최소 배율(최대 줌아웃/광각)로 즉시 설정
    try {
      const track = this.stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities();
        if (caps && caps.zoom && typeof caps.zoom.min === 'number') {
          await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
        }
      }
    } catch (e) { }

    video.srcObject = this.stream;
    await video.play();
  },

  stop() {
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  },

  /**
   * 잘라내기(크롭) 없이 카메라 원본 전체 화각(최대 줌아웃 상태) 그대로 캡처하고 워터마크를 새깁니다
   */
  capture(video, lines) {
    const vw = video.videoWidth || 720, vh = video.videoHeight || 960;
    const maxSide = CONFIG.photoMaxSide || 1280;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, w, h);
    this.watermark(ctx, w, h, lines);
    return c;
  },

  /**
   * 이름표를 가리지 않도록 사진 하단 우측 끝에 작고 깔끔하게 워터마크 배치
   */
  watermark(ctx, w, h, lines) {
    const fs = Math.max(13, Math.round(Math.min(w, h) * 0.034));
    const lh = fs * 1.32;
    const padX = fs * 0.75, padY = fs * 0.55;
    ctx.font = `bold ${fs}px sans-serif`;

    let maxTextW = 0;
    lines.forEach((l, i) => {
      ctx.font = `${i === 0 ? '' : 'bold '}${i === 0 ? Math.round(fs * 0.85) : fs}px sans-serif`;
      const tw = ctx.measureText(l).width;
      if (tw > maxTextW) maxTextW = tw;
    });

    const boxW = Math.min(w * 0.65, maxTextW + padX * 2);
    const boxH = lines.length * lh + padY * 2;
    const boxX = w - boxW - padX * 0.8;
    const boxY = h - boxH - padY * 0.8;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    const rad = 10;
    ctx.beginPath();
    ctx.moveTo(boxX + rad, boxY);
    ctx.lineTo(boxX + boxW - rad, boxY);
    ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + rad);
    ctx.lineTo(boxX + boxW, boxY + boxH - rad);
    ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - rad, boxY + boxH);
    ctx.lineTo(boxX + rad, boxY + boxH);
    ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - rad);
    ctx.lineTo(boxX, boxY + rad);
    ctx.quadraticCurveTo(boxX, boxY, boxX + rad, boxY);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const textRightX = boxX + boxW - padX;
    lines.forEach((l, i) => {
      ctx.font = `${i === 0 ? '' : 'bold '}${i === 0 ? Math.round(fs * 0.85) : fs}px sans-serif`;
      ctx.fillStyle = i === 0 ? '#ffd76a' : '#ffffff';
      ctx.fillText(l, textRightX, boxY + padY + i * lh);
    });
    ctx.restore();
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
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur);
  },
  shutter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.08, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.25));
    const n = this.ctx.createBufferSource(), g = this.ctx.createGain();
    n.buffer = buf; g.gain.setValueAtTime(0.5, t);
    n.connect(g); g.connect(this.ctx.destination); n.start(t);
    this.beep(1200, 0.06);
  },
  chime() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => this.beep(f, 0.18), i * 90));
  },
};

/* =========================================================
 * 사진/엑셀 파일 변환 · 다운로드 · 메일 앱(공유창) 첨부 도우미
 * ========================================================= */
async function photoFiles(atts) {
  const files = [];
  const seen = new Set();
  for (const a of (atts || [])) {
    if (!a || !a.hasPhoto || seen.has(a.id)) continue;
    seen.add(a.id);
    const b = await Store.getPhoto(a.id);
    if (b) {
      files.push(new File([b], safeFileName(a.fileName || `${a.date}_${a.time}_${a.memberName || ''}`) + '.jpg', { type: 'image/jpeg' }));
    }
  }
  return files;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function downloadFiles(files) {
  for (const f of (files || [])) {
    downloadBlob(f, f.name);
    await sleep(320);
  }
}

/** 기기 공유창(Gmail 앱 등)으로 본문 + 사진/표 일괄 첨부 (사용자 터치 제스처 손실 방지) */
async function shareReport(title, text, files = []) {
  const validFiles = (files || []).filter(Boolean);
  if (typeof navigator.share === 'function') {
    try {
      if (validFiles.length && (!navigator.canShare || navigator.canShare({ files: validFiles }))) {
        await navigator.share({ title, text, files: validFiles });
        return true;
      } else {
        await navigator.share({ title, text });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      // 공유 중 에러 발생 시 원인 표시 후 다운로드 진행
      console.warn('[shareReport error]', e);
    }
  }
  // 공유 기능을 지원하지 않는 PC 브라우저 등: 본문 복사 + 파일 자동 다운로드
  try { await navigator.clipboard.writeText(text); } catch (e) {}
  await Modal.alert(
    `이 브라우저에서는 앱 공유창을 열 수 없어 <b>본문을 클립보드에 복사</b>하고, <b>파일(${validFiles.length}개)을 자동 다운로드</b>합니다.`
  );
  await downloadFiles(validFiles);
  return false;
}
