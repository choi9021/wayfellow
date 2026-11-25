// records.js - 전체 과제 기록 및 SUDS 변화 그래프(Chart.js) 기능
//
// 다른 탭에서 저장한 데이터를 모아서 보여주기만 한다 (새 데이터를 만들지 않음):
// - hierarchy-items, exposure-records, listening-records, breathing-records (모두 localStorage)
// 이 탭에서 직접 만드는 데이터는 weekly-targets(주간 목표 횟수) 하나뿐이다.

(function () {
  const HIERARCHY_KEY = 'hierarchy-items';
  const EXPOSURE_RECORDS_KEY = 'exposure-records';
  const LISTENING_RECORDS_KEY = 'listening-records';
  const BREATHING_RECORDS_KEY = 'breathing-records';
  // 주간 목표 횟수 (치료자·환자가 함께 정해서 적어두는 값): { exposure, listening, breathing }
  const WEEKLY_TARGETS_KEY = 'weekly-targets';

  // 등불 노랑 하나를 메인 강조로 쓰고, 상상노출 그래프의 "최고 SUDS"만 산호색으로 구분한다
  const COLOR_PRIMARY = '#e8b84a';
  const COLOR_PRIMARY_DARK = '#f3d488';
  const COLOR_MUTED = '#93a0a7';
  const COLOR_ACCENT = '#e2a06e';

  // 다크 테마 배경 위에서 Chart.js 기본값(검은 글자/옅은 회색 격자)이 안 보이므로 전역으로 맞춘다
  if (window.Chart) {
    Chart.defaults.color = '#b7c0c6';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
    Chart.defaults.font.family = "Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  }

  let exposureChart = null;
  let hierarchyTrendChart = null;
  let listeningChart = null;

  // ----- DOM 요소 -----
  const summaryExposureCountEl = document.getElementById('summary-exposure-count');
  const summaryListeningCountEl = document.getElementById('summary-listening-count');
  const summaryBreathingCountEl = document.getElementById('summary-breathing-count');

  const targetExposureInput = document.getElementById('target-exposure');
  const targetListeningInput = document.getElementById('target-listening');
  const targetBreathingInput = document.getElementById('target-breathing');

  const exposureListEl = document.getElementById('exposure-record-list');
  const exposureChartWrap = document.getElementById('exposure-chart-wrap');
  const exposureChartCanvas = document.getElementById('chart-exposure-session');

  const hierarchySelectEl = document.getElementById('hierarchy-trend-select');
  const hierarchyTrendCanvas = document.getElementById('chart-hierarchy-trend');

  const listeningChartCanvas = document.getElementById('chart-listening-trend');

  const compareTbody = document.getElementById('hierarchy-compare-tbody');
  const meaningfulMomentsListEl = document.getElementById('meaningful-moments-list');

  const exportBtn = document.getElementById('records-export-btn');
  const clearAllBtn = document.getElementById('records-clear-all-btn');

  const recordsNavBtn = document.querySelector('.nav-btn[data-tab="records"]');

  if (!exposureListEl || !compareTbody) return;

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
  }

  // 그래프 x축용 짧은 시:분 표기. 분 단위로 반올림하면 마지막 SUDS 입력이
  // 직전 5분 체크와 같은 분으로 겹쳐서 축 라벨이 중복돼 보이는 경우가 많아 mm:ss로 표시
  function formatMinSec(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  // ----- 이번 주(최근 7일) 요약 -----
  function withinLastNDays(dateStr, n) {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today - date) / (24 * 60 * 60 * 1000));
    return diffDays >= 0 && diffDays < n;
  }

  // 목표 횟수가 적혀 있으면 "실제/목표"로, 없으면 실제 횟수만 보여준다.
  function formatCountWithTarget(count, target) {
    return target ? `${count}/${target}` : String(count);
  }

  function loadTargets() {
    return PEStorage.load(WEEKLY_TARGETS_KEY, {});
  }

  function saveTargets(targets) {
    PEStorage.save(WEEKLY_TARGETS_KEY, targets);
  }

  // 저장된 목표 값을 입력칸에 반영 (빈 값/0은 "목표 없음"으로 취급해 placeholder만 보여줌)
  function renderTargetInputs() {
    const targets = loadTargets();
    targetExposureInput.value = targets.exposure || '';
    targetListeningInput.value = targets.listening || '';
    targetBreathingInput.value = targets.breathing || '';
  }

  function renderWeeklySummary() {
    const exposureRecords = PEStorage.load(EXPOSURE_RECORDS_KEY, []);
    const listeningRecords = PEStorage.load(LISTENING_RECORDS_KEY, []);
    const breathingRecords = PEStorage.load(BREATHING_RECORDS_KEY, []);
    const targets = loadTargets();

    const exposureCount = exposureRecords.filter((r) => withinLastNDays(r.date, 7)).length;
    const listeningCount = listeningRecords.filter((r) => withinLastNDays(r.date, 7)).length;
    const breathingCount = breathingRecords.filter((r) => withinLastNDays(r.date, 7)).length;

    summaryExposureCountEl.textContent = formatCountWithTarget(exposureCount, targets.exposure);
    summaryListeningCountEl.textContent = formatCountWithTarget(listeningCount, targets.listening);
    summaryBreathingCountEl.textContent = formatCountWithTarget(breathingCount, targets.breathing);

    // 목표가 하나라도 설정돼 있을 때만 "이번 주 요약" 대사를 보여준다
    const hasAnyTarget = (targets.exposure || 0) + (targets.listening || 0) + (targets.breathing || 0) > 0;
    if (hasAnyTarget && window.Mascot) {
      const metAll =
        exposureCount >= (targets.exposure || 0) &&
        listeningCount >= (targets.listening || 0) &&
        breathingCount >= (targets.breathing || 0);
      const metAny = exposureCount > 0 || listeningCount > 0 || breathingCount > 0;
      if (metAll) {
        Mascot.say('records.weekFull');
      } else if (metAny) {
        Mascot.say('records.weekPartial');
      }
    }
  }

  function handleTargetChange() {
    saveTargets({
      exposure: Number(targetExposureInput.value) || 0,
      listening: Number(targetListeningInput.value) || 0,
      breathing: Number(targetBreathingInput.value) || 0,
    });
    renderWeeklySummary();
  }

  // 빈 화면: 아직 기록이 하나도 없는 상태를 "비어있는 강"으로 보여준다
  function createEmptyRiverState(title, desc) {
    const wrap = document.createElement('div');
    wrap.className = 'empty-river-state';
    wrap.innerHTML =
      '<svg class="empty-river-svg" viewBox="0 0 160 90" aria-hidden="true">' +
      '<path class="empty-river-wave empty-river-wave-1" d="M6 52 Q36 42 66 52 T126 52 T154 50" />' +
      '<path class="empty-river-wave empty-river-wave-2" d="M6 68 Q36 60 66 68 T126 68 T154 66" />' +
      '<circle class="empty-river-star" cx="26" cy="16" r="1.6" />' +
      '<circle class="empty-river-star" cx="112" cy="10" r="1.2" />' +
      '<circle class="empty-river-star" cx="138" cy="26" r="1.4" />' +
      '</svg>';
    const titleEl = document.createElement('p');
    titleEl.className = 'empty-river-title';
    titleEl.textContent = title;
    wrap.appendChild(titleEl);
    const descEl = document.createElement('p');
    descEl.className = 'placeholder-text';
    descEl.textContent = desc;
    wrap.appendChild(descEl);
    return wrap;
  }

  // ----- 실제노출 기록 목록 + 선택한 회차의 SUDS 그래프 -----
  function renderExposureList() {
    const records = PEStorage.load(EXPOSURE_RECORDS_KEY, []).slice().reverse();
    exposureListEl.innerHTML = '';

    if (records.length === 0) {
      const listeningEmpty = PEStorage.load(LISTENING_RECORDS_KEY, []).length === 0;
      const breathingEmpty = PEStorage.load(BREATHING_RECORDS_KEY, []).length === 0;

      if (listeningEmpty && breathingEmpty) {
        exposureListEl.appendChild(
          createEmptyRiverState('아직 기록이 없어요.', '첫 걸음을 기다리고 있을게요.')
        );
      } else {
        const empty = document.createElement('p');
        empty.className = 'placeholder-text';
        empty.textContent = '아직 실제노출 기록이 없습니다.';
        exposureListEl.appendChild(empty);
      }
      return;
    }

    records.forEach((rec) => {
      const item = document.createElement('div');
      item.className = 'listening-recording-item';

      const info = document.createElement('div');
      info.className = 'listening-recording-info';

      const title = document.createElement('p');
      title.className = 'hierarchy-item-desc';
      title.textContent = `${rec.date} - ${rec.itemDescription}`;
      info.appendChild(title);

      const lastEntry = rec.sudsLog[rec.sudsLog.length - 1];
      const detail = document.createElement('p');
      detail.className = 'safety-note';
      detail.textContent = `SUDS ${rec.startSUDS} → ${lastEntry.suds}, 총 ${formatDuration(rec.totalDurationMs)}`;
      info.appendChild(detail);

      item.appendChild(info);

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn btn-outline';
      viewBtn.textContent = '시간별 SUDS 그래프 보기';
      viewBtn.addEventListener('click', () => showExposureChart(rec, { scroll: true }));
      item.appendChild(viewBtn);

      exposureListEl.appendChild(item);
    });

    // 회기 내 습관화 곡선을 매번 수동으로 열지 않아도 보이도록, 가장 최근 회차를 기본으로 보여줌
    // (스크롤은 옮기지 않음 - 탭을 열었을 때 위쪽 요약부터 보여야 하므로)
    showExposureChart(records[0], { scroll: false });
  }

  function showExposureChart(record, { scroll = false } = {}) {
    exposureChartWrap.hidden = false;

    const labels = record.sudsLog.map((entry) => formatMinSec(entry.atMs));
    const data = record.sudsLog.map((entry) => entry.suds);

    if (exposureChart) exposureChart.destroy();
    exposureChart = new Chart(exposureChartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: `${record.itemDescription} (${record.date})`,
            data,
            borderColor: COLOR_PRIMARY_DARK,
            backgroundColor: COLOR_PRIMARY,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 10, title: { display: true, text: 'SUDS' } },
          x: { title: { display: true, text: '경과 시간' } },
        },
      },
    });

    if (scroll) {
      exposureChartWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ----- 위계표 항목별 회차 그래프 -----
  function renderHierarchySelect() {
    const items = PEStorage.load(HIERARCHY_KEY, []);
    const exposureRecords = PEStorage.load(EXPOSURE_RECORDS_KEY, []);
    const itemsWithRecords = items.filter((item) => exposureRecords.some((r) => r.itemId === item.id));

    hierarchySelectEl.innerHTML = '';

    if (itemsWithRecords.length === 0) {
      const option = document.createElement('option');
      option.textContent = '노출 기록이 있는 항목이 없습니다';
      hierarchySelectEl.appendChild(option);
      hierarchySelectEl.disabled = true;
      if (hierarchyTrendChart) {
        hierarchyTrendChart.destroy();
        hierarchyTrendChart = null;
      }
      return;
    }

    hierarchySelectEl.disabled = false;
    itemsWithRecords.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.description;
      hierarchySelectEl.appendChild(option);
    });

    showHierarchyTrend(itemsWithRecords[0].id);
  }

  function showHierarchyTrend(itemId) {
    const records = PEStorage.load(EXPOSURE_RECORDS_KEY, [])
      .filter((r) => r.itemId === itemId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const labels = records.map((_, i) => `${i + 1}회차`);
    const data = records.map((r) => Math.max(...r.sudsLog.map((e) => e.suds)));

    if (hierarchyTrendChart) hierarchyTrendChart.destroy();
    hierarchyTrendChart = new Chart(hierarchyTrendCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '회차별 최고 SUDS',
            data,
            borderColor: COLOR_PRIMARY_DARK,
            backgroundColor: COLOR_PRIMARY,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 10, title: { display: true, text: '최고 SUDS' } },
        },
      },
    });
  }

  // ----- 상상노출 기록 그래프 -----
  // 예전엔 듣기 전/최고/들은 후 3개 숫자만 따로 기록했지만, 지금은 실제노출과 같은 방식으로
  // sudsLog(시간별 기록) 전체를 남기므로 거기서 시작/최고/종료 값을 계산해서 쓴다.
  function renderListeningChart() {
    const records = PEStorage.load(LISTENING_RECORDS_KEY, [])
      .slice()
      .filter((r) => Array.isArray(r.sudsLog) && r.sudsLog.length > 0)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const labels = records.map((r) => r.date);

    if (listeningChart) listeningChart.destroy();
    listeningChart = new Chart(listeningChartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '시작 SUDS',
            data: records.map((r) => r.startSUDS),
            borderColor: COLOR_MUTED,
            tension: 0.3,
            fill: false,
          },
          {
            label: '최고 SUDS',
            data: records.map((r) => Math.max(...r.sudsLog.map((e) => e.suds))),
            borderColor: COLOR_ACCENT,
            tension: 0.3,
            fill: false,
          },
          {
            label: '종료 SUDS',
            data: records.map((r) => r.sudsLog[r.sudsLog.length - 1].suds),
            borderColor: COLOR_PRIMARY_DARK,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 10, title: { display: true, text: 'SUDS' } },
        },
      },
    });
  }

  // ----- 위계표 전체 비교 표 -----
  function formatChange(initial, current) {
    const diff = current - initial;
    if (diff === 0) return '변화 없음';
    return diff > 0 ? `+${diff}` : String(diff);
  }

  function renderCompareTable() {
    const items = PEStorage.load(HIERARCHY_KEY, [])
      .slice()
      .sort((a, b) => a.currentSUDS - b.currentSUDS);

    compareTbody.innerHTML = '';

    if (items.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'placeholder-text';
      cell.textContent = '위계표 항목이 없습니다.';
      row.appendChild(cell);
      compareTbody.appendChild(row);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('tr');
      [
        item.description,
        item.category,
        String(item.initialSUDS),
        String(item.currentSUDS),
        formatChange(item.initialSUDS, item.currentSUDS),
      ].forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        row.appendChild(td);
      });
      compareTbody.appendChild(row);
    });
  }

  // ----- 나의 성장 기록: 노출을 수행할 때마다 돌 하나씩 (SUDS 감소 여부와 무관) -----
  const growthPathListEl = document.getElementById('growth-path-list');

  // 기록마다 라벨 하나를 우선순위로 고른다 - 여러 조건에 겹쳐 해당해도 가장 눈에 띄는 것 하나만 보여줌
  function pickGrowthLabel(rec, index, allRecordsAsc) {
    if (index === 0) return '첫 번째 도전';
    if (rec.predictionCameTrue === 'no' || rec.predictionCameTrue === 'partial') return '예상과 달랐던 순간';
    if (rec.difference || rec.takeaway) return '새로운 경험 발견';
    const isRepeat = allRecordsAsc.slice(0, index).some((r) => r.itemId === rec.itemId);
    if (isRepeat) return '다시 도전한 순간';
    return '새로운 걸음';
  }

  function renderGrowthPath() {
    if (!growthPathListEl) return;

    const records = PEStorage.load(EXPOSURE_RECORDS_KEY, [])
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    growthPathListEl.innerHTML = '';

    if (records.length === 0) {
      growthPathListEl.appendChild(createEmptyRiverState('아직 놓인 돌이 없어요.', '노출을 시작하면 첫 돌이 놓여요.'));
      return;
    }

    records.forEach((rec, index) => {
      const stone = document.createElement('div');
      stone.className = 'growth-path-stone';
      stone.title = `${rec.date} · ${rec.itemDescription}`;

      const icon = document.createElement('span');
      icon.className = 'growth-path-stone-icon';
      icon.textContent = String(index + 1);
      stone.appendChild(icon);

      const label = document.createElement('p');
      label.className = 'growth-path-stone-label';
      label.textContent = pickGrowthLabel(rec, index, records);
      stone.appendChild(label);

      const date = document.createElement('p');
      date.className = 'growth-path-stone-date';
      date.textContent = rec.date;
      stone.appendChild(date);

      growthPathListEl.appendChild(stone);
    });

    // 가장 최근 돌이 오른쪽 끝에 있으므로, 열 때마다 거기부터 보이게 스크롤
    growthPathListEl.scrollLeft = growthPathListEl.scrollWidth;
  }

  // ----- 노출 전후 비교 카드: 시작 전 예측과 실제 경험을 나란히 -----
  const compareCardsListEl = document.getElementById('compare-cards-list');

  function renderCompareCards() {
    if (!compareCardsListEl) return;

    const records = PEStorage.load(EXPOSURE_RECORDS_KEY, [])
      .slice()
      .filter((r) => r.prediction)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    compareCardsListEl.innerHTML = '';

    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = '시작 전 예측을 적어둔 노출 기록이 아직 없습니다.';
      compareCardsListEl.appendChild(empty);
      return;
    }

    records.slice(0, 20).forEach((rec) => {
      const card = document.createElement('div');
      card.className = 'compare-card';

      const title = document.createElement('p');
      title.className = 'hierarchy-item-desc';
      title.textContent = `${rec.date} · ${rec.itemDescription}`;
      card.appendChild(title);

      const before = document.createElement('p');
      before.className = 'compare-card-row compare-card-before';
      before.innerHTML = '<span class="compare-card-label">노출 전 예상</span>';
      before.appendChild(document.createTextNode(rec.prediction));
      card.appendChild(before);

      const after = document.createElement('p');
      after.className = 'compare-card-row compare-card-after';
      after.innerHTML = '<span class="compare-card-label">실제 경험</span>';
      after.appendChild(document.createTextNode(rec.actualOutcome || rec.difference || '아직 기록되지 않았어요.'));
      card.appendChild(after);

      compareCardsListEl.appendChild(card);
    });
  }

  // ----- 나만의 경험 앨범: 노출 기록을 날짜별 일기장처럼 모아보기 -----
  const experienceAlbumListEl = document.getElementById('experience-album-list');

  function renderExperienceAlbum() {
    if (!experienceAlbumListEl) return;

    const records = PEStorage.load(EXPOSURE_RECORDS_KEY, [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    experienceAlbumListEl.innerHTML = '';

    if (records.length === 0) {
      experienceAlbumListEl.appendChild(
        createEmptyRiverState('아직 쓴 일기가 없어요.', '노출을 마치면 이곳에 하루가 기록돼요.')
      );
      return;
    }

    records.slice(0, 20).forEach((rec) => {
      const lastEntry = rec.sudsLog[rec.sudsLog.length - 1];
      const entry = document.createElement('div');
      entry.className = 'album-entry';

      const title = document.createElement('p');
      title.className = 'hierarchy-item-desc';
      title.textContent = `${rec.date} · ${rec.itemDescription}`;
      entry.appendChild(title);

      entry.appendChild(
        el('p', 'album-entry-row', `당시 느낀 감정: SUDS ${rec.startSUDS} → ${lastEntry.suds}`)
      );

      const checklistSummary = formatChecklistSummary(rec.checklist);
      if (checklistSummary) {
        entry.appendChild(el('p', 'album-entry-row', checklistSummary));
      }

      entry.appendChild(
        el('p', 'album-entry-row', `새롭게 알게 된 사실: ${rec.takeaway || rec.difference || '아직 적어둔 것이 없어요.'}`)
      );

      experienceAlbumListEl.appendChild(entry);
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 회피/안전행동 체크리스트를 사람이 읽기 좋은 한 줄로 요약 (고정 5항목 + 환자별 커스텀 항목).
  // index.html의 체크리스트 문구와 짝이 맞는 짧은 라벨로 다시 적었다.
  const CHECKLIST_LABELS = {
    phone: { label: '휴대폰 확인', category: 'avoidance' },
    rushing: { label: '서두름', category: 'avoidance' },
    overactivity: { label: '과도한 활동', category: 'avoidance' },
    companion: { label: '동행자 의지', category: 'safety' },
    safetyObject: { label: '안전 물품', category: 'safety' },
  };

  function formatChecklistSummary(checklist) {
    if (!checklist) return null;

    const items = Object.keys(CHECKLIST_LABELS).map((key) => ({
      label: CHECKLIST_LABELS[key].label,
      category: CHECKLIST_LABELS[key].category,
      checked: !!checklist[key],
    }));
    (checklist.custom || []).forEach((c) => {
      items.push({ label: c.label, category: c.category || 'avoidance', checked: !!c.checked });
    });

    const fmt = (list) => list.map((i) => `${i.label}${i.checked ? ' ✓' : ''}`).join(', ');
    const avoidance = items.filter((i) => i.category === 'avoidance');
    const safety = items.filter((i) => i.category === 'safety');

    const parts = [];
    if (avoidance.length) parts.push(`회피행동 - ${fmt(avoidance)}`);
    if (safety.length) parts.push(`안전행동 - ${fmt(safety)}`);
    return parts.join(' / ');
  }

  // ----- 의미있는 경험: SUDS 감소뿐 아니라 그 자체로 가치 있었던 순간들 -----
  function countChecked(checklist) {
    if (!checklist) return 0;
    const fixed = ['phone', 'companion', 'rushing', 'safetyObject', 'overactivity'];
    let count = fixed.filter((k) => checklist[k]).length;
    count += (checklist.custom || []).filter((c) => c.checked).length;
    return count;
  }

  function renderMeaningfulMoments() {
    if (!meaningfulMomentsListEl) return;

    const records = PEStorage.load(EXPOSURE_RECORDS_KEY, [])
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const moments = [];
    records.forEach((rec, index) => {
      const tags = [];

      if (rec.predictionCameTrue === 'no') tags.push('예상했던 일이 실제로 일어나지 않음');

      const lastEntry = rec.sudsLog[rec.sudsLog.length - 1];
      const reductionPct = rec.startSUDS > 0 ? Math.round((1 - lastEntry.suds / rec.startSUDS) * 100) : 0;
      if (!rec.endedEarly && reductionPct < 50) tags.push('불편함을 느끼면서도 상황에 머무름');

      const prevSameItem = records
        .slice(0, index)
        .reverse()
        .find((r) => r.itemId === rec.itemId);
      if (prevSameItem && countChecked(rec.checklist) < countChecked(prevSameItem.checklist)) {
        tags.push('안전 행동을 줄여봄');
      }

      if (rec.difference || rec.takeaway) tags.push('새로운 사실을 발견함');

      if (tags.length > 0) moments.push({ rec, tags });
    });

    meaningfulMomentsListEl.innerHTML = '';

    if (moments.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent = '아직 기록된 의미있는 경험이 없습니다.';
      meaningfulMomentsListEl.appendChild(empty);
      return;
    }

    moments
      .reverse()
      .slice(0, 20)
      .forEach(({ rec, tags }) => {
        const row = document.createElement('div');
        row.className = 'suds-log-row';
        row.textContent = `${rec.date} · ${rec.itemDescription} — ${tags.join(' · ')}`;
        meaningfulMomentsListEl.appendChild(row);
      });
  }

  // ----- 데이터 내보내기 / 전체 삭제 -----
  function handleExport() {
    const today = new Date().toISOString().slice(0, 10);
    PEStorage.exportJSON(`Wayfellow-backup-${today}.json`);
  }

  function handleClearAll() {
    const first = window.confirm(
      '정말로 모든 데이터를 삭제할까요? 위계표, 실제노출/상상노출/호흡 기록, 업로드한 음성 파일이 모두 사라지며 되돌릴 수 없습니다.'
    );
    if (!first) return;

    const second = window.confirm('마지막 확인입니다. 삭제하면 복구할 수 없습니다. 정말 삭제하시겠습니까?');
    if (!second) return;

    PEStorage.clearAll();
    PEAudioStorage.clearAll().then(() => {
      window.alert('모든 데이터가 삭제되었습니다.');
      location.reload();
    });
  }

  function renderAll() {
    renderWeeklySummary();
    renderGrowthPath();
    renderCompareCards();
    renderMeaningfulMoments();
    renderExperienceAlbum();
    renderExposureList();
    renderHierarchySelect();
    renderListeningChart();
    renderCompareTable();

    if (window.Mascot) {
      const anyRecords =
        PEStorage.load(EXPOSURE_RECORDS_KEY, []).length > 0 ||
        PEStorage.load(LISTENING_RECORDS_KEY, []).length > 0 ||
        PEStorage.load(BREATHING_RECORDS_KEY, []).length > 0;
      Mascot.say(anyRecords ? 'records.enter' : 'records.empty');
    }
  }

  function init() {
    renderTargetInputs();
    renderAll();

    hierarchySelectEl.addEventListener('change', () => {
      if (!hierarchySelectEl.disabled) showHierarchyTrend(hierarchySelectEl.value);
    });
    exportBtn.addEventListener('click', handleExport);
    clearAllBtn.addEventListener('click', handleClearAll);
    [targetExposureInput, targetListeningInput, targetBreathingInput].forEach((input) => {
      input.addEventListener('change', handleTargetChange);
    });

    // 기록 탭을 다시 열 때마다 다른 탭에서 쌓인 최신 데이터로 새로고침.
    // 탭 전환 class 토글은 index.html의 공용 스크립트가 같은 버튼에 나중에 등록한
    // 리스너라서(이 파일이 먼저 로드됨), 이 리스너가 먼저 실행되면 탭이 아직
    // display:none인 상태에서 차트를 만들게 된다. rAF로 한 틱 미뤄서 탭이 보인 뒤에
    // 그리도록 한다 (Chart.js가 0 크기 캔버스를 기준으로 그려버리는 것을 방지).
    if (recordsNavBtn) {
      recordsNavBtn.addEventListener('click', () => {
        requestAnimationFrame(renderAll);
      });
    }
  }

  init();
})();
