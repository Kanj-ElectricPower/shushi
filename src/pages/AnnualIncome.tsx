import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nameOf, useData, yen } from '../components/ui';
import { today } from '../domain/dates';
import { taxableYear } from '../domain/summary';
import { WALL_BASIS_LABEL } from '../domain/types';

/** 1〜12月に入金された課税対象の収入(給与・雑所得)と、年収の壁までの残り。 */
export function AnnualIncome() {
  const data = useData();
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const y = taxableYear(data.transactions, data.incomeSources, year);
  let cumulative = 0;

  return (
    <>
      <div className="monthnav">
        <button className="btn small" onClick={() => setYear(year - 1)} aria-label="前の年">
          ‹ 前年
        </button>
        <strong>{year}年(1〜12月に入金)</strong>
        <button className="btn small" onClick={() => setYear(year + 1)} aria-label="次の年">
          翌年 ›
        </button>
      </div>

      <div className="card">
        <div className="summary">
          <div>
            <div className="label">給与(額面)</div>
            <div className="value">{yen(y.salary)}</div>
          </div>
          <div>
            <div className="label">雑所得(収入)</div>
            <div className="value">{yen(y.misc)}</div>
          </div>
          <div>
            <div className="label">合計</div>
            <div className="value">{yen(y.taxable)}</div>
          </div>
        </div>
        <p className="sub num" style={{ margin: '8px 0 0' }}>
          源泉徴収額の合計 {yen(y.withholding)}
        </p>
      </div>
      {y.missingGross > 0 && (
        <div className="notice">
          源泉徴収ありの収入のうち {y.missingGross} 件は額面が未入力のため、手取り額で数えています(実際より少なく出ます)。履歴から開いて額面を入れてください。
        </div>
      )}

      <h2>年収の壁</h2>
      {data.incomeWalls.length === 0 ? (
        <div className="card">
          <span className="muted">
            壁の金額が登録されていません。<Link to="/settings/walls">設定 → 年収の壁</Link>から登録すると、残りの金額を表示します。
          </span>
        </div>
      ) : (
        <div className="card">
          {data.incomeWalls.map((w) => {
            const value = w.basis === 'salary' ? y.salary : y.taxable;
            const over = value > w.amount;
            const pct = w.amount > 0 ? Math.min(100, (value / w.amount) * 100) : 100;
            return (
              <div key={w.id} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {w.name} <span className="sub">{yen(w.amount)}</span>
                  </span>
                  <span className={`num ${over ? 'expense' : ''}`}>{over ? `${yen(value - w.amount)} 超過` : `あと ${yen(w.amount - value)}`}</span>
                </div>
                <div className="bar">
                  <div style={{ width: `${pct}%`, background: over ? 'var(--expense)' : undefined }} />
                </div>
                <div className="sub">{WALL_BASIS_LABEL[w.basis]}と比較</div>
              </div>
            );
          })}
        </div>
      )}

      <h2>月別</h2>
      <div className="card scroll-x">
        <table className="plain num">
          <thead>
            <tr>
              <th>月</th>
              <th>給与</th>
              <th>雑所得</th>
              <th>累計</th>
            </tr>
          </thead>
          <tbody>
            {y.months.map((m) => {
              cumulative += m.salary + m.misc;
              return (
                <tr key={m.month}>
                  <td>{m.month}月</td>
                  <td>{m.salary ? yen(m.salary) : '-'}</td>
                  <td>{m.misc ? yen(m.misc) : '-'}</td>
                  <td>{yen(cumulative)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>収入源別</h2>
      <div className="card scroll-x">
        {y.rows.length === 0 ? (
          <span className="muted">この年の給与・雑所得の記録はありません。</span>
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
              {y.rows.map((r) => (
                <tr key={r.sourceId}>
                  <td>{nameOf(data.incomeSources, r.sourceId)}</td>
                  <td>{yen(r.gross)}</td>
                  <td>{yen(r.withholding)}</td>
                  <td>{yen(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="sub">
        収入源の区分が「給与」「雑所得」のものだけを、入金日で集計しています(親からの支給・還付金・立替精算は含みません)。給与の額面には、非課税の通勤手当を含めないでください。雑所得は経費を引く前の収入額です。社会保険の扶養のように、年間の見込み額で判定する壁もあるので、目安として使ってください。
      </p>
    </>
  );
}
