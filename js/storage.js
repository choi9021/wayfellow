// storage.js - 로컬 저장소 공용 유틸리티
//
// 이 앱의 모든 데이터는 기기 안에만 저장되고 외부 서버로는 전송되지 않습니다.
// - PEStorage: 텍스트/숫자 데이터 (localStorage)
// - PEAudioStorage: 음성 파일 (IndexedDB) - 녹음듣기 탭(listening.js)에서 사용

const PEStorage = (() => {
  // 다른 사이트/앱의 localStorage와 섞이지 않도록 모든 키에 붙이는 접두사
  const PREFIX = 'pe-helper:';

  // 지정한 키로 데이터 저장 (객체/배열도 JSON으로 변환해 저장)
  function save(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('[PEStorage] 저장에 실패했습니다:', key, error);
      return false;
    }
  }

  // 지정한 키의 데이터 불러오기. 저장된 값이 없으면 defaultValue 반환
  function load(key, defaultValue = null) {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('[PEStorage] 불러오기에 실패했습니다:', key, error);
      return defaultValue;
    }
  }

  // 지정한 키 하나만 삭제
  function remove(key) {
    localStorage.removeItem(PREFIX + key);
  }

  // 이 앱이 저장한 모든 데이터를 삭제 (다른 사이트의 저장 데이터는 건드리지 않음)
  function clearAll() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }

  // 이 앱이 저장한 모든 데이터를 접두사를 뗀 키 기준으로 모아서 반환
  function getAllData() {
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
      if (!fullKey || !fullKey.startsWith(PREFIX)) continue;

      const shortKey = fullKey.slice(PREFIX.length);
      const raw = localStorage.getItem(fullKey);
      try {
        result[shortKey] = JSON.parse(raw);
      } catch (error) {
        result[shortKey] = raw;
      }
    }
    return result;
  }

  // 전체 데이터를 JSON 파일로 내보내기 (환자/치료자가 백업하거나 공유할 때 사용)
  function exportJSON(filename = 'Wayfellow-backup.json') {
    const backup = {
      exportedAt: new Date().toISOString(),
      data: getAllData(),
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  // 내보내기 JSON({exportedAt, data})을 그대로 복원. 녹음 음성 파일(IndexedDB)은 포함돼 있지
  // 않으므로 복원 대상이 아니다 - 호출하는 쪽에서 사용자에게 이 점을 미리 알려야 한다.
  function importJSON(backup) {
    if (!backup || typeof backup.data !== 'object' || backup.data === null) {
      throw new Error('백업 파일 형식이 올바르지 않습니다.');
    }
    Object.entries(backup.data).forEach(([key, value]) => {
      save(key, value);
    });
  }

  return { save, load, remove, clearAll, getAllData, exportJSON, importJSON };
})();

// PEAudioStorage - 음성 파일(Blob) 저장용 IndexedDB 유틸리티
// 레코드 구조: { id, name, blob, createdAt }
const PEAudioStorage = (() => {
  const DB_NAME = 'pe-helper-audio-db';
  const DB_VERSION = 1;
  const STORE_NAME = 'audioFiles';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  // 음성 파일 저장 (record.blob은 File 또는 Blob)
  async function save(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // id로 레코드 하나 불러오기 (blob 포함)
  async function load(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  // 저장된 레코드 불러오기. category를 주면 record.category가 일치하는 것만 반환
  // (녹음듣기의 상상노출 녹음과 호흡 탭의 안내 음성이 같은 저장소를 쓰지만 섞이지 않도록 구분)
  async function listAll(category) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const all = request.result || [];
        resolve(category ? all.filter((r) => r.category === category) : all);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // id로 레코드 하나 삭제
  async function remove(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // 저장된 모든 음성 파일 삭제 (기록 탭의 "전체 삭제"에서 사용)
  async function clearAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { save, load, listAll, remove, clearAll };
})();
