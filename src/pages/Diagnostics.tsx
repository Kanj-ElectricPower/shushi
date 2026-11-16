import Dexie from 'dexie';
import { useState } from 'react';
import { db } from '../db/schema';

/**
 * 保存が終わらない不具合の調査用。端末の情報と、書き込みが完了するまでの時間を測る。
 * 本番データは変えない(診断用の一時データを書いて、同じ処理の中で消す)。
 */

interface Result {
  label: string;
  ok: boolean;
  detail: string;
}

const DIAG_ID = '__diagnostics__';
const TIMEOUT_MS = 8000;

async function timed(label: string, fn: () => Promise<unknown>): Promise<Result> {
  const t0 = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${TIMEOUT_MS / 1000}秒たっても完了しませんでした`)), TIMEOUT_MS);
    });
    await Promise.race([fn(), timeout]);
    return { label, ok: true, detail: `${Math.round(performance.now() - t0)}ms` };
  } catch (e) {
    return { label, ok: false, detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

/** Dexie を通さず、ブラウザの IndexedDB に直接書き込む。 */
async function rawWrite(): Promise<void> {
  const open = indexedDB.open('balance-of-payment');
  open.onblocked = () => undefined;
  const raw = await idbRequest(open);
  try {
    const tx = raw.transaction('tags', 'readwrite');
    const done = txDone(tx);
    const store = tx.objectStore('tags');
    store.put({ id: DIAG_ID, name: 'diag', order: -1 });
    store.delete(DIAG_ID);
    await done;
  } finally {
    raw.close();
  }
}

async function environment(): Promise<string[]> {
  const lines = [
    `UA: ${navigator.userAgent}`,
    `表示: ${matchMedia('(display-mode: standalone)').matches ? 'インストール済みアプリ' : 'ブラウザのタブ'}`,
    `Service Worker 制御: ${navigator.serviceWorker?.controller ? 'あり' : 'なし'}`,
    `Dexie: ${Dexie.semVer} / DB版: ${db.verno} / 接続: ${db.isOpen() ? '開' : '閉'}`,
  ];
  try {
    lines.push(`永続化: ${(await navigator.storage?.persisted?.()) ? 'あり' : 'なし'}`);
    const est = await navigator.storage?.estimate?.();
    if (est) lines.push(`使用量: ${Math.round((est.usage ?? 0) / 1024)}KB / 上限 ${Math.round((est.quota ?? 0) / 1024 / 1024)}MB`);
  } catch (e) {
    lines.push(`ストレージ情報: 取得できず(${String(e)})`);
  }
  return lines;
}

export function DiagnosticsSection() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState('');

  const run = async () => {
    setRunning(true);
    setCopied('');
    setReport('診断中…(最大30秒ほどかかります)');
    const results: Result[] = [];
    results.push(await timed('読み込み(Dexie)', () => db.tags.toArray()));
    results.push(await timed('書き込み(IndexedDB直接)', rawWrite));
    results.push(
      await timed('書き込み(Dexie・まとめて)', () =>
        db.transaction('rw', db.tags, async () => {
          await db.tags.put({ id: DIAG_ID, name: 'diag', order: -1 });
          await db.tags.delete(DIAG_ID);
        }),
      ),
    );
    // 設定画面の保存と同じ書き方(1件ずつ)
    results.push(await timed('書き込み(Dexie・1件ずつ)', () => db.tags.put({ id: DIAG_ID, name: 'diag', order: -1 })));
    results.push(await timed('後片付け(Dexie)', () => db.tags.delete(DIAG_ID)));
    const env = await environment();
    setReport(
      [
        `診断日時: ${new Date().toLocaleString('ja-JP')}`,
        ...results.map((r) => `${r.ok ? 'OK ' : 'NG '} ${r.label}: ${r.detail}`),
        ...env,
      ].join('\n'),
    );
    setRunning(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied('コピーしました。');
    } catch {
      setCopied('コピーできませんでした。下の文字を長押しして選択・コピーしてください。');
    }
  };

  return (
    <>
      <p className="sub">
        保存に時間がかかる・終わらないときの調査用です。診断用の一時データを書いてすぐ消すだけで、登録済みのデータは変わりません。
      </p>
      <div className="actions">
        <button className="btn primary" onClick={() => void run()} disabled={running}>
          {running ? '診断中…' : '診断を実行'}
        </button>
        {report && !running && (
          <button className="btn" onClick={() => void copy()}>
            結果をコピー
          </button>
        )}
      </div>
      {copied && <p className="sub">{copied}</p>}
      {report && (
        <pre className="card" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.8rem', userSelect: 'text' }}>
          {report}
        </pre>
      )}
    </>
  );
}
