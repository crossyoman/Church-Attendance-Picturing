/* =========================================================
 * 주간 리포트 (기본값: 지금 시점 / 최근 주일 선택 + 날짜 직접 지정 지원)
 * - 메일 사진 첨부: 24회 마일리지 달성자의 최근 24회 인증 사진만 첨부
 * - 출석자 전체 명단 및 날짜별·부대별 통계는 엑셀 파일(.xlsx / .csv) 및 본문에 포함
 * ========================================================= */
const Report = {
  /** ref 시점 기준 가장 최근의 '일요일 13:00' */
  lastCutoff(ref = new Date()) {
    const d = new Date(ref);
    d.setHours(CONFIG.reportHour, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() - CONFIG.reportWeekday + 7) % 7));
    if (d > ref) d.setDate(d.getDate() - 7);
    return d;
  },
  recentCutoffs(n = 12) {
    const out = [];
    let c = this.lastCutoff();
    for (let i = 0; i < n; i++) { out.push(new Date(c)); c.setDate(c.getDate() - 7); }
    return out;
  },

  /**
   * 기간별 리포트 계산
   * - startDateStr, endDateStr ('YYYY-MM-DD')가 주어지면 해당 날짜 범위(시작일 00:00:00 ~ 종료일 23:59:59) 기준으로 집계
   * - 그렇지 않으면 cutoff 시점으로부터 직전 7일간(일요일 13:00 기준 또는 지금 시점 기준 1주일)으로 집계
   */
  async build(cutoffOrEnd, startDateStr = null, endDateStr = null) {
    const U = CONFIG.mileageUnit;
    let start, end, prev, cutoff;

    if (startDateStr && endDateStr) {
      const [sy, sm, sd] = startDateStr.split('-').map(Number);
      const [ey, em, ed] = endDateStr.split('-').map(Number);
      prev = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
      cutoff = new Date(ey, em - 1, ed, 23, 59, 59, 999);
      start = prev.getTime() - 1;
      end = cutoff.getTime();
    } else {
      cutoff = cutoffOrEnd instanceof Date ? cutoffOrEnd : new Date();
      end = cutoff.getTime();
      prev = new Date(end - 7 * 864e5);
      start = prev.getTime();
    }

    const people = await Store.allPeopleFull();

    const achievers = [];
    for (const p of people) {
      const atts = p.atts.filter(a => a.ts <= end);
      const base = p.baseCount || 0;
      const c1 = base + atts.length;
      const c0 = base + atts.filter(a => a.ts <= start).length;
      const k0 = Math.floor(c0 / U), k1 = Math.floor(c1 / U);
      if (k1 <= k0) continue;
      const grantedBlocks = Math.floor(Store.grantedUpTo(p, p.grants) / U);
      for (let k = k0 + 1; k <= k1; k++) {
        const lo = U * (k - 1), hi = U * k;
        const block = atts.filter((a, i) => { const ord = base + i + 1; return ord > lo && ord <= hi; });
        const blockDates = Store.timeline(p, atts).slice(lo, hi);   // 이번 24회 구간(예: 25~48회)의 예배 날짜
        achievers.push({
          person: p, milestone: hi, total: c1, block, blockDates,
          missing: U - block.length,
          allDates: atts.map(a => a.date),
          grantedBlocks, earnedBlocks: k1, pendingBlocks: Math.max(0, k1 - grantedBlocks),
        });
      }
    }
    achievers.sort((a, b) => unitOrder(unitLabel(a.person)) - unitOrder(unitLabel(b.person)) || koSort(a.person, b.person));

    // 선택된 기간 동안 출석한 전체 기록 (부대별 누가 출석했는지) 및 처음 온 사람(신규 첫 출석자) 집계
    const inWin = [];
    const firstTimers = [];
    people.forEach(p => {
      const base = p.baseCount || 0;
      const attsBefore = p.atts.filter(a => a.ts <= start);
      const attsInWin = p.atts.filter(a => a.ts > start && a.ts <= end);

      if (base === 0 && attsBefore.length === 0 && attsInWin.length > 0) {
        const repAtt = attsInWin.find(a => a.hasPhoto) || attsInWin[0];
        firstTimers.push({
          ...repAtt,
          person: p,
          label: unitLabel(p),
          memberName: p.name,
          dischargeDate: p.dischargeDate,
          cumCount: 1,
          totalNow: p.total,
          isFirstVisit: true,
        });
      }

      p.atts.forEach((a, idx) => {
        if (a.ts > start && a.ts <= end) {
          const cumCount = base + idx + 1;
          inWin.push({
            ...a,
            person: p,
            label: unitLabel(p),
            memberName: p.name,
            dischargeDate: p.dischargeDate,
            cumCount,
            totalNow: p.total,
            isFirstVisit: cumCount === 1,
          });
        }
      });
    });
    const sortAtts = (a, b) => a.date.localeCompare(b.date) || unitOrder(a.label) - unitOrder(b.label) || a.time.localeCompare(b.time) || a.memberName.localeCompare(b.memberName, 'ko');
    inWin.sort(sortAtts);
    firstTimers.sort(sortAtts);

    const dates = [...new Set(inWin.map(a => a.date))].sort();
    const rows = allUnitLabels().map(u => {
      const counts = dates.map(d => inWin.filter(a => a.label === u.label && a.date === d).length);
      return { label: u.label, counts, sum: counts.reduce((x, y) => x + y, 0) };
    });
    const totals = dates.map((d, i) => rows.reduce((s, r) => s + r.counts[i], 0));

    const warnings = (await Store.warnings()).filter(w => w.createdAt > start && w.createdAt <= end);

    // 전역일이 이 기간에 도래한 인원 / 다음 7일 내 전역 예정자
    const endStr = endDateStr || fmtDate(cutoff);
    const startStr = startDateStr || fmtDate(prev);
    const inclusiveStart = !!(startDateStr && endDateStr);
    const nextEnd = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() + 7);
    const nextEndStr = fmtDate(nextEnd);
    const mkDis = p => ({ person: p, label: unitLabel(p), name: p.name, dischargeDate: p.dischargeDate, total: p.total, discharged: !!p.discharged });
    const sortDis = (a, b) => a.dischargeDate.localeCompare(b.dischargeDate) || unitOrder(a.label) - unitOrder(b.label) || a.name.localeCompare(b.name, 'ko');
    const dischargees = people
      .filter(p => p.dischargeDate && (inclusiveStart ? p.dischargeDate >= startStr : p.dischargeDate > startStr) && p.dischargeDate <= endStr)
      .map(mkDis).sort(sortDis);
    const upcomingDischarge = people
      .filter(p => p.dischargeDate && p.dischargeDate > endStr && p.dischargeDate <= nextEndStr)
      .map(mkDis).sort(sortDis);

    return {
      dischargees,
      upcomingDischarge,
      cutoff,
      prev,
      startDateStr: startDateStr || fmtDate(prev),
      endDateStr: endDateStr || fmtDate(cutoff),
      isCustomRange: !!(startDateStr && endDateStr),
      achievers,
      firstTimers,
      periodAtts: inWin,
      people,
      stats: { dates, rows, totals },
      warnings,
    };
  },

  /** 날짜 목록을 10개씩 줄로 나눠 '월-일' 문자열 배열로 */
  dateGridRows(entries, per = 10) {
    const rows = [];
    for (let i = 0; i < entries.length; i += per) rows.push(entries.slice(i, i + per).map(e => fmtMD(e.date)));
    return rows;
  },

  /** 전역자 메일 본문 줄 */
  dischargeLines(r) {
    const L = [];
    const dis = r.dischargees || [], nxt = r.upcomingDischarge || [];
    L.push(`■ 전역자 (이 기간 전역일 도래 ${dis.length}명)`);
    if (!dis.length) L.push('  - 이 기간 전역일이 도래한 인원이 없습니다.');
    dis.forEach((d, i) => L.push(`  ${i + 1}) [${d.label}] ${d.name} - 전역일 ${fmtYYMMDD(d.dischargeDate)} (누적 ${d.total}회)`));
    if (nxt.length) {
      L.push(`  ▶ 다음 7일 내 전역 예정 (${nxt.length}명)`);
      nxt.forEach(d => L.push(`    · [${d.label}] ${d.name} - 전역일 ${fmtYYMMDD(d.dischargeDate)} (누적 ${d.total}회)`));
    }
    L.push('');
    return L;
  },

  /** [경고-확인필요] 메일 본문 */
  warningText(w, atts = []) {
    const L = [`[경고-확인필요] ${CONFIG.churchName} 출석 중복 의심`, '',
      `- 날짜: ${w.date}`, `- 소속: ${w.unitLabel}`, `- 이름: ${w.name}`, `- 내용: ${w.detail}`,
      `- 발생 시각: ${new Date(w.createdAt).toLocaleString('ko-KR')}`];
    if (atts.length) {
      L.push('- 관련 출석 기록:');
      atts.forEach(a => L.push(`   · ${a.fileName}${a.retakes ? ` (재촬영 ${a.retakes}회)` : ''}`));
    }
    L.push('', '첨부된 사진으로 동일인 여부를 확인해 주세요.');
    return L.join('\n');
  },

  periodText(r) {
    if (r.isCustomRange) {
      return `${r.startDateStr}(${weekdayOf(r.startDateStr)}) ~ ${r.endDateStr}(${weekdayOf(r.endDateStr)})`;
    }
    return `${fmtDate(r.prev)}(${WEEK[r.prev.getDay()]}) ${fmtTime(r.prev)} ~ ${fmtDate(r.cutoff)}(${WEEK[r.cutoff.getDay()]}) ${fmtTime(r.cutoff)}`;
  },

  /** 이메일 본문용 텍스트 */
  text(r) {
    const achPhotoCount = (r.achievers || []).reduce((sum, a) => sum + (a.block || []).filter(b => b.hasPhoto).length, 0);
    const firstList = r.firstTimers || [];
    const firstPhotoCount = firstList.filter(a => a.hasPhoto).length;
    const L = [];
    L.push(`[${CONFIG.churchName} 주간 예배 출석 리포트 및 통계]`);
    L.push(`기간: ${this.periodText(r)}`);
    L.push(`첨부: 1) 주간 출석명단·부대통계·마일리지 엑셀 파일  2) 24회 마일리지 달성자 인증 사진 (${achPhotoCount}장)  3) 처음 온 사람 인증 사진 (${firstPhotoCount}장)`);
    L.push('');

    // 오늘(기간 내) 처음 온 사람 명단
    L.push(`■ 오늘(기간 내) 처음 온 사람 명단 (${firstList.length}명)`);
    if (!firstList.length) {
      L.push('  - 이 기간에 처음 온 신규 출석자가 없습니다.');
    } else {
      firstList.forEach((a, idx) => {
        L.push(`  ${idx + 1}) [${a.label}] ${a.memberName} (전역: ${a.dischargeDate || '미기입'}) - ${a.date}(${weekdayOf(a.date)}) ${a.time} 첫 출석 (${a.hasPhoto ? '사진인증: ' + a.fileName + '.jpg' : '수동입력'})`);
      });
    }
    L.push('');

    this.dischargeLines(r).forEach(x => L.push(x));

    L.push(`■ ${CONFIG.mileageUnit}회 마일리지 달성자 (${r.achievers.length}명)`);
    if (!r.achievers.length) {
      L.push('  - 이 기간 신규 마일리지 달성자가 없습니다.');
    }
    r.achievers.forEach((a, i) => {
      const p = a.person;
      const photoAtts = a.block.filter(b => b.hasPhoto);
      const manualAtts = a.block.filter(b => !b.hasPhoto);
      const preCount = (a.missing || 0) + manualAtts.length;

      L.push(`--------------------------------------------------`);
      L.push(`${i + 1}) [${unitLabel(p)}] ${p.name} (전역: ${p.dischargeDate || '미기입'})${p.discharged ? ' [전역 처리]' : ''}`);
      L.push(`   · 마일리지 달성: ${a.milestone}회차 달성 (총 누적 출석: ${a.total}회)`);
      L.push(`   · 마일리지 포상 건의: ${a.pendingBlocks > 0 ? '신규 대상 (' + a.pendingBlocks + '건 건의 필요)' : '기존 건의 완료'}`);

      if (preCount > 0) {
        L.push(`   · -사진촬영 전 출석-: 총 ${preCount}회`);
        if (a.missing > 0) {
          L.push(`     - 전산화 이전 수기 명부 확인: ${a.missing}회`);
        }
        if (manualAtts.length > 0) {
          L.push(`     - 수기 입력(사진 미촬영): ${manualAtts.length}회 (${manualAtts.map(b => b.date).join(', ')})`);
          manualAtts.forEach(b => {
            if (b.reason) L.push(`       ※ 사유: ${b.reason}`);
          });
        }
      }

      L.push(`   · [사진 인증 출석]: 총 ${photoAtts.length}회 (인증 사진 ${photoAtts.length}장)`);
      if (photoAtts.length > 0) {
        L.push(`     - 사진 인증 일자: ${photoAtts.map(b => b.date).join(', ')}`);
      }
      L.push(`   · 이번 24회 구간: ${a.block.length ? (a.block[0].date + ' ~ ' + a.block[a.block.length - 1].date) : '도입 전 수기 출석'}`);
      if (a.blockDates && a.blockDates.length) {
        const st = a.milestone - CONFIG.mileageUnit + 1;
        L.push(`   · ${st}~${a.milestone}회 예배 날짜 (월-일, 00-00 = 날짜 모름):`);
        this.dateGridRows(a.blockDates).forEach((row, ri) => {
          const f = st + ri * 10;
          L.push(`     ${String(f).padStart(3, ' ')}~${String(f + row.length - 1).padStart(3, ' ')}회 | ${row.join('  ')}`);
        });
      }
      L.push(`--------------------------------------------------`);
      L.push('');
    });

    if (r.warnings && r.warnings.length) {
      L.push(`■ [경고-확인필요] 기간 내 중복/재출석 의심 (${r.warnings.length}건)`);
      r.warnings.forEach(w => L.push(`  - ${w.date} ${w.unitLabel} ${w.name}: ${w.detail}${w.resolved ? ' → 확인 완료(' + (w.memo || '이상없음') + ')' : ''}`));
      L.push('');
    }

    L.push('■ 날짜별 · 부대별 출석 인원 통계');
    const s = r.stats;
    if (!s.dates.length) {
      L.push('  - 이 기간 출석 기록이 없습니다.');
    } else {
      L.push('  부대 | ' + s.dates.map(shortDate).join(' | ') + ' | 합계');
      s.rows.filter(x => x.sum).forEach(x => L.push(`  ${x.label} | ${x.counts.join(' | ')} | ${x.sum}명`));
      L.push(`  전체합계 | ${s.totals.join(' | ')} | 총 ${s.totals.reduce((a, b) => a + b, 0)}명`);
    }
    L.push('');

    const pAtts = r.periodAtts || [];
    L.push(`■ 기간 내 예배 출석자 전체 명단 (총 ${pAtts.length}명)`);
    if (!pAtts.length) {
      L.push('  - 출석자가 없습니다.');
    } else {
      s.dates.forEach(d => {
        const dayList = pAtts.filter(a => a.date === d);
        L.push(`  [${d} (${weekdayOf(d)}) - 총 ${dayList.length}명]`);
        allUnitLabels().forEach(u => {
          const uList = dayList.filter(a => a.label === u.label);
          if (uList.length) {
            L.push(`   · ${u.label} (${uList.length}명): ` + uList.map(a => `${a.memberName}(${a.time}, 누적${a.cumCount}회${a.isFirstVisit ? '·첫출석' : ''}${a.manual ? ', 수동' : ''})`).join(', '));
          }
        });
      });
    }
    return L.join('\n');
  },

  /** 처음 온 사람 사진 메일 발송용 본문 */
  firstTimersText(r) {
    const firstList = r.firstTimers || [];
    const firstPhotoCount = firstList.filter(a => a.hasPhoto).length;
    const L = [];
    L.push(`[${CONFIG.churchName} 처음 온 사람(신규 출석자) 명단 및 인증 사진]`);
    L.push(`기간: ${this.periodText(r)}`);
    L.push(`첨부: 처음 온 사람 예배 출석 인증 사진 (${firstPhotoCount}장)`);
    L.push('');
    L.push(`■ 오늘(기간 내) 처음 온 사람 명단 (총 ${firstList.length}명)`);
    if (!firstList.length) {
      L.push('  - 이 기간에 처음 온 신규 출석자가 없습니다.');
    } else {
      firstList.forEach((a, idx) => {
        L.push(`  ${idx + 1}) [${a.label}] ${a.memberName} (전역: ${a.dischargeDate || '미기입'})`);
        L.push(`     · 첫 출석 일시: ${a.date}(${weekdayOf(a.date)}) ${a.time}`);
        L.push(`     · 사진 파일명: ${a.hasPhoto ? a.fileName + '.jpg' : '사진 없음(수동)'}`);
      });
    }
    L.push('');
    L.push('==================================================');
    L.push(this.text(r));
    return L.join('\n');
  },

  /**
   * 안드로이드 Gmail 앱 100% 직접 첨부 호환용 CSV 엑셀 파일 생성
   * - 순수 'text/csv' + UTF-8 BOM('\uFEFF')을 앞에 붙여 엑셀에서 한글 깨짐 없이 바로 열림
   */
  buildWeeklyCsvFile(r) {
    const escCsv = v => {
      const s = String(v ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rowToCsv = arr => arr.map(escCsv).join(',');
    const lines = [];
    const s = r.stats;

    // 1. 날짜별 부대 통계
    lines.push(rowToCsv([`[1. 날짜별 · 부대별 출석 통계 (${this.periodText(r)})]`]));
    lines.push(rowToCsv(['부대', ...s.dates.map(d => `${d}(${weekdayOf(d)})`), '합계']));
    s.rows.forEach(row => lines.push(rowToCsv([row.label, ...row.counts, row.sum])));
    lines.push(rowToCsv(['전체 합계', ...s.totals, s.totals.reduce((a, b) => a + b, 0)]));
    lines.push('');

    // 1-2. 오늘(기간 내) 처음 온 사람 명단
    lines.push(rowToCsv(['[처음 온 사람(신규 출석자) 명단]']));
    lines.push(rowToCsv(['연번', '첫출석날짜', '요일', '첫출석시간', '소속부대', '이름', '전역일', '출석구분', '사진파일명']));
    (r.firstTimers || []).forEach((a, idx) => {
      lines.push(rowToCsv([
        idx + 1,
        a.date,
        weekdayOf(a.date),
        a.time,
        a.label,
        a.memberName,
        fmtYYMMDD(a.dischargeDate),
        a.manual ? '수동입력' : '사진촬영',
        a.hasPhoto ? (a.fileName + '.jpg') : '사진없음',
      ]));
    });
    lines.push('');

    // 2. 기간 내 출석자 전체 명단
    lines.push(rowToCsv(['[2. 예배 출석자 전체 명단]']));
    lines.push(rowToCsv(['연번', '출석날짜', '요일', '출석시간', '소속부대', '이름', '전역일', '누적출석', '출석구분', '수동사유', '사진파일명']));
    (r.periodAtts || []).forEach((a, idx) => {
      lines.push(rowToCsv([
        idx + 1,
        a.date,
        weekdayOf(a.date),
        a.time,
        a.label,
        a.memberName,
        fmtYYMMDD(a.dischargeDate),
        a.cumCount,
        a.manual ? '수동보정' : '사진촬영',
        a.reason || '',
        a.hasPhoto ? (a.fileName + '.jpg') : '사진없음',
      ]));
    });
    lines.push('');

    // 2-2. 전역자
    lines.push(rowToCsv(['[전역자 (이 기간 전역일 도래) / 다음 7일 내 전역 예정]']));
    lines.push(rowToCsv(['구분', '소속부대', '이름', '전역일', '누적출석']));
    (r.dischargees || []).forEach(d => lines.push(rowToCsv(['전역', d.label, d.name, fmtYYMMDD(d.dischargeDate), d.total])));
    (r.upcomingDischarge || []).forEach(d => lines.push(rowToCsv(['전역예정', d.label, d.name, fmtYYMMDD(d.dischargeDate), d.total])));
    lines.push('');

    // 3. 24회 마일리지 달성자
    lines.push(rowToCsv(['[3. 24회 마일리지 달성자 명단]']));
    lines.push(rowToCsv(['연번', '소속부대', '이름', '전역일', '달성회차', '총누적출석', '사진촬영전_출석횟수', '사진인증_출석횟수', '사진인증_일자목록']));
    (r.achievers || []).forEach((a, idx) => {
      const p = a.person;
      const photoAtts = a.block.filter(b => b.hasPhoto);
      const manualAtts = a.block.filter(b => !b.hasPhoto);
      const preCount = (a.missing || 0) + manualAtts.length;
      lines.push(rowToCsv([
        idx + 1,
        unitLabel(p),
        p.name,
        fmtYYMMDD(p.dischargeDate),
        `${a.milestone}회차`,
        a.total,
        preCount,
        photoAtts.length,
        photoAtts.map(b => b.date).join(' / '),
      ]));
    });
    lines.push('');

    // 4. 전체 용사 마일리지 현황 (1~5차 기준일·건의일)
    lines.push(rowToCsv(['[4. 전체 용사 마일리지 현황 (24~120회 기준일·건의일)]']));
    lines.push(rowToCsv([
      '상태', '소속부대', '이름', '전역일', '누적출석', '사진촬영전출석', '마지막출석일',
      '24회_기준일', '24회_건의일', '48회_기준일', '48회_건의일', '72회_기준일', '72회_건의일', '96회_기준일', '96회_건의일', '120회_기준일', '120회_건의일'
    ]));
    (r.people || []).forEach(p => {
      const slots = Store.getMemberSlots(p, p.grants);
      const row = [
        p.discharged ? '전역' : '현역',
        unitLabel(p),
        p.name,
        fmtYYMMDD(p.dischargeDate),
        p.total,
        p.baseCount || 0,
        fmtYYMMDD(p.last || ''),
      ];
      slots.forEach(sl => row.push(fmtYYMMDD(sl.baseDate), fmtYYMMDD(sl.proposedDate)));
      lines.push(rowToCsv(row));
    });

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const rangeTag = `${r.startDateStr || fmtDate(r.prev)}_${r.endDateStr || fmtDate(r.cutoff)}`;
    const fileName = `천군교회_출석명단_및_부대통계_${rangeTag}.csv`;
    return new File([csvContent], fileName, { type: 'text/csv' });
  },

  /** 주간 리포트 다운로드 및 첨부용 엑셀 파일(.xlsx) 생성 */
  async buildWeeklyExcelFile(r) {
    if (typeof XLSX === 'undefined') return null;
    const wb = XLSX.utils.book_new();
    const s = r.stats;

    // 1. 날짜별_부대통계 시트
    const statAoa = [
      ['부대', ...s.dates.map(d => `${d} (${weekdayOf(d)})`), '기간 합계'],
      ...s.rows.map(row => [row.label, ...row.counts, row.sum]),
      ['전체 합계', ...s.totals, s.totals.reduce((a, b) => a + b, 0)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statAoa), '날짜별_부대통계');

    // 1-2. 처음_온_사람_명단 시트
    const firstRows = (r.firstTimers || []).map((a, idx) => ({
      연번: idx + 1,
      첫출석날짜: a.date,
      요일: weekdayOf(a.date),
      첫출석시간: a.time,
      소속부대: a.label,
      이름: a.memberName,
      전역일: fmtYYMMDD(a.dischargeDate),
      출석구분: a.manual ? '수동입력' : '사진촬영',
      사진파일명: a.hasPhoto ? (a.fileName + '.jpg') : '사진없음',
    }));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(firstRows.length ? firstRows : [{ 안내: '선택한 기간에 처음 온 신규 출석자가 없습니다.' }]),
      '처음_온_사람_명단'
    );

    // 2. 출석자_전체명단 시트
    const attRows = (r.periodAtts || []).map((a, idx) => ({
      연번: idx + 1,
      출석날짜: a.date,
      요일: weekdayOf(a.date),
      출석시간: a.time,
      소속부대: a.label,
      이름: a.memberName,
      전역일: fmtYYMMDD(a.dischargeDate),
      금회포함_누적출석: a.cumCount,
      출석구분: a.manual ? '수동보정' : '사진촬영',
      수동사유: a.reason || '',
      재촬영횟수: a.retakes || 0,
      사진파일명: a.hasPhoto ? (a.fileName + '.jpg') : '사진없음',
    }));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(attRows.length ? attRows : [{ 안내: '선택한 기간에 출석 기록이 없습니다.' }]),
      '출석자_전체명단'
    );

    // 3. 24회_마일리지_달성자 시트
    const achRows = (r.achievers || []).map((a, idx) => {
      const p = a.person;
      const photoAtts = a.block.filter(b => b.hasPhoto);
      const manualAtts = a.block.filter(b => !b.hasPhoto);
      const preCount = (a.missing || 0) + manualAtts.length;
      return {
        연번: idx + 1,
        소속부대: unitLabel(p),
        이름: p.name,
        전역일: fmtYYMMDD(p.dischargeDate),
        달성회차: `${a.milestone}회차`,
        총누적출석: a.total,
        사진촬영전_출석횟수: preCount,
        사진인증_출석횟수: photoAtts.length,
        사진인증_일자목록: photoAtts.map(b => b.date).join(', '),
      };
    });
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(achRows.length ? achRows : [{ 안내: '선택한 기간에 24회 마일리지 신규 달성자가 없습니다.' }]),
      '24회_마일리지_달성자'
    );

    // 3-2. 전역자 시트
    const disRows = [
      ...(r.dischargees || []).map(d => ({ 구분: '전역(기간 내 도래)', 소속부대: d.label, 이름: d.name, 전역일: fmtYYMMDD(d.dischargeDate), 누적출석: d.total })),
      ...(r.upcomingDischarge || []).map(d => ({ 구분: '전역예정(다음 7일)', 소속부대: d.label, 이름: d.name, 전역일: fmtYYMMDD(d.dischargeDate), 누적출석: d.total })),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(disRows.length ? disRows : [{ 안내: '이 기간 전역일이 도래한 인원이 없습니다.' }]), '전역자');

    // 3-3. 마일리지 달성 구간 예배일 (10개씩)
    const gridAoa = [];
    (r.achievers || []).forEach(a => {
      if (!a.blockDates || !a.blockDates.length) return;
      const st = a.milestone - CONFIG.mileageUnit + 1;
      gridAoa.push([`${unitLabel(a.person)} ${a.person.name} - ${st}~${a.milestone}회 예배 날짜 (월-일)`]);
      this.dateGridRows(a.blockDates).forEach((row, ri) => gridAoa.push([`${st + ri * 10}~${st + ri * 10 + row.length - 1}회`, ...row]));
      gridAoa.push([]);
    });
    if (gridAoa.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gridAoa), '달성구간_예배일');

    // 4. 전체_마일리지_현황 (1~5차 기준일·건의일 2행 헤더)
    const people = r.people || await Store.allPeopleFull();
    const milAoa = [
      ['상태', '소속부대', '이름', '전역일', '누적출석', '사진촬영전출석', '마지막출석일', '24회', '', '48회', '', '72회', '', '96회', '', '120회', ''],
      ['', '', '', '', '', '', '', '기준일', '건의일', '기준일', '건의일', '기준일', '건의일', '기준일', '건의일', '기준일', '건의일'],
    ];
    people.forEach(p => {
      const slots = Store.getMemberSlots(p, p.grants);
      const row = [
        p.discharged ? '전역' : '현역',
        unitLabel(p),
        p.name,
        fmtYYMMDD(p.dischargeDate),
        p.total,
        p.baseCount || 0,
        fmtYYMMDD(p.last || ''),
      ];
      slots.forEach(sl => row.push(fmtYYMMDD(sl.baseDate), fmtYYMMDD(sl.proposedDate)));
      milAoa.push(row);
    });
    const wsMil = XLSX.utils.aoa_to_sheet(milAoa);
    wsMil['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 1, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 1, c: 5 } },
      { s: { r: 0, c: 6 }, e: { r: 1, c: 6 } },
      { s: { r: 0, c: 7 }, e: { r: 0, c: 8 } },
      { s: { r: 0, c: 9 }, e: { r: 0, c: 10 } },
      { s: { r: 0, c: 11 }, e: { r: 0, c: 12 } },
      { s: { r: 0, c: 13 }, e: { r: 0, c: 14 } },
      { s: { r: 0, c: 15 }, e: { r: 0, c: 16 } },
    ];
    XLSX.utils.book_append_sheet(wb, wsMil, '전체_마일리지_현황');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const rangeTag = `${r.startDateStr || fmtDate(r.prev)}_${r.endDateStr || fmtDate(r.cutoff)}`;
    const fileName = `천군교회_출석명단_및_부대통계_${rangeTag}.xlsx`;
    return new File([wbout], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  },
};
