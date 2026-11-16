import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Account, AppData, Category, IncomeSource, QuickButton, Recurring, Tag, Tx } from '../domain/types';
import { seedData } from './seed';

class AppDb extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Tx, string>;
  categories!: Table<Category, string>;
  tags!: Table<Tag, string>;
  incomeSources!: Table<IncomeSource, string>;
  recurrings!: Table<Recurring, string>;
  quickButtons!: Table<QuickButton, string>;

  constructor() {
    super('balance-of-payment');
    this.version(1).stores({
      accounts: 'id',
      transactions: 'id, date, accountId, recurringId',
      categories: 'id',
      tags: 'id',
      incomeSources: 'id',
      recurrings: 'id',
      quickButtons: 'id',
    });
    this.on('populate', (tx) => {
      const seed = seedData();
      tx.table('accounts').bulkAdd(seed.accounts);
      tx.table('categories').bulkAdd(seed.categories);
      tx.table('tags').bulkAdd(seed.tags);
      tx.table('incomeSources').bulkAdd(seed.incomeSources);
      tx.table('recurrings').bulkAdd(seed.recurrings);
      tx.table('quickButtons').bulkAdd(seed.quickButtons);
    });
  }
}

export const db = new AppDb();

export const newId = () => crypto.randomUUID();

const byOrder = <T extends { order: number }>(list: T[]) => [...list].sort((a, b) => a.order - b.order);

export async function loadAll(): Promise<AppData> {
  const [accounts, transactions, categories, tags, incomeSources, recurrings, quickButtons] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.categories.toArray(),
    db.tags.toArray(),
    db.incomeSources.toArray(),
    db.recurrings.toArray(),
    db.quickButtons.toArray(),
  ]);
  return {
    accounts: byOrder(accounts),
    transactions,
    categories: byOrder(categories),
    tags: byOrder(tags),
    incomeSources: byOrder(incomeSources),
    recurrings: byOrder(recurrings),
    quickButtons: byOrder(quickButtons),
  };
}

/** 全データ。読み込み中は undefined。DBが変わると自動で再取得する。 */
export const useAppData = () => useLiveQuery(loadAll);

/** 全データを置き換える(インポート用)。 */
export async function replaceAll(data: AppData): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.accounts.bulkAdd(data.accounts);
    await db.transactions.bulkAdd(data.transactions);
    await db.categories.bulkAdd(data.categories);
    await db.tags.bulkAdd(data.tags);
    await db.incomeSources.bulkAdd(data.incomeSources);
    await db.recurrings.bulkAdd(data.recurrings);
    await db.quickButtons.bulkAdd(data.quickButtons);
  });
}

/** 全データを消して初期状態(プリセットのみ)に戻す。 */
export const resetAll = () => replaceAll({ ...seedData(), transactions: [] });

/**
 * 記録を保存する。立替精算の収入なら、選んだ立替支出に精算済みの紐付けを付け直す。
 * settledIds を渡さなければ紐付けは変更しない。
 */
export async function saveTx(tx: Tx, settledIds?: string[]): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    await db.transactions.put(tx);
    if (!settledIds) return;
    const linked = await db.transactions.filter((t) => t.settledByTxId === tx.id).toArray();
    for (const t of linked) {
      if (!settledIds.includes(t.id)) await db.transactions.update(t.id, { settledByTxId: undefined });
    }
    for (const id of settledIds) await db.transactions.update(id, { settledByTxId: tx.id });
  });
}

/** 記録を削除する。精算の紐付けがあれば未精算に戻す。 */
export async function deleteTx(id: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const linked = await db.transactions.filter((t) => t.settledByTxId === id).toArray();
    for (const t of linked) await db.transactions.update(t.id, { settledByTxId: undefined });
    await db.transactions.delete(id);
  });
}
