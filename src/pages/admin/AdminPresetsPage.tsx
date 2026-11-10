import { useState } from 'react';
import { admin, friendlyError, type Preset } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { ErrorBox, Loading } from '../../components/ui';

export default function AdminPresetsPage() {
  const { data, error, loading, reload } = useAsync(async () => ({ presets: await admin.listPresets(), cats: await admin.listCategories() }), []);
  const [edit, setEdit] = useState<{ id: string | null; name: string; cats: number[]; sort: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const title = new Map(data.cats.map((c) => [c.id, c.title]));

  const save = async () => {
    if (!edit) return;
    try {
      await admin.savePreset(edit.id, edit.name, edit.cats, edit.sort);
      setEdit(null);
      setMsg('保存しました（既存利用者の権限は変更されません）。');
      reload();
    } catch (e) {
      setMsg(friendlyError(e));
    }
  };
  const del = async (p: Preset) => {
    if (!window.confirm(`プリセット「${p.name}」を削除しますか？（利用者の権限は変わりません）`)) return;
    try { await admin.deletePreset(p.id); reload(); } catch (e) { setMsg(friendlyError(e)); }
  };

  return (
    <div className="card">
      <h2 className="section-title">権限プリセット</h2>
      <p className="fine">プリセットは設定作業の補助でありロールではありません。編集しても既存利用者の権限は自動変更されません。</p>
      <table className="table">
        <thead><tr><th>名前</th><th>分類</th><th></th></tr></thead>
        <tbody>
          {data.presets.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.category_ids.map((c) => title.get(c)).join('、') || 'SELF のみ'}</td>
              <td className="row">
                <button className="btn small" onClick={() => setEdit({ id: p.id, name: p.name, cats: [...p.category_ids], sort: p.sort_order })}>編集</button>
                <button className="btn small ghost danger" onClick={() => void del(p)}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" onClick={() => setEdit({ id: null, name: '', cats: [], sort: 100 })}>＋ 新しいプリセット</button>
      {edit && (
        <div className="form-grid card">
          <label>名前<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} /></label>
          <div className="chips">
            {data.cats.map((c) => (
              <label key={c.id} className="check"><input type="checkbox" checked={edit.cats.includes(c.id)}
                onChange={(e) => setEdit({ ...edit, cats: e.target.checked ? [...edit.cats, c.id] : edit.cats.filter((x) => x !== c.id) })} />{c.title}</label>
            ))}
          </div>
          <label>並び順<input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} /></label>
          <div className="row">
            <button className="btn primary" disabled={!edit.name.trim()} onClick={() => void save()}>保存</button>
            <button className="btn ghost" onClick={() => setEdit(null)}>取消</button>
          </div>
        </div>
      )}
      {msg && <p className="flash">{msg}</p>}
    </div>
  );
}
