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
   * 얼굴·이름표가 가려지지 않도록 사진 우측 맨위 상단에 한 줄 워터마크 배치
   */
  watermark(ctx, w, h, lines) {
    const text = (Array.isArray(lines) ? lines.filter(Boolean).join(' ') : String(lines || '')).trim();
    if (!text) return;

    let fs = Math.max(12, Math.round(Math.min(w, h) * 0.028));
    ctx.save();
    ctx.font = `bold ${fs}px sans-serif`;
    const maxW = w * 0.92;
    let tw = ctx.measureText(text).width;
    if (tw > maxW && tw > 0) {
      fs = Math.max(10, Math.floor(fs * (maxW / tw)));
      ctx.font = `bold ${fs}px sans-serif`;
      tw = ctx.measureText(text).width;
    }

    const padX = Math.round(fs * 0.65);
    const padY = Math.round(fs * 0.38);
    const boxW = Math.min(w - 12, tw + padX * 2);
    const boxH = fs + padY * 2;
    const margin = Math.max(6, Math.round(fs * 0.45));
    const boxX = Math.max(6, w - boxW - margin);
    const boxY = margin;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    const rad = 7;
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
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, boxX + boxW - padX, boxY + padY);
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

/** Blob 을 Image 로 로드 (캔버스 증빙 시트 생성용) */
function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/**
 * 개인 24회 출석·사진 증빙 시트(.jpg) 1장 생성
 * - 데스크탑 PC에서 다수 파일 저장 대화상자 충돌을 막고,
 *   사진이 0장인 회기(수기/전산화 이전 구간)도 깔끔한 .jpg 증빙 이미지로 첨부할 수 있게 함
 */
