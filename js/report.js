// report.js - 주간 리포트: 다음 회기 전에 한 화면(또는 인쇄물)으로 이번 주 상태를 요약
//
// 이번 주(최근 7일)의 실제노출/상상노출 횟수와 SUDS 변화, 성찰 메모, 핫스팟을 모아서 보여준다.
// 새 데이터를 만들지 않고 기존 localStorage 데이터(exposure-records, listening-records,
// breathing-records)를 그대로 읽기만 한다 (records.js와 같은 원칙).

(function () {
  const EXPOSURE_RECORDS_KEY = 'exposure-records';
  const LISTENING_RECORDS_KEY = 'listening-records';
  const BREATHING_RECORDS_KEY = 'breathing-records';
  const WEEKLY_TARGETS_KEY = 'weekly-targets';
  // 회기 준비 메모 - "이번 주 과제" 선택과 같은 이유로 자동 초기화하지 않고 환자가 직접 관리함
  const SESSION_PREP_KEY = 'session-prep-notes';

  const openBtn = document.getElementById('weekly-report-open-btn');
  const modal = document.getElementById('weekly-report-modal');
  const dateEl = document.getElementById('weekly-report-date');
  const contentEl = document.getElementById('weekly-report-content');
  const printBtn = document.getElementById('weekly-report-print-btn');
  const closeBtn = document.getElementById('weekly-report-close-btn');

  const prepInputs = {
    memorable: document.getElementById('report-prep-memorable'),
    difficult: document.getElementById('report-prep-difficult'),
    questions: document.getElementById('report-prep-questions'),
    discuss: document.getElementById('report-prep-discuss'),
  };

  if (!openBtn || !modal || !contentEl) return;

  function loadPrepNotes() {
    const saved = PEStorage.load(SESSION_PREP_KEY, {});
    Object.keys(prepInputs).forEach((key) => {
      if (prepInputs[key]) prepInputs[key].value = saved[key] || '';
    });
  }

  function savePrepNotes() {
    const notes = {};
    Object.keys(prepInputs).forEach((key) => {
      notes[key] = prepInputs[key] ? prepInputs[key].value : '';
    });
    PEStorage.save(SESSION_PREP_KEY, notes);
  }

  function withinLastNDays(dateStr, n) {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today - date) / (24 * 60 * 60 * 1000));
    return diffDays >= 0 && diffDays < n;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
  }

  function formatTimestamp(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function buildSummarySection(exposureWeek, listeningWeek, breathingWeek) {
    const targets = PEStorage.load(WEEKLY_TARGETS_KEY, {});
    const section = el('div', 'report-section');
    section.appendChild(el('h4', null, '이번 주 과제 수행 (최근 7일)'));

    const grid = el('div', 'report-stat-grid');
    [
      ['실제노출', exposureWeek.length, targets.exposure],
      ['상상노출', listeningWeek.length, targets.listening],
      ['호흡 연습', breathingWeek.length, targets.breathing],
    ].forEach(([label, count, target]) => {
      const tile = el('div', 'report-stat-tile');
      tile.appendChild(el('strong', null, target ? `${count}/${target}` : String(count)));
      tile.appendChild(el('span', null, label));
      grid.appendChild(tile);
    });
    section.appendChild(grid);
    return section;
  }

  function buildSudsSection(exposureWeek, listeningWeek) {
    const section = el('div', 'report-section');
    section.appendChild(el('h4', null, 'SUDS 변화 (이번 주 실제노출/상상노출)'));

    if (exposureWeek.length === 0 && listeningWeek.length === 0) {
      section.appendChild(el('p', 'placeholder-text', '이번 주 노출 기록이 없습니다.'));
      return section;
    }

    exposureWeek.forEach((rec) => {
      const last = rec.sudsLog[rec.sudsLog.length - 1];
      const reductionPct = rec.startSUDS > 0 ? Math.round((1 - last.suds / rec.startSUDS) * 100) : 0;
      const row = el(
        'div',
        'report-row',
        `[실제노출] ${rec.date} · ${rec.itemDescription} — SUDS ${rec.startSUDS} → ${last.suds} ` +
          `(${reductionPct}% 감소), 총 ${formatDuration(rec.totalDurationMs)}`
      );
      section.appendChild(row);
    });
    listeningWeek
      .filter((rec) => Array.isArray(rec.sudsLog) && rec.sudsLog.length > 0)
      .forEach((rec) => {
        const last = rec.sudsLog[rec.sudsLog.length - 1];
        const reductionPct = rec.startSUDS > 0 ? Math.round((1 - last.suds / rec.startSUDS) * 100) : 0;
        const row = el(
          'div',
          'report-row',
          `[상상노출] ${rec.date} · ${rec.recordingName} — SUDS ${rec.startSUDS} → ${last.suds} ` +
            `(${reductionPct}% 감소), 총 ${formatDuration(rec.totalDurationMs)}`
        );
        section.appendChild(row);
      });
    return section;
  }

  function buildReflectionSection(exposureWeek, listeningWeek) {
    const section = el('div', 'report-section');
    section.appendChild(el('h4', null, '성찰 메모'));

    const notes = [];
    exposureWeek.forEach((rec) => {
      if (rec.difference) {
        notes.push(`[실제노출 · ${rec.date} · ${rec.itemDescription}] 예상과 달랐던 점: ${rec.difference}`);
      }
      if (rec.takeaway) {
        notes.push(`[실제노출 · ${rec.date} · ${rec.itemDescription}] 다음에 기억하고 싶은 것: ${rec.takeaway}`);
      }
    });
    listeningWeek.forEach((rec) => {
      if (rec.difference) {
        notes.push(`[상상노출 · ${rec.date} · ${rec.recordingName}] 예상과 달랐던 점: ${rec.difference}`);
      }
      if (rec.takeaway) {
        notes.push(`[상상노출 · ${rec.date} · ${rec.recordingName}] 다음에 기억하고 싶은 것: ${rec.takeaway}`);
      }
    });

    if (notes.length === 0) {
      section.appendChild(el('p', 'placeholder-text', '이번 주에 작성된 성찰 메모가 없습니다.'));
      return section;
    }

    notes.forEach((text) => section.appendChild(el('p', 'report-note-item', text)));
    return section;
  }

  function buildHotspotSection(listeningWeek) {
    const section = el('div', 'report-section');
    section.appendChild(el('h4', null, '핫스팟 (상상노출 중 표시한 힘든 지점)'));

    const withHotspots = listeningWeek.filter((rec) => (rec.hotspots || []).length > 0);

    if (withHotspots.length === 0) {
      section.appendChild(el('p', 'placeholder-text', '이번 주에 표시한 핫스팟이 없습니다.'));
      return section;
    }

    withHotspots.forEach((rec) => {
      const times = rec.hotspots
        .map((h) => (h.note ? `${formatTimestamp(h.atMs)} (${h.note})` : formatTimestamp(h.atMs)))
        .join(', ');
      section.appendChild(el('p', 'report-note-item', `[${rec.date} · ${rec.recordingName}] ${times}`));
    });
    return section;
  }

  function openReport() {
    const exposureWeek = PEStorage.load(EXPOSURE_RECORDS_KEY, []).filter((r) => withinLastNDays(r.date, 7));
    const listeningWeek = PEStorage.load(LISTENING_RECORDS_KEY, []).filter((r) => withinLastNDays(r.date, 7));
    const breathingWeek = PEStorage.load(BREATHING_RECORDS_KEY, []).filter((r) => withinLastNDays(r.date, 7));

    dateEl.textContent = `작성일: ${new Date().toISOString().slice(0, 10)}`;

    contentEl.innerHTML = '';
    contentEl.appendChild(buildSummarySection(exposureWeek, listeningWeek, breathingWeek));
    contentEl.appendChild(buildSudsSection(exposureWeek, listeningWeek));
    contentEl.appendChild(buildReflectionSection(exposureWeek, listeningWeek));
    contentEl.appendChild(buildHotspotSection(listeningWeek));

    loadPrepNotes();
    modal.hidden = false;
  }

  openBtn.addEventListener('click', openReport);
  closeBtn.addEventListener('click', () => {
    savePrepNotes();
    modal.hidden = true;
  });
  printBtn.addEventListener('click', () => {
    savePrepNotes();
    window.print();
  });
  Object.values(prepInputs).forEach((input) => {
    if (input) input.addEventListener('blur', savePrepNotes);
  });
})();
