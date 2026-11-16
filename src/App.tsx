import { Suspense, lazy } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { DataContext, Toaster } from './components/ui';
import { useAppData } from './db/schema';
import { Entry } from './pages/Entry';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';

// グラフのライブラリが大きいので、集計画面は開いたときに読み込む
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));

export function App() {
  const data = useAppData();
  if (!data) return <div className="app muted">読み込み中…</div>;
  return (
    <DataContext.Provider value={data}>
      <main className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/history" element={<History />} />
          <Route path="/entry" element={<Entry />} />
          <Route path="/entry/:id" element={<Entry />} />
          <Route
            path="/reports"
            element={
              <Suspense fallback={<p className="muted">読み込み中…</p>}>
                <Reports />
              </Suspense>
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:section" element={<Settings />} />
        </Routes>
      </main>
      <Toaster />
      <div className="tabbar">
        <nav aria-label="メニュー">
          <NavLink to="/" end>
            ホーム
          </NavLink>
          <NavLink to="/history">履歴</NavLink>
          <NavLink to="/entry" className="add" aria-label="記録を入力">
            <span>＋</span>
          </NavLink>
          <NavLink to="/reports">集計</NavLink>
          <NavLink to="/settings">設定</NavLink>
        </nav>
      </div>
    </DataContext.Provider>
  );
}
