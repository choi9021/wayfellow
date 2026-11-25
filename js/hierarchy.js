// hierarchy.js - 위계표(피하는 상황을 SUDS 순으로 정렬한 목록) 기능
//
// 저장 데이터 구조 (localStorage 키: 'hierarchy-items', 배열):
// {
//   id: string,            // 고유 id
//   category: string,      // 카테고리 (예: 외출, 혼자있기)
//   description: string,   // 상황 설명
//   initialSUDS: number,   // 처음 입력했을 때의 SUDS (이후 변경되지 않음)
//   currentSUDS: number,   // 가장 최근 SUDS (수정 시 갱신)
//   safetyNote: string,    // 실제 안전성 메모
//   isThisWeek: boolean,   // 이번 주 과제로 선택했는지 (치료자·환자가 매 회기 직접 체크/해제)
//   createdAt: string,     // 생성 시각(ISO)
//   updatedAt: string,     // 마지막 수정 시각(ISO)
// }

(function () {
  const STORAGE_KEY = 'hierarchy-items';

  // 처음 사용할 때 보여줄 예시 데이터 — 상황은 치료자·내담자가 상담을 거쳐 직접 추가하므로 비워둠
  const DEFAULT_ITEMS = [];

  // 무엇을 피하는지 떠올리기 어려울 때 고를 수 있는 흔한 상황 예시 — 상황은 치료자·내담자가 상담을 거쳐 직접 추가하므로 비워둠
  const EXAMPLE_SITUATIONS = [];

  let items = [];
  let editingId = null; // null이면 "새로 추가" 모드, 아니면 해당 id를 수정 중

  // DOM 요소
  const listEl = document.getElementById('hierarchy-list');
  const weeklyListEl = document.getElementById('hierarchy-weekly-list');
  const addBtn = document.getElementById('hierarchy-add-btn');
  const exampleBtn = document.getElementById('hierarchy-example-btn');
  const examplePanel = document.getElementById('hierarchy-example-panel');
  const exampleListEl = document.getElementById('hierarchy-example-list');
  const formPanel = document.getElementById('hierarchy-form-panel');
  const formTitle = document.getElementById('hierarchy-form-title');
  const form = document.getElementById('hierarchy-form');
  const categoryInput = document.getElementById('hierarchy-category');
  const descriptionInput = document.getElementById('hierarchy-description');
  const sudsInput = document.getElementById('hierarchy-suds');
  const sudsValueSpan = document.getElementById('hierarchy-suds-value');
  const sudsLabelText = document.getElementById('hierarchy-suds-label-text');
  const initialSudsNote = document.getElementById('hierarchy-initial-suds-note');
  const safetyNoteInput = document.getElementById('hierarchy-safety-note');
  const cancelBtn = document.getElementById('hierarchy-cancel-btn');

  // 위계표 탭이 없는 화면(아직 로드 전)에서는 아무 것도 하지 않음
  if (!listEl || !form || !weeklyListEl) return;

  function generateId() {
    return 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // 빈 화면: 아직 디딤돌이 하나도 없는 상태를 "비어있는 강"으로 보여준다
  // (일부러 예시 데이터를 채우지 않은 이유가 화면으로도 자연스럽게 전달되도록)
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

  function loadItems() {
    const saved = PEStorage.load(STORAGE_KEY, null);
    if (saved !== null) {
      items = saved;
      return;
    }
    // 저장된 데이터가 없으면 예시 데이터로 시작
    const now = new Date().toISOString();
    items = DEFAULT_ITEMS.map((d) => ({
      id: generateId(),
      category: d.category,
      description: d.description,
      initialSUDS: d.suds,
      currentSUDS: d.suds,
      safetyNote: '',
      isThisWeek: false,
      createdAt: now,
      updatedAt: now,
    }));
    saveItems();
  }

  function saveItems() {
    PEStorage.save(STORAGE_KEY, items);
  }

  function render() {
    const sorted = items.slice().sort((a, b) => a.currentSUDS - b.currentSUDS);

    listEl.innerHTML = '';

    if (sorted.length === 0) {
      listEl.appendChild(createEmptyRiverState(
        '아직 놓인 돌이 없어요.',
        '다음 회기에 치료자와 함께 첫 돌을 놓아봐요.'
      ));
      if (window.Mascot) Mascot.say('hierarchy.empty');
      return;
    }

    sorted.forEach((item) => {
      listEl.appendChild(createItemCard(item));
    });
  }

  function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'hierarchy-item';
    card.dataset.id = item.id;

    // 헤더: 카테고리 배지
    const header = document.createElement('div');
    header.className = 'hierarchy-item-header';

    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'category-badge';
    categoryBadge.textContent = item.category;
    header.appendChild(categoryBadge);

    if (item.isThisWeek) {
      const weeklyBadge = document.createElement('span');
      weeklyBadge.className = 'weekly-badge';
      weeklyBadge.textContent = '이번 주 과제';
      header.appendChild(weeklyBadge);
    }

    card.appendChild(header);

    // 상황 설명
    const desc = document.createElement('p');
    desc.className = 'hierarchy-item-desc';
    desc.textContent = item.description;
    card.appendChild(desc);

    // SUDS 표시 (현재 / 최초)
    const sudsDisplay = document.createElement('div');
    sudsDisplay.className = 'suds-display';

    const sudsCurrent = document.createElement('span');
    sudsCurrent.className = 'suds-current';
    sudsCurrent.textContent = `현재 SUDS: ${item.currentSUDS}`;
    sudsDisplay.appendChild(sudsCurrent);

    const sudsInitial = document.createElement('span');
    sudsInitial.className = 'suds-initial';
    sudsInitial.textContent = `최초 SUDS: ${item.initialSUDS}`;
    sudsDisplay.appendChild(sudsInitial);

    card.appendChild(sudsDisplay);

    // 안전성 메모
    const safetyNote = document.createElement('p');
    safetyNote.className = 'safety-note';
    safetyNote.textContent = item.safetyNote
      ? `안전성 메모: ${item.safetyNote}`
      : '작성된 안전성 메모가 없습니다.';
    card.appendChild(safetyNote);

    // 이번 주 과제 선택 체크박스
    const weeklyLabel = document.createElement('label');
    weeklyLabel.className = 'checklist-item weekly-toggle';

    const weeklyCheckbox = document.createElement('input');
    weeklyCheckbox.type = 'checkbox';
    weeklyCheckbox.checked = !!item.isThisWeek;
    weeklyCheckbox.addEventListener('change', () => toggleWeekly(item.id));
    weeklyLabel.appendChild(weeklyCheckbox);
    weeklyLabel.appendChild(document.createTextNode('이번 주 과제로 선택'));
    card.appendChild(weeklyLabel);

    // 액션 버튼들
    const actions = document.createElement('div');
    actions.className = 'hierarchy-item-actions';

    const startExposureBtn = document.createElement('button');
    startExposureBtn.type = 'button';
    startExposureBtn.className = 'btn btn-start';
    startExposureBtn.textContent = '이 과제로 노출 시작';
    startExposureBtn.addEventListener('click', () => startExposure(item.id));
    actions.appendChild(startExposureBtn);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-outline';
    editBtn.textContent = '수정';
    editBtn.addEventListener('click', () => openEditForm(item.id));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-outline btn-delete';
    deleteBtn.textContent = '삭제';
    deleteBtn.addEventListener('click', () => deleteItem(item.id));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);

    return card;
  }

  // 이번 주 과제로 고른 항목만 모아서 보여주는 요약 영역
  function renderWeeklyList() {
    const weeklyItems = items.filter((i) => i.isThisWeek).sort((a, b) => a.currentSUDS - b.currentSUDS);

    weeklyListEl.innerHTML = '';

    if (weeklyItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder-text';
      empty.textContent =
        '아직 이번 주 과제로 선택한 상황이 없습니다. 아래 전체 목록에서 "이번 주 과제로 선택"을 체크해보세요.';
      weeklyListEl.appendChild(empty);
      return;
    }

    weeklyItems.forEach((item) => {
      weeklyListEl.appendChild(createWeeklyCard(item));
    });
  }

  function createWeeklyCard(item) {
    const card = document.createElement('div');
    card.className = 'hierarchy-item';

    const header = document.createElement('div');
    header.className = 'hierarchy-item-header';
    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'category-badge';
    categoryBadge.textContent = item.category;
    header.appendChild(categoryBadge);
    card.appendChild(header);

    const desc = document.createElement('p');
    desc.className = 'hierarchy-item-desc';
    desc.textContent = item.description;
    card.appendChild(desc);

    const suds = document.createElement('p');
    suds.className = 'suds-current';
    suds.textContent = `현재 SUDS: ${item.currentSUDS}`;
    card.appendChild(suds);

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'btn btn-start';
    startBtn.textContent = '이 과제로 노출 시작';
    startBtn.addEventListener('click', () => startExposure(item.id));
    card.appendChild(startBtn);

    return card;
  }

  function toggleWeekly(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    item.isThisWeek = !item.isThisWeek;
    saveItems();
    render();
    renderWeeklyList();

    if (item.isThisWeek && window.Mascot) Mascot.say('hierarchy.weeklySet');
  }

  // 패널 전환: 폼과 예시 목록 중 하나만 보이도록 정리
  function showPanel(panel) {
    [examplePanel, formPanel].forEach((p) => {
      p.hidden = p !== panel;
    });
  }

  function hideAllPanels() {
    examplePanel.hidden = true;
    formPanel.hidden = true;
  }

  function resetForm() {
    categoryInput.value = '';
    descriptionInput.value = '';
    sudsInput.value = 5;
    sudsValueSpan.textContent = '5';
    safetyNoteInput.value = '';
  }

  function openAddForm() {
    editingId = null;
    resetForm();
    formTitle.textContent = '새 상황 추가';
    sudsLabelText.textContent = '예상 SUDS';
    initialSudsNote.hidden = true;
    showPanel(formPanel);
    categoryInput.focus();
  }

  function openEditForm(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    editingId = id;
    categoryInput.value = item.category;
    descriptionInput.value = item.description;
    sudsInput.value = item.currentSUDS;
    sudsValueSpan.textContent = String(item.currentSUDS);
    safetyNoteInput.value = item.safetyNote;

    formTitle.textContent = '상황 수정';
    sudsLabelText.textContent = '현재 SUDS';
    initialSudsNote.hidden = false;
    initialSudsNote.textContent = `최초 SUDS: ${item.initialSUDS} (최초 SUDS는 변경되지 않습니다)`;

    showPanel(formPanel);
    categoryInput.focus();
  }

  function closeForm() {
    editingId = null;
    hideAllPanels();
  }

  function handleFormSubmit(e) {
    e.preventDefault();

    const category = categoryInput.value.trim();
    const description = descriptionInput.value.trim();
    const sudsValue = Number(sudsInput.value);
    const safetyNote = safetyNoteInput.value.trim();

    if (!category || !description) return;

    const now = new Date().toISOString();
    const wasEmpty = items.length === 0;

    if (editingId === null) {
      items.push({
        id: generateId(),
        category,
        description,
        initialSUDS: sudsValue,
        currentSUDS: sudsValue,
        safetyNote,
        isThisWeek: false,
        createdAt: now,
        updatedAt: now,
      });
      if (wasEmpty && window.Mascot) Mascot.say('hierarchy.firstAdded');
    } else {
      const item = items.find((i) => i.id === editingId);
      if (item) {
        item.category = category;
        item.description = description;
        item.currentSUDS = sudsValue; // 최초 SUDS(initialSUDS)는 그대로 유지
        item.safetyNote = safetyNote;
        item.updatedAt = now;
      }
    }

    saveItems();
    render();
    renderWeeklyList();
    closeForm();
  }

  function deleteItem(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const confirmed = window.confirm(`"${item.description}" 상황을 삭제할까요?`);
    if (!confirmed) return;

    items = items.filter((i) => i.id !== id);
    saveItems();
    render();
    renderWeeklyList();
  }

  // 위계표 항목으로 실제노출 과제를 시작: 선택한 항목을 저장하고 실제노출 탭으로 이동
  function startExposure(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    PEStorage.save('selectedExposureItemId', item.id);
    // exposure.js가 대기 화면을 바로 새로고침할 수 있도록 알림
    window.dispatchEvent(new CustomEvent('pe:exposure-item-selected', { detail: { itemId: item.id } }));

    if (window.PEApp && typeof window.PEApp.switchTab === 'function') {
      window.PEApp.switchTab('exposure');
    }
  }

  function renderExampleList() {
    exampleListEl.innerHTML = '';
    EXAMPLE_SITUATIONS.forEach((example) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'example-item';
      btn.textContent = `${example.description} (${example.category})`;
      btn.addEventListener('click', () => {
        openAddForm();
        categoryInput.value = example.category;
        descriptionInput.value = example.description;
      });
      exampleListEl.appendChild(btn);
    });
  }

  function init() {
    loadItems();
    render();
    renderWeeklyList();
    renderExampleList();
    // 예시 상황이 없으면(상담으로 직접 채우기 전) 버튼 자체를 숨김 — 목록이 채워지면 다시 나타남
    exampleBtn.hidden = EXAMPLE_SITUATIONS.length === 0;

    addBtn.addEventListener('click', openAddForm);
    exampleBtn.addEventListener('click', () => {
      if (examplePanel.hidden) {
        showPanel(examplePanel);
      } else {
        hideAllPanels();
      }
    });
    cancelBtn.addEventListener('click', closeForm);
    form.addEventListener('submit', handleFormSubmit);
    sudsInput.addEventListener('input', () => {
      sudsValueSpan.textContent = sudsInput.value;
    });
  }

  init();
})();