async function buildVerificationSheetFile({ person, stage = 1, startOrd = 1, endOrd = 24, slice = [], photoItems = [] }) {
  try {
    const W = 1080;
    const padX = 28;
    const headerH = 128;
    const colsGrid = 6;
    const rowsGrid = Math.max(1, Math.ceil(Math.max(slice.length, 24) / colsGrid));
    const cellH = 54;
    const gridGap = 8;
    const gridBlockH = 42 + rowsGrid * (cellH + gridGap);

    const photoCols = 3;
    const tileGap = 16;
    const tileW = Math.floor((W - padX * 2 - tileGap * (photoCols - 1)) / photoCols);
    const tileImgH = 220;
    const tileCapH = 42;
    const tileH = tileImgH + tileCapH;
    const photoRows = photoItems.length ? Math.ceil(photoItems.length / photoCols) : 0;
    const photoSectionH = photoItems.length
      ? (46 + photoRows * (tileH + tileGap) + 20)
      : 132;

    const H = headerH + 20 + gridBlockH + 18 + photoSectionH + 28;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 헤더
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`${CONFIG.churchName} 예배 출석 · 마일리지 증빙 시트`, padX, 34);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    const uLbl = typeof unitLabel === 'function' ? unitLabel(person) : (person.unit || '');
    ctx.fillText(`[${uLbl}] ${person.name}  ·  ${stage}차 (${startOrd}~${endOrd}회)`, padX, 74);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '19px sans-serif';
    const dc = person.dischargeDate ? fmtYYMMDD(person.dischargeDate) : '미입력';
    ctx.fillText(
      `총 누적 ${person.total || 0}회   |   전역일: ${dc}   |   인증사진: ${photoItems.length}장   |   발급: ${todayStr()}`,
      padX, 108
    );

    // 24회 날짜표
    let y = headerH + 24;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 21px sans-serif';
    ctx.fillText(`■ ${startOrd}~${endOrd}회 출석 날짜표`, padX, y + 18);
    y += 38;

    const cellW = Math.floor((W - padX * 2 - gridGap * (colsGrid - 1)) / colsGrid);
    for (let idx = 0; idx < Math.max(slice.length, 24); idx++) {
      const e = slice[idx];
      const ord = e ? (e.ord || (startOrd + idx)) : (startOrd + idx);
      const col = idx % colsGrid;
      const row = Math.floor(idx / colsGrid);
      const x = padX + col * (cellW + gridGap);
      const cy = y + row * (cellH + gridGap);
      const hasAttPhoto = !!(e && e.att && e.att.hasPhoto);
      const hasEntry = !!e;

      ctx.fillStyle = hasAttPhoto ? '#eff6ff' : (hasEntry ? '#f8fafc' : '#f1f5f9');
      ctx.strokeStyle = hasAttPhoto ? '#3b82f6' : (hasEntry ? '#cbd5e1' : '#e2e8f0');
      ctx.lineWidth = 1.5;
      ctx.fillRect(x, cy, cellW, cellH);
      ctx.strokeRect(x, cy, cellW, cellH);

      ctx.fillStyle = hasAttPhoto ? '#1d4ed8' : '#475569';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(`${ord}회${hasAttPhoto ? ' 📷' : ''}`, x + 8, cy + 20);

      ctx.fillStyle = e ? (e.unknown ? '#991b1b' : '#0f172a') : '#94a3b8';
      ctx.font = '15px sans-serif';
      const dtTxt = !e
        ? '-'
        : (e.unknown ? '00.00.00(미상)' : `${fmtYYMMDD(e.date)}(${weekdayOf(e.date)})`);
      ctx.fillText(dtTxt, x + 8, cy + 43);
    }

    // 사진 섹션
    y = headerH + 20 + gridBlockH + 20;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 21px sans-serif';
    ctx.fillText(`■ 출석 인증 사진 (${photoItems.length}장)`, padX, y + 18);
    y += 40;

    if (!photoItems.length) {
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#cbd5e1';
      ctx.fillRect(padX, y, W - padX * 2, 74);
      ctx.strokeRect(padX, y, W - padX * 2, 74);
      ctx.fillStyle = '#475569';
      ctx.font = '19px sans-serif';
      ctx.fillText(
        `이 회기(${startOrd}~${endOrd}회)는 전산화 이전 수기 명부 또는 사진 미촬영 구간입니다. (상단 날짜표 참조)`,
        padX + 18, y + 44
      );
    } else {
      const loaded = await Promise.all(
        photoItems.map(async it => {
          try { return { it, img: await loadImageFromBlob(it.blob) }; }
          catch (e) { return { it, img: null }; }
        })
      );
      loaded.forEach(({ it, img }, i) => {
        const col = i % photoCols;
        const row = Math.floor(i / photoCols);
        const x = padX + col * (tileW + tileGap);
        const py = y + row * (tileH + tileGap);

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x, py, tileW, tileImgH);
        if (img) {
          const scale = Math.max(tileW / img.width, tileImgH / img.height);
          const sw = tileW / scale;
          const sh = tileImgH / scale;
          const sx = (img.width - sw) / 2;
          const sy = (img.height - sh) / 2;
          ctx.drawImage(img, sx, sy, sw, sh, x, py, tileW, tileImgH);
        }
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, py + tileImgH, tileW, tileCapH);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        const cap = `${it.ord}회 · ${fmtYYMMDD(it.date)}(${weekdayOf(it.date)}) ${it.time || ''}`.trim();
        ctx.fillText(cap, x + 10, py + tileImgH + 27);
      });
    }

    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.88));
    if (!blob) return null;
    const fname = safeFileName(`천군교회_출석증빙_${uLbl}_${person.name}_${startOrd}-${endOrd}회`) + '.jpg';
    return new File([blob], fname, { type: 'image/jpeg' });
  } catch (e) {
    console.warn('[buildVerificationSheetFile failed]', e);
    return null;
  }
}

/**
 * 다수 인원(예: 새신자 여러 명) 사진 묶음 시트(.jpg) 1장 생성
 */
