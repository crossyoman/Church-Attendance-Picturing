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
 * 메일/공유 본문용 안전한 텍스트 생성 (URL 길이 초과 Error 400 및 모바일 인텐트 제한 방지)
 * - encodeURIComponent 길이와 문자 길이가 모두 한도 이하이면 원문 그대로 반환
 * - 초과 시 앞부분 요약만 남기고 클립보드 붙여넣기 안내 문구를 붙여 반환
 */
function buildSafeEmailBody(text, maxEncodedLen = 1600, maxCharLen = 1500) {
  const raw = String(text || '');
  if (encodeURIComponent(raw).length <= maxEncodedLen && raw.length <= maxCharLen) return raw;

  const fullNotice = [
    '',
    '...(이하 상세 명단 및 통계 생략)...',
    '',
    '--------------------',
    '📋 [안내] 전체 상세 출석 명단 및 통계 본문은 클립보드에 자동 복사되었습니다.',
    '👉 메일 본문에서 붙여넣기(Ctrl+V 또는 길게 눌러 붙여넣기) 해주세요.',
    '📎 방금 다운로드된 엑셀/사진 파일을 첨부해 주세요!',
    '--------------------',
  ].join('\n');

  const shortNotice = '\n\n...(상세 내용 생략 - 전체 본문이 클립보드에 복사되었습니다. 붙여넣기 Ctrl+V 해주세요)...';
  const notice = (
    encodeURIComponent(fullNotice).length <= maxEncodedLen - 120 &&
    fullNotice.length <= maxCharLen - 80
  ) ? fullNotice : shortNotice;

  const encodedBudget = maxEncodedLen - encodeURIComponent(notice).length;
  const charBudget = maxCharLen - notice.length;
  if (encodedBudget <= 0 || charBudget <= 0) return notice.trimStart();

  const kept = [];
  for (const line of raw.split('\n')) {
    const candidate = kept.length ? `${kept.join('\n')}\n${line}` : line;
    if (candidate.length > charBudget || encodeURIComponent(candidate).length > encodedBudget) break;
    kept.push(line);
  }
  return (kept.length ? kept.join('\n') : '') + notice;
}

/** 클립보드 복사 (Clipboard API 우선, 실패 시 textarea 폴백) */
async function copyReportText(text) {
  const raw = String(text || '');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(raw);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = raw;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

/** await 없이 클립보드 복사만 시작 (모바일 navigator.share / window.open 제스처 보존용) */
function triggerAsyncClipboardCopy(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text || '')).catch(() => {});
    }
  } catch (e) {}
}

/** 모바일 기본 공유창 다단계 호출 (1차: 파일+본문, 2차: 파일만, 3차: 본문만) */
async function tryMobileShare(title, mobileText, validFiles, dlList) {
  if (typeof navigator.share !== 'function') return 'failed';

  const canShareFiles = validFiles.length > 0 && (!navigator.canShare || (() => {
    try { return navigator.canShare({ files: validFiles }); } catch (e) { return false; }
  })());

  if (canShareFiles) {
    try {
      await navigator.share({ title, text: mobileText, files: validFiles });
      return 'shared';
    } catch (e1) {
      if (e1 && e1.name === 'AbortError') return 'abort';
      if (e1 && e1.name === 'NotAllowedError') return 'needs_gesture';
      console.warn('[shareReport file+text failed]', e1);
      try {
        await navigator.share({ title, files: validFiles });
        return 'shared';
      } catch (e2) {
        if (e2 && e2.name === 'AbortError') return 'abort';
        if (e2 && e2.name === 'NotAllowedError') return 'needs_gesture';
        console.warn('[shareReport files-only failed]', e2);
      }
    }
  }

  try {
    await navigator.share({ title, text: mobileText });
    if (validFiles.length && dlList.length) {
      await downloadFiles(dlList);
    }
    return 'shared';
  } catch (e3) {
    if (e3 && e3.name === 'AbortError') return 'abort';
    if (e3 && e3.name === 'NotAllowedError') return 'needs_gesture';
    console.warn('[shareReport text-only failed]', e3);
    return 'failed';
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

  const dlList = (extraDownloadFiles && extraDownloadFiles.length)
    ? extraDownloadFiles.filter(Boolean)
    : validFiles;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const mobileText = buildSafeEmailBody(text, 4500, 1500);
  let mobileResult = 'failed';

  if (isMobile && typeof navigator.share === 'function') {
    // 사용자 제스처(Transient Activation) 보존을 위해 await 없이 클립보드 복사를 먼저 시작하고 즉시 공유 호출
    triggerAsyncClipboardCopy(text);
    mobileResult = await tryMobileShare(title, mobileText, validFiles, dlList);
    if (mobileResult === 'shared') return true;
    if (mobileResult === 'abort') return false;
  }

  // 데스크탑 PC 브라우저이거나 모바일 공유가 지원되지 않는(또는 제스처가 만료된) 경우:
  // 전체 본문 복사 + 길이 안전 Gmail 웹 작성창 오픈 + 파일 다운로드
  await copyReportText(text);

  let adminEmail = (typeof CONFIG !== 'undefined' && CONFIG.defaultAdminEmail) ? CONFIG.defaultAdminEmail : 'crossyoman@gmail.com';
  try {
    if (typeof Store !== 'undefined' && Store.settings) {
      const s = await Store.settings();
      if (s && s.adminEmail) adminEmail = s.adminEmail;
    }
  } catch (e) {}

  const baseGmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(adminEmail)}&su=${encodeURIComponent(title)}&body=`;
  const maxBodyEncoded = Math.max(800, 1900 - baseGmailUrl.length);
  const safeBody = buildSafeEmailBody(text, Math.min(1600, maxBodyEncoded), 1500);
  const gmailUrl = baseGmailUrl + encodeURIComponent(safeBody);
  const isTruncated = safeBody !== String(text || '');

  const fileNoticeHtml = dlList.length
    ? `<b>출석 엑셀/사진 파일(${dlList.length}개)을 자동 다운로드</b>하고 `
    : '';
  const bodyNotice = isTruncated
    ? '전체 본문이 길어 메일 창에는 요약본만 먼저 채워집니다. 열린 메일 본문에서 <b>붙여넣기(Ctrl+V)</b>를 하고 다운로드된 파일을 첨부해 주세요.'
    : '수신자·제목·본문이 자동으로 채워진 상태로 열리며, 방금 다운로드된 엑셀/사진 파일만 첨부하시면 됩니다.';

  const openGmail = await Modal.confirm(
    `${fileNoticeHtml}<b>전체 메일 본문을 클립보드에 복사</b>했습니다.<br><br>` +
    `지금 바로 <b>${isMobile ? '메일 앱(공유) 또는 Gmail' : 'Gmail 메일 쓰기 창'}</b>을 열까요?<br>` +
    `<span class="muted">(${bodyNotice})</span>`,
    isMobile ? '📧 메일 보내기 + 파일 준비' : '📧 Gmail 메일창 열기 + 파일 다운로드',
    dlList.length ? '💾 파일만 다운로드' : '닫기'
  );

  if (openGmail) {
    triggerAsyncClipboardCopy(text);
    if (isMobile && mobileResult === 'needs_gesture' && typeof navigator.share === 'function') {
      const retryResult = await tryMobileShare(title, mobileText, validFiles, dlList);
      if (retryResult === 'shared') return true;
      if (retryResult === 'abort') return false;
    }
    window.open(gmailUrl, '_blank', 'noopener');
  } else {
    await copyReportText(text);
  }

  if (dlList.length) {
    await downloadFiles(dlList);
  }
  return false;
}
