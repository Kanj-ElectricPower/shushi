import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MonthNav, Select, nameOf, signedYen, useData, yen } from '../components/ui';
import { formatDate, monthOf, today } from '../domain/dates';
import type { AppData, Tx } from '../domain/types';

export function txTitle(tx: Tx, data: AppData): string {
  switch (tx.kind) {
    case 'expense':
      return nameOf(data.categories, tx.categoryId, 'カテゴリなし');
    case 'income':
      return nameOf(data.incomeSources, tx.incomeSourceId, '収入');
    case 'transfer':
      return `${nameOf(data.accounts, tx.accountId)} → ${nameOf(data.accounts, tx.toAccountId)}`;
    case 'adjustment':
      return '不明金(残高照合)';
  }
}

export function History() {
  const data = useData();
  const navigate = useNavigate();
  const [month, setMonth] = useState(monthOf(today()));
  const [categoryId, setCategoryId] = useState('');
  const [tagId, setTagId] = useState('');
  const [accountId, setAccountId] = useState('');

  const txs = data.transactions
    .filter((tx) => monthOf(tx.date) === month)
    .filter((tx) => !categoryId || tx.categoryId === categoryId)
    .filter((tx) => !tagId || tx.tagId === tagId)
    .filter((tx) => !accountId || tx.accountId === accountId || tx.toAccountId === accountId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const days = [...new Set(txs.map((tx) => tx.date))];
  const expenseTotal = txs.filter((tx) => tx.kind === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
  const incomeTotal = txs.filter((tx) => tx.kind === 'income' && !tx.beforeStart).reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <>
      <h1>履歴</h1>
      <MonthNav month={month} onChange={setMonth} />
      <div className="grid2">
        <label className="field">
          <span>カテゴリ</span>
          <Select value={categoryId} onChange={setCategoryId} options={data.categories} empty="すべて" />
        </label>
        <label className="field">
          <span>目的タグ</span>
          <Select value={tagId} onChange={setTagId} options={data.tags} empty="すべて" />
        </label>
      </div>
      <label className="field">
        <span>口座・カード</span>
        <Select value={accountId} onChange={setAccountId} options={data.accounts} empty="すべて" />
      </label>
      <p className="sub num">
        表示中の合計(立替を含む): 支出 {yen(expenseTotal)} / 収入 {yen(incomeTotal)}
      </p>

      {days.length === 0 && <p className="muted">この条件に合う記録はありません。</p>}
      {days.map((day) => (
        <section key={day}>
          <h2>{formatDate(day)}</h2>
          <div className="card flush">
            {txs
              .filter((tx) => tx.date === day)
              .map((tx) => (
                <button className="row" key={tx.id} onClick={() => navigate(`/entry/${tx.id}`)}>
                  <div className="main">
                    <div className="title">
                      {txTitle(tx, data)}
                      {tx.reimbursable && <span className="badge">{tx.settledByTxId ? '立替・精算済' : '立替'}</span>}
                      {tx.beforeStart && <span className="badge">記録開始前</span>}
                    </div>
                    <div className="sub title">
                      {[
                        tx.kind === 'expense' ? nameOf(data.tags, tx.tagId, '') : '',
                        tx.kind === 'transfer' ? '振替' : tx.beforeStart ? '残高・収支に含めない' : nameOf(data.accounts, tx.accountId),
                        tx.memo,
                      ]
                        .filter(Boolean)
                        .join('・')}
                    </div>
                  </div>
                  <div className={`num ${tx.kind === 'expense' ? 'expense' : tx.kind === 'income' ? 'income' : 'muted'}`}>
                    {tx.kind === 'expense' ? yen(-tx.amount) : tx.kind === 'transfer' ? yen(tx.amount) : signedYen(tx.amount)}
                  </div>
                </button>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