async function buildMultiPhotoSheetFile(title, items = []) {
  try {
    const W = 1080;
    const padX = 28;
    const headerH = 112;
    const photoCols = 2;
    const tileGap = 18;
    const tileW = Math.floor((W - padX * 2 - tileGap) / photoCols);
    const tileImgH = 300;
    const tileCapH = 54;
    const tileH = tileImgH + tileCapH;
    const rows = Math.max(1, Math.ceil(items.length / photoCols));
    const H = items.length ? (headerH + 24 + rows * (tileH + tileGap) + 24) : 260;

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(title || `${CONFIG.churchName} 출석 인증 사진`, padX, 54);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '19px sans-serif';
    ctx.fillText(`총 ${items.length}명 · 발급일: ${todayStr()}`, padX, 90);

    let y = headerH + 22;
    if (!items.length) {
      ctx.fillStyle = '#475569';
      ctx.font = '20px sans-serif';
      ctx.fillText('첨부할 사진 기록이 없습니다.', padX, y + 40);
    } else {
      const loaded = await Promise.all(items.map(async it => {
        try { return { it, img: it.blob ? await loadImageFromBlob(it.blob) : null }; }
        catch (e) { return { it, img: null }; }
      }));
      loaded.forEach(({ it, img }, i) => {
        const col = i % photoCols;
        const row = Math.floor(i / photoCols);
        const x = padX + col * (tileW + tileGap);
        const py = y + row * (tileH + tileGap);

        ctx.fillStyle = img ? '#0f172a' : '#e2e8f0';
        ctx.fillRect(x, py, tileW, tileImgH);
        if (img) {
          const scale = Math.max(tileW / img.width, tileImgH / img.height);
          const sw = tileW / scale;
          const sh = tileImgH / scale;
          const sx = (img.width - sw) / 2;
          const sy = (img.height - sh) / 2;
          ctx.drawImage(img, sx, sy, sw, sh, x, py, tileW, tileImgH);
        } else {
          ctx.fillStyle = '#475569';
          ctx.font = '20px sans-serif';
          ctx.fillText('사진 없음 (수동/미촬영)', x + 24, py + tileImgH / 2);
        }
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, py + tileImgH, tileW, tileCapH);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 17px sans-serif';
        ctx.fillText(it.line1 || '', x + 12, py + tileImgH + 22);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '15px sans-serif';
        ctx.fillText(it.line2 || '', x + 12, py + tileImgH + 44);
      });
    }

    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.88));
    if (!blob) return null;
    const fname = safeFileName(`${title || '천군교회_사진모음'}_${todayStr()}`) + '.jpg';
    return new File([blob], fname, { type: 'image/jpeg' });
  } catch (e) {
    console.warn('[buildMultiPhotoSheetFile failed]', e);
    return null;
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
    '📋 전체 본문은 클립보드에 복사되었습니다. (메일 본문에 Ctrl+V 붙여넣기)',
    '📎 다운로드된 파일을 첨부해 주세요.',
  ].join('\n');

  const shortNotice = '\n\n※ 전체 본문 클립보드 복사됨(Ctrl+V 붙여넣기)';
  const notice = (
    encodeURIComponent(fullNotice).length <= maxEncodedLen - 350 &&
    fullNotice.length <= maxCharLen - 150
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
  const normFile = f => {
    const cleanName = String(f.name || 'attachment')
      .replace(/\s+/g, '_')
      .replace(/[()[\]{}:*?"<>|\\/,;']/g, '_');
    return cleanName === f.name ? f : new File([f], cleanName, { type: f.type });
  };
  const validFiles = (files || []).filter(Boolean).map(normFile);
  const dlList = ((extraDownloadFiles && extraDownloadFiles.length)
    ? extraDownloadFiles.filter(Boolean)
    : validFiles).map(normFile);

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const mobileText = buildSafeEmailBody(text, 4500, 1800);
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
  const maxBodyEncoded = Math.min(1600, Math.max(800, 1900 - baseGmailUrl.length));
  const safeBody = buildSafeEmailBody(text, maxBodyEncoded, 1500);
  const gmailUrl = baseGmailUrl + encodeURIComponent(safeBody);
  const isTruncated = safeBody !== String(text || '');

  const fileNamesHtml = dlList.length
    ? dlList.map(f => `<span class="badge">${esc(f.name)}</span>`).join(' ')
    : '';
  const fileNoticeHtml = dlList.length
    ? `<b>첨부용 파일(${dlList.length}개)을 다운로드</b>하고 `
    : '';
  const bodyNotice = isTruncated
    ? '전체 본문이 길어 메일 창에는 요약본만 먼저 채워집니다. 열린 메일 본문에서 <b>붙여넣기(Ctrl+V)</b>를 하고 다운로드된 파일을 첨부해 주세요.'
    : '수신자·제목·본문이 자동으로 채워진 상태로 열리며, 다운로드된 파일만 메일에 첨부(드래그 앤 드롭)하시면 됩니다.';

  const openGmail = await Modal.confirm(
    `${fileNoticeHtml}<b>전체 메일 본문을 클립보드에 복사</b>했습니다.<br>` +
    (fileNamesHtml ? `<div style="margin:.45rem 0;line-height:1.8">${fileNamesHtml}</div>` : '<br>') +
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
    if (dlList.length) await sleep(350);
  } else {
    await copyReportText(text);
  }

  if (dlList.length) {
    await downloadFiles(dlList);
  }
  return false;
}
