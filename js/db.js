/* =========================================================
 * IndexedDB 래퍼 (기기 내부 저장소)
 * 나중에 백엔드를 붙이면 store.js 가 이 대신 서버 API 를 호출하게 됩니다.
 * ========================================================= */
const DB = (() => {
  const NAME = 'cheongun-attendance';
  const VERSION = 3;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        const has = n => d.objectStoreNames.contains(n);
        if (!has('members')) d.createObjectStore('members', { keyPath: 'id' });
        if (!has('attendance')) {
          const a = d.createObjectStore('attendance', { keyPath: 'id' });
          a.createIndex('memberId', 'memberId');
          a.createIndex('date', 'date');
        }
        if (!has('photos')) d.createObjectStore('photos');   // key = attendance.id, value = Blob
        if (!has('mileage')) {
          const m = d.createObjectStore('mileage', { keyPath: 'id' });
          m.createIndex('memberId', 'memberId');
        }
        if (!has('discharged')) d.createObjectStore('discharged', { keyPath: 'id' });
        if (!has('settings')) d.createObjectStore('settings');
        if (!has('warnings')) d.createObjectStore('warnings', { keyPath: 'id' }); // [경고-확인필요] 기록
        if (!has('syncQueue')) d.createObjectStore('syncQueue', { keyPath: 'id' }); // 백엔드 동기화 대기열
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  return {
    get: (s, k) => tx(s, 'readonly', st => st.get(k)),
    all: (s) => tx(s, 'readonly', st => st.getAll()),
    keys: (s) => tx(s, 'readonly', st => st.getAllKeys()),
    byIndex: (s, i, v) => tx(s, 'readonly', st => st.index(i).getAll(v)),
    put: (s, v, k) => tx(s, 'readwrite', st => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    clear: (s) => tx(s, 'readwrite', st => st.clear()),
  };
})();
