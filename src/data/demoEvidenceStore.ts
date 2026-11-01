const DATABASE_NAME = "ftc.prototype.evidence.v1";
const DATABASE_VERSION = 1;
const FILE_STORE = "files";

interface StoredDemoEvidence {
  id: string;
  blob: Blob;
  displayName: string;
  mediaType: string;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("พื้นที่จัดเก็บไฟล์ในเบราว์เซอร์นี้ไม่พร้อมใช้งาน"));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FILE_STORE)) request.result.createObjectStore(FILE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("เปิดพื้นที่จัดเก็บไฟล์ไม่สำเร็จ"));
    request.onblocked = () => reject(new Error("พื้นที่จัดเก็บไฟล์กำลังถูกใช้งานในหน้าต่างอื่น"));
  });
}

function runTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => T): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    let result: T;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(FILE_STORE, mode);
      result = action(transaction.objectStore(FILE_STORE));
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("บันทึกไฟล์ไม่สำเร็จ"));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("บันทึกไฟล์ไม่สำเร็จ"));
    };
  }));
}

export function storeDemoEvidenceFile(id: string, file: File): Promise<void> {
  const value: StoredDemoEvidence = { id, blob: file, displayName: file.name, mediaType: file.type };
  return runTransaction("readwrite", (store) => { store.put(value); });
}

export function readDemoEvidenceFile(id: string): Promise<Blob | null> {
  return openDatabase().then((database) => new Promise<Blob | null>((resolve, reject) => {
    let result: Blob | null = null;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(FILE_STORE, "readonly");
      const request = transaction.objectStore(FILE_STORE).get(id) as IDBRequest<StoredDemoEvidence | undefined>;
      request.onsuccess = () => {
        const value = request.result;
        result = value && value.blob instanceof Blob ? value.blob : null;
      };
      request.onerror = () => reject(request.error ?? new Error("อ่านไฟล์ไม่สำเร็จ"));
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("อ่านไฟล์ไม่สำเร็จ"));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("อ่านไฟล์ไม่สำเร็จ"));
    };
  }));
}

export function deleteDemoEvidenceFiles(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return runTransaction("readwrite", (store) => {
    for (const id of ids) store.delete(id);
  });
}
