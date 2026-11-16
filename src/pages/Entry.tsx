import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { EntryForm } from '../components/EntryForm';
import { useData } from '../components/ui';
import type { Tx } from '../domain/types';

export interface EntryState {
  initial?: Partial<Tx>;
  title?: string;
}

export function Entry() {
  const data = useData();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as EntryState;
  const editing = id ? data.transactions.find((t) => t.id === id) : undefined;
  // 直接このページを開いた場合は戻る先がないのでホームへ
  const done = () => (location.key === 'default' ? navigate('/') : navigate(-1));

  if (id && !editing) {
    return <p className="muted">この記録は見つかりませんでした。</p>;
  }
  return (
    <>
      <h1>{editing ? '記録の編集' : (state.title ?? '記録の入力')}</h1>
      {/* key を変えて、別の記録や初期値に切り替えたときに入力欄を作り直す */}
      <EntryForm key={id ?? location.key} editing={editing} initial={state.initial} onDone={done} />
    </>
  );
}
