import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MonthNav, nameOf, signedYen, useData, yen } from '../components/ui';
import { addMonths, formatDate, monthOf, today } from '../domain/dates';
import { monthSummary, unsettledReimbursables } from '../domain/summary';
import { AnnualIncome } from './AnnualIncome';

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

const SERIES_COLORS = 8;
/** 円グラフに描く最大の区分数。超えた分は「その他」にまとめる(色が増えすぎると見分けられないため) */
const MAX_SLICES = 6;
const pct = (value: number, total: number) => `${(Math.round((value / total) * 1000) / 10).toFixed(1)}%`;

/** 支出の内訳の円グラフ。割合と金額は下の一覧に書く(色だけに頼らない)。 */
function PieBreakdown({ title, totals, names }: { title: string; totals: Map<string, number>; names: { id: string; name: string }[] }) {
  const ranked = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, v]) => sum + v, 0);
  const head = ranked.slice(0, ranked.length > MAX_SLICES ? MAX_SLICES - 1 : MAX_SLICES);
  const tail = ranked.slice(head.length);
  const label = (id: string) => nameOf(names, id || undefined, '未設定');

  // 色は金額の順位ではなく項目に付ける(月を変えても同じ項目は同じ色)。番号が重なったら次の空きを使う
  const indexOf = (id: string) => {
    const i = names.findIndex((n) => n.id === id);
    return i < 0 ? names.length : i;
  };
  const used = new Set<number>();
  const colorOf = new Map<string, string>();
  for (const [id] of [...head].sort((a, b) => indexOf(a[0]) - indexOf(b[0]))) {
    let slot = indexOf(id) % SERIES_COLORS;
    while (used.has(slot)) slot = (slot + 1) % SERIES_COLORS;
    used.add(slot);
    colorOf.set(id, `var(--series-${slot + 1})`);
  }
  const slices = head.map(([id, value]) => ({ id, name: label(id), value, color: colorOf.get(id)! }));
  if (tail.length > 0) {
    slices.push({ id: '__other', name: `その他(${tail.length}項目)`, value: tail.reduce((sum, [, v]) => sum + v, 0), color: 'var(--series-other)' });
  }

  return (
    <>
      <h2>{title}</h2>
      <div className="card">
        {slices.length === 0 ? (
          <span className="muted">記録がありません。</span>
        ) : (
          <>
            <div className="pie">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="58%"
                    outerRadius="100%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {slices.map((s) => (
                      <Cell key={s.id} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => `${yen(Number(v))} (${pct(Number(v), total)})`}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
                    itemStyle={{ color: 'var(--text)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pie-total">
                <div className="sub">合計</div>
                <div className="num">{yen(total)}</div>
              </div>
            </div>
            <table className="plain num legend">
              <thead>
                <tr>
                  <th>項目</th>
                  <th>割合</th>
                  <th>金額</th>
                </tr>
              </thead>
              <tbody>
                {slices.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="swatch" style={{ background: s.color }} />
                      {s.name}
                    </td>
                    <td>{pct(s.value, total)}</td>
                    <td>{yen(s.value)}</td>
                  </tr>
                ))}
                {tail.map(([id, value]) => (
                  <tr key={id} className="sub">
                    <td className="indent">{label(id)}</td>
                    <td>{pct(value, total)}</td>
                    <td>{yen(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}

export function Reports() {
  const data = useData();
  const navigate = useNavigate();
  const [month, setMonth] = useState(monthOf(today()));
  const [view, setView] = useState<'month' | 'year'>('month');
  const summary = monthSummary(data.transactions, data.incomeSources, month);
  const trend = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)).map((m) => {
    const s = monthSummary(data.transactions, data.incomeSources, m);
    return { month: `${Number(m.slice(5))}月`, 収入: s.income, 支出: s.expense };
  });
  const unsettled = unsettledReimbursables(data.transactions).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <h1>集計</h1>
      <div className="segmented" role="group" aria-label="集計の種類">
        <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>
          月の収支
        </button>
        <button type="button" aria-pressed={view === 'year'} onClick={() => setView('year')}>
          年間の所得
        </button>
      </div>
      {view === 'year' ? (
        <AnnualIncome />
      ) : (
        <>
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
            <div className={`value ${summary.net < 0 ? 'expense' : ''}`}>{signedYen(summary.net)}</div>
          </div>
        </div>
        <p className="sub" style={{ margin: '8px 0 0' }}>
          振替(カード引落・チャージ・NISA積立)と立替分は含みません。
        </p>
      </div>

      <PieBreakdown title="カテゴリ別の支出" totals={summary.byCategory} names={data.categories} />
      <PieBreakdown title="目的タグ別の支出" totals={summary.byTag} names={data.tags} />
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
      )}
    </>
  );
}
