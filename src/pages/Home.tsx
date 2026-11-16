import { Link, useNavigate } from 'react-router-dom';
import { lastBackupAt, signedYen, toast, useBusy, useData, yen } from '../components/ui';
import { db, newId, saveTx } from '../db/schema';
import { accountBalance, cardUnpaid, nextCardPayment } from '../domain/balance';
import { formatDate, formatMonth, monthOf, today } from '../domain/dates';
import { isComplete, pendingItems, type PendingItem } from '../domain/recurring';
import { monthSummary, unsettledReimbursables } from '../domain/summary';
import type { Tx } from '../domain/types';
import type { EntryState } from './Entry';

const BACKUP_REMIND_DAYS = 30;

export function Home() {
  const data = useData();
  const navigate = useNavigate();
  const { busy, run } = useBusy();
  const todayDate = today();
  const month = monthOf(todayDate);
  const summary = monthSummary(data.transactions, data.incomeSources, month);
  const pending = pendingItems(data.recurrings, data.accounts, data.transactions, todayDate);
  const accounts = data.accounts.filter((a) => !a.archived);
  const money = accounts.filter((a) => a.type === 'bank' || a.type === 'ic' || a.type === 'qr');
  const cards = accounts.filter((a) => a.type === 'card');
  const nisa = accounts.filter((a) => a.type === 'nisa');
  const unsettled = unsettledReimbursables(data.transactions).reduce((sum, t) => sum + t.amount, 0);
  // バックアップの催促: 最後の書き出し(まだなら最初の記録)から30日たったら出す
  const lastBackup = lastBackupAt();
  const backupBase =
    lastBackup ?? data.transactions.reduce<number | undefined>((min, t) => (min === undefined || t.createdAt < min ? t.createdAt : min), undefined);
  const backupDue = backupBase !== undefined && data.transactions.length > 0 && Date.now() - backupBase > BACKUP_REMIND_DAYS * 86400000;

  const pendingTx = (item: PendingItem): Partial<Tx> => ({
    ...item.template,
    date: item.date,
    recurringId: item.recurringId,
    recurringDate: item.recurringDate,
  });

  const confirm = async (item: PendingItem) => {
    await saveTx({ ...(pendingTx(item) as Tx), id: newId(), createdAt: Date.now() });
    toast(`「${item.name}」を記録しました`);
  };

  const edit = (item: PendingItem) => {
    const state: EntryState = { initial: pendingTx(item), title: `${item.name}の確定` };
    navigate('/entry', { state });
  };

  const skip = async (item: PendingItem) => {
    if (!window.confirm(`${formatDate(item.date)}の「${item.name}」をスキップしますか？`)) return;
    if (item.cardId) {
      const card = data.accounts.find((a) => a.id === item.cardId);
      if (card) await db.accounts.update(card.id, { skipped: [...(card.skipped ?? []), item.recurringDate] });
    } else {
      const rec = data.recurrings.find((r) => r.id === item.recurringId);
      if (rec) await db.recurrings.update(rec.id, { skipped: [...rec.skipped, item.recurringDate] });
    }
    toast('スキップしました');
  };

  return (
    <>
      <h1>{formatMonth(month)}の収支</h1>
      <div className="card">
        <div className="summary">
          <div>
            <div className="label">収入</div>
            <div className="value income">{yen(summary.income)}</div>
          </div>
          <div>
            <div className="label">支出</div>
            <div className="value expense">{yen(summary.expense)}</div>
          </div>
          <div>
            <div className="label">収支</div>
            <div className={`value ${summary.net < 0 ? 'expense' : ''}`}>{signedYen(summary.net)}</div>
          </div>
        </div>
        {(summary.adjustment !== 0 || summary.reimbursementDiff !== 0) && (
          <div className="sub" style={{ marginTop: 8 }}>
            収支には{summary.adjustment !== 0 && ` 不明金 ${signedYen(summary.adjustment)}`}
            {summary.reimbursementDiff !== 0 && ` 立替精算の差額 ${signedYen(summary.reimbursementDiff)}`} を含みます
          </div>
        )}
      </div>

      {backupDue && (
        <div className="notice">
          {lastBackup ? `バックアップを${BACKUP_REMIND_DAYS}日以上書き出していません。` : 'まだバックアップを書き出していません。'}
          データはこの端末の中にしかありません。<Link to="/settings/backup">設定 → バックアップ</Link>から書き出してください。
        </div>
      )}

      {money.length === 0 && (
        <div className="notice">
          銀行口座・交通系IC・QR決済がまだ登録されていません。<Link to="/settings/accounts">設定 → 口座・カード</Link>
          から登録すると残高を管理できます。
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h2>未確定の予定</h2>
          <div className="card flush">
            {pending.map((item) => (
              <div className="row" key={item.key}>
                <div className="main">
                  <div className="title">{item.name}</div>
                  <div className="sub num">
                    {formatDate(item.date)}・{item.template.amount ? yen(item.template.amount) : '金額未設定'}
                  </div>
                  <div className="actions" style={{ marginTop: 6 }}>
                    {isComplete(item.template) && (
                      <button className="btn small primary" disabled={busy} onClick={() => void run(() => confirm(item))}>
                        確定
                      </button>
                    )}
                    <button className="btn small" onClick={() => edit(item)}>
                      {isComplete(item.template) ? '修正して確定' : '入力して確定'}
                    </button>
                    <button className="btn small" disabled={busy} onClick={() => void run(() => skip(item))}>
                      スキップ
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {data.quickButtons.length > 0 && (
        <>
          <h2>クイック入力</h2>
          <div className="quick">
            {data.quickButtons.map((q) => (
              <button
                key={q.id}
                className="btn"
                onClick={() => navigate('/entry', { state: { initial: q.template, title: q.label } satisfies EntryState })}
              >
                {q.label}
              </button>
            ))}
          </div>
        </>
      )}

      {money.length > 0 && (
        <>
          <h2>残高</h2>
          <div className="card flush">
            {money.map((a) => (
              <div className="row" key={a.id}>
                <div className="main title">{a.name}</div>
                <div className="num">{yen(accountBalance(a, data.transactions))}</div>
              </div>
            ))}
            <div className="row">
              <div className="main sub">合計</div>
              <div className="num">{yen(money.reduce((sum, a) => sum + accountBalance(a, data.transactions), 0))}</div>
            </div>
          </div>
        </>
      )}

      {cards.length > 0 && (
        <>
          <h2>クレジットカード</h2>
          <div className="card flush">
            {cards.map((card) => {
              const next = nextCardPayment(card, data.transactions, todayDate);
              return (
                <div className="row" key={card.id}>
                  <div className="main">
                    <div className="title">{card.name}</div>
                    <div className="sub num">
                      {!card.closingDay || !card.paymentDay
                        ? '締め日・引落日が未設定'
                        : next
                          ? `次回引落 ${formatDate(next.paymentDate)} ${yen(next.amount)}`
                          : '引落予定なし'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="sub">未払い</div>
                    <div className="num">{yen(cardUnpaid(card, data.transactions))}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {(nisa.length > 0 || unsettled > 0) && (
        <>
          <h2>その他</h2>
          <div className="card flush">
            {nisa.map((a) => (
              <div className="row" key={a.id}>
                <div className="main">
                  <div className="title">{a.name}</div>
                  <div className="sub">積立元本の累計</div>
                </div>
                <div className="num">{yen(accountBalance(a, data.transactions))}</div>
              </div>
            ))}
            {unsettled > 0 && (
              <Link className="row" to="/reports" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="main">
                  <div className="title">精算待ちの立替</div>
                  <div className="sub">出張費など、まだ入金されていない分</div>
                </div>
                <div className="num">{yen(unsettled)}</div>
              </Link>
            )}
          </div>
        </>
      )}

      <div className="actions">
        <Link className="btn small" to="/settings/reconcile" style={{ textDecoration: 'none' }}>
          残高を照合する
        </Link>
      </div>
    </>
  );
}
