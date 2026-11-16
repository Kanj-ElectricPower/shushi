import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MonthNav, nameOf, signedYen, useData, yen } from '../components/ui';
import { addMonths, formatDate, monthOf, today } from '../domain/dates';
import { annualIncome, monthSummary, unsettledReimbursables } from '../domain/summary';
import { INCOME_TYPE_LABEL, type IncomeType } from '../domain/types';

function Breakdown({ title, totals, names }: { title: string; totals: Map<string, number>; names: { id: string; name: string }[] }) {
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  const total = rows.reduce((sum, [, v]) => sum + v, 0);
  return (
    <>
      <h2>{title}</h2>
      <div className="card">
        {rows.length === 0 && <span className="muted">記録がありません。</span>}
        {rows.map(([id, value]) => (
          <div key={id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{nameOf(names, id || undefined, '未設定')}</span>
              <span className="num">
                {yen(value)} <span className="sub">{Math.round((value / total) * 100)}%</span>
              </span>
            </div>
            <div className="bar">
              <div style={{ width: `${(value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const TAX_TYPES: IncomeType[] = ['salary', 'misc', 'family', 'other'];

export function Reports() {
  const data = useData();
  const navigate = useNavigate();
  const [month, setMonth] = useState(monthOf(today()));
  const year = Number(month.slice(0, 4));
  const summary = monthSummary(data.transactions, data.incomeSources, month);
  const trend = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)).map((m) => {
    const s = monthSummary(data.transactions, data.incomeSources, m);
    return { month: `${Number(m.slice(5))}月`, 収入: s.income, 支出: s.expense };
  });
  const annual = annualIncome(data.transactions, data.incomeSources, year);
  const unsettled = unsettledReimbursables(data.transactions).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <h1>集計</h1>
      <MonthNav month={month} onChange={setMonth} />
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
            <div className="value">{signedYen(summary.net)}</div>
          </div>
        </div>
        <p className="sub" style={{ margin: '8px 0 0' }}>
          振替(カード引落・チャージ・NISA積立)と立替分は含みません。
        </p>
      </div>

      <Breakdown title="カテゴリ別の支出" totals={summary.byCategory} names={data.categories} />
      <Breakdown title="目的タグ別の支出" totals={summary.byTag} names={data.tags} />
      <Breakdown title="収入源別の収入" totals={summary.bySource} names={data.incomeSources} />

      <h2>月別の推移(直近12か月)</h2>
      <div className="card" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trend} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={0} />
            <YAxis
              width={44}
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              tickFormatter={(v: number) => (v >= 10000 ? `${v / 10000}万` : String(v))}
            />
            <Tooltip
              formatter={(v) => yen(Number(v))}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
              cursor={{ fill: 'var(--line)', opacity: 0.4 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="収入" fill="var(--income)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="支出" fill="var(--expense)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h2>{year}年の所得(入金日ベース)</h2>
      <div className="card scroll-x">
        {annual.rows.length === 0 ? (
          <span className="muted">記録がありません。</span>
        ) : (
          <table className="plain num">
            <thead>
              <tr>
                <th>収入源</th>
                <th>額面</th>
                <th>源泉徴収</th>
                <th>手取り</th>
              </tr>
            </thead>
            <tbody>
              {annual.rows.map((r) => (
                <tr key={r.sourceId}>
                  <td>{nameOf(data.incomeSources, r.sourceId || undefined)}</td>
                  <td>{yen(r.gross)}</td>
                  <td>{yen(r.withholding)}</td>
                  <td>{yen(r.net)}</td>
                </tr>
              ))}
              {TAX_TYPES.filter((t) => annual.byType.has(t)).map((t) => {
                const v = annual.byType.get(t)!;
                return (
                  <tr key={t} style={{ fontWeight: 600 }}>
                    <td>{INCOME_TYPE_LABEL[t]} 計</td>
                    <td>{yen(v.gross)}</td>
                    <td>{yen(v.withholding)}</td>
                    <td>{yen(v.net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="sub" style={{ margin: '8px 0 0' }}>
          額面が未入力の記録は手取り額を額面として集計しています。
        </p>
      </div>

      <h2>精算待ちの立替</h2>
      <div className="card flush">
        {unsettled.length === 0 && (
          <div className="row">
            <span className="muted">精算待ちの立替はありません。</span>
          </div>
        )}
        {unsettled.map((tx) => (
          <button className="row" key={tx.id} onClick={() => navigate(`/entry/${tx.id}`)}>
            <div className="main">
              <div className="title">{nameOf(data.categories, tx.categoryId)}</div>
              <div className="sub title">{[formatDate(tx.date), tx.memo].filter(Boolean).join('・')}</div>
            </div>
            <div className="num">{yen(tx.amount)}</div>
          </button>
        ))}
        {unsettled.length > 0 && (
          <div className="row">
            <div className="main sub">合計</div>
            <div className="num">{yen(unsettled.reduce((sum, t) => sum + t.amount, 0))}</div>
          </div>
        )}
      </div>
      <p className="sub">入金されたら、収入源「立替精算」で収入を記録し、精算された立替を選んでください。</p>
    </>
  );
}
