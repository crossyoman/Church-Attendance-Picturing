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

/**
 * 기기 공유창(안드로이드 Gmail 앱 등) 또는 데스크탑 Gmail 웹으로 메일 발송
 * - 파일명에 공백이나 특수문자가 있으면 안드로이드 WebShare 임시 파일 URI 생성 시 깨져서
 *   Gmail에 빈 메일로 열리는 버그가 있으므로 파일명을 안전한 문자(언더바)로 정규화.
 */
async function shareReport(title, text, files = [], extraDownloadFiles = []) {
  const validFiles = (files || []).filter(Boolean).map(f => {
    const cleanName = String(f.name || 'attachment')
      .replace(/\s+/g, '_')
      .replace(/[()[\]{}:*?"<>|\\/,;']/g, '_');
    return cleanName === f.name ? f : new File([f], cleanName, { type: f.type });
  });

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  if (isMobile && typeof navigator.share === 'function') {
    try {
      // 클립보드에도 본문을 미리 복사해 두어 만일의 경우 바로 붙여넣기 가능하게 보장
      try { await navigator.clipboard.writeText(text); } catch (e) {}

      if (validFiles.length && (!navigator.canShare || navigator.canShare({ files: validFiles }))) {
        await navigator.share({ title, text, files: validFiles });
        return true;
      } else {
        await navigator.share({ title, text });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      console.warn('[shareReport error]', e);
    }
  }

  // 데스크탑 PC 브라우저이거나 모바일 공유가 지원되지 않는 경우:
  // 본문 복사 + 파일 자동 다운로드 + Gmail 웹 작성창(또는 기본 메일앱) 오픈
  try { await navigator.clipboard.writeText(text); } catch (e) {}
  const dlList = (extraDownloadFiles && extraDownloadFiles.length)
    ? extraDownloadFiles.filter(Boolean)
    : validFiles;

  let adminEmail = (typeof CONFIG !== 'undefined' && CONFIG.defaultAdminEmail) ? CONFIG.defaultAdminEmail : 'crossyoman@gmail.com';
  try {
    if (typeof Store !== 'undefined' && Store.settings) {
      const s = await Store.settings();
      if (s && s.adminEmail) adminEmail = s.adminEmail;
    }
  } catch (e) {}

  const openGmail = await Modal.confirm(
    `<b>출석 엑셀 및 달성자 사진 파일(${dlList.length}개)을 자동 다운로드</b>하고 <b>메일 본문을 클립보드에 복사</b>합니다.<br><br>` +
    `지금 바로 <b>Gmail 메일 쓰기 창</b>을 열까요?<br>` +
    `<span class="muted">(수신자·제목·본문이 자동으로 채워진 상태로 열리며, 방금 다운로드된 엑셀/사진 파일만 첨부하시면 됩니다.)</span>`,
    '📧 Gmail 메일창 열기 + 파일 다운로드',
    '💾 파일만 다운로드'
  );

  if (openGmail) {
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(adminEmail)}&su=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
    window.open(gmailUrl, '_blank', 'noopener');
  }
  await downloadFiles(dlList);
  return false;
}
