import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createFolder, createLink, deleteFolder, deleteItem, friendlyError, getAppsByIds, listFolders, listItems,
  renameFolder, updateItem, type CatalogApp, type Folder, type PersonalItem,
} from '../lib/api';
import { checkUrl, openExternal } from '../lib/url';
import { useAsync } from '../lib/useAsync';
import { Empty, ErrorBox, Loading } from '../components/ui';

interface SelfData { folders: Folder[]; items: PersonalItem[]; apps: Map<string, CatalogApp> }

async function loadSelf(): Promise<SelfData> {
  const [folders, items] = await Promise.all([listFolders(), listItems()]);
  const ids = items.filter((i) => i.kind === 'catalog' && i.catalog_app_id).map((i) => i.catalog_app_id!) ;
  // 共通アプリの内容は RLS を通して毎回取得。権限外になったものは返らない (SELF-07 / T16)
  const apps = await getAppsByIds(ids);
  return { folders, items, apps: new Map(apps.map((a) => [a.id, a])) };
}

export default function SelfPage() {
  const { data, error, loading, reload } = useAsync(loadSelf, []);
  const [filter, setFilter] = useState<string>('all');
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      reload();
    } catch (e) {
      setMsg(friendlyError(e));
    }
  };

  const visible = useMemo(() => {
    if (!data) return [];
    return data.items.filter((i) => filter === 'all' || (filter === 'none' ? !i.folder_id : i.folder_id === filter));
  }, [data, filter]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const move = (item: PersonalItem, dir: -1 | 1) => {
    const list = visible;
    const idx = list.findIndex((x) => x.id === item.id);
    const other = list[idx + dir];
    if (!other) return;
    void run(async () => {
      const a = item.sort_order, b = other.sort_order;
      const [na, nb] = a === b ? [idx + dir, idx] : [b, a];
      await updateItem(item.id, { sort_order: na });
      await updateItem(other.id, { sort_order: nb });
    });
  };

  return (
    <section>
      <div className="title-row">
        <h1 className="page-title">SELF <span className="badge">自分専用</span></h1>
        <button className="btn ghost" onClick={reload}>最新に更新</button>
      </div>
      <p className="lead">あなただけが見られる保管庫です。同じ Google アカウントならスマホ・PC で同じ内容が表示されます。</p>
      <p className="fine">※ パスワード・API キー・ログイン用の秘密 URL は登録しないでください。外部サイトの利用権限までは保証しません。</p>

      <AddLinkForm folders={data.folders} nextOrder={data.items.length} onDone={(m) => { setMsg(m); reload(); }} />

      {msg && <p className="flash" role="status">{msg}</p>}

      <FolderBar
        folders={data.folders}
        filter={filter}
        setFilter={setFilter}
        onCreate={(name) => run(() => createFolder(name, data.folders.length), 'フォルダを作成しました')}
        onRename={(f, name) => run(() => renameFolder(f.id, name))}
        onDelete={(f) => run(() => deleteFolder(f.id), 'フォルダを削除しました（中の項目は「未分類」に移動）')}
      />

      {visible.length === 0 ? (
        <Empty>まだ項目がありません。「名前＋URL」で追加するか、アプリ一覧の「SELF に保存」を使ってください。</Empty>
      ) : (
        <ul className="self-list">
          {visible.map((it, i) => (
            <SelfRow
              key={it.id}
              item={it}
              app={it.catalog_app_id ? data.apps.get(it.catalog_app_id) : undefined}
              folders={data.folders}
              first={i === 0}
              last={i === visible.length - 1}
              onMove={(d) => move(it, d)}
              onUpdate={(patch) => run(() => updateItem(it.id, patch), '保存しました')}
              onDelete={() => {
                if (window.confirm('この項目を削除しますか？')) void run(() => deleteItem(it.id), '削除しました');
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AddLinkForm({ folders, nextOrder, onDone }: { folders: Folder[]; nextOrder: number; onDone: (m: string) => void }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [folder, setFolder] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = url ? checkUrl(url) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) return setErr('名前を入力してください。');
    const c = checkUrl(url);
    if (!c.ok) return setErr(c.error);
    if (c.warnings.length && !window.confirm(`${c.warnings.join('\n')}\n\nこのまま保存しますか？`)) return;
    setBusy(true);
    try {
      await createLink({ title: title.trim(), url: c.url, note: note.trim(), folder_id: folder || null, sort_order: nextOrder });
      setTitle(''); setUrl(''); setNote('');
      onDone('リンクを追加しました');
    } catch (e2) {
      setErr(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form-grid" onSubmit={submit}>
      <h2 className="section-title">リンクを追加</h2>
      <label>名前<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></label>
      <label>URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" maxLength={2048} required /></label>
      {check && !check.ok && <p className="warn">{check.error}</p>}
      {check && check.ok && check.warnings.map((w) => <p key={w} className="warn">⚠ {w}</p>)}
      <details>
        <summary>任意項目（用途メモ・フォルダ）</summary>
        <label>用途メモ<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} /></label>
        <label>フォルダ
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">未分類</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      </details>
      {err && <p className="error-text" role="alert">{err}</p>}
      <button className="btn primary" disabled={busy}>追加する</button>
    </form>
  );
}

function FolderBar(props: {
  folders: Folder[]; filter: string; setFilter: (v: string) => void;
  onCreate: (name: string) => void; onRename: (f: Folder, name: string) => void; onDelete: (f: Folder) => void;
}) {
  const { folders, filter, setFilter } = props;
  const current = folders.find((f) => f.id === filter);
  return (
    <div className="folder-bar">
      <div className="chips" role="tablist">
        <button className={filter === 'all' ? 'chip on' : 'chip'} onClick={() => setFilter('all')}>すべて</button>
        <button className={filter === 'none' ? 'chip on' : 'chip'} onClick={() => setFilter('none')}>未分類</button>
        {folders.map((f) => (
          <button key={f.id} className={filter === f.id ? 'chip on' : 'chip'} onClick={() => setFilter(f.id)}>{f.name}</button>
        ))}
        <button className="chip add" onClick={() => {
          const n = window.prompt('新しいフォルダ名');
          if (n && n.trim()) props.onCreate(n.trim().slice(0, 60));
        }}>＋ フォルダ</button>
      </div>
      {current && (
        <div className="row">
          <button className="linklike" onClick={() => {
            const n = window.prompt('フォルダ名を変更', current.name);
            if (n && n.trim()) props.onRename(current, n.trim().slice(0, 60));
          }}>名前変更</button>
          <button className="linklike danger" onClick={() => {
            if (window.confirm(`フォルダ「${current.name}」を削除しますか？`)) { props.onDelete(current); setFilter('all'); }
          }}>フォルダ削除</button>
        </div>
      )}
    </div>
  );
}

function SelfRow(props: {
  item: PersonalItem; app?: CatalogApp; folders: Folder[]; first: boolean; last: boolean;
  onMove: (d: -1 | 1) => void; onUpdate: (patch: Partial<PersonalItem>) => void; onDelete: () => void;
}) {
  const { item, app, folders } = props;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.custom_title ?? '');
  const [url, setUrl] = useState(item.external_url ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [err, setErr] = useState<string | null>(null);

  // 共通アプリ参照で、RLS により内容が返らなかったもの → 汎用表示＋削除のみ
  if (item.kind === 'catalog' && !app) {
    return (
      <li className="self-item unavailable">
        <div className="self-main">
          <span className="self-title">アクセスできない項目</span>
          <span className="meta">この共通アプリは現在利用できません。削除のみ可能です。</span>
        </div>
        <div className="row"><button className="btn ghost danger" onClick={props.onDelete}>削除</button></div>
      </li>
    );
  }

  const titleText = item.kind === 'catalog' ? app!.title : item.custom_title!;
  const launch = item.kind === 'catalog' ? app!.launch_url : item.external_url!;

  const save = () => {
    setErr(null);
    if (item.kind === 'link') {
      if (!title.trim()) return setErr('名前を入力してください。');
      const c = checkUrl(url);
      if (!c.ok) return setErr(c.error);
      if (c.warnings.length && !window.confirm(`${c.warnings.join('\n')}\n\nこのまま保存しますか？`)) return;
      props.onUpdate({ custom_title: title.trim(), external_url: c.url, note: note.trim() || null });
    } else {
      props.onUpdate({ note: note.trim() || null });
    }
    setEditing(false);
  };

  return (
    <li className="self-item">
      <div className="self-main">
        <span className="self-title">
          {item.kind === 'catalog' && <span className="badge soft">共通アプリ</span>}
          {item.kind === 'catalog' ? <Link to={`/apps/${app!.id}`}>{titleText}</Link> : titleText}
        </span>
        {item.note && !editing && <span className="meta">{item.note}</span>}
        {item.kind === 'catalog' && !editing && <span className="meta">{app!.description}</span>}
      </div>
      {editing ? (
        <div className="form-grid">
          {item.kind === 'link' && (
            <>
              <label>名前<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
              <label>URL<input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2048} /></label>
            </>
          )}
          <label>用途メモ<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} /></label>
          {err && <p className="error-text">{err}</p>}
          <div className="row">
            <button className="btn primary" onClick={save}>保存</button>
            <button className="btn ghost" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <button className="btn primary" onClick={() => openExternal(launch)}>開く ↗</button>
          <select aria-label="フォルダ" value={item.folder_id ?? ''} onChange={(e) => props.onUpdate({ folder_id: e.target.value || null })}>
            <option value="">未分類</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button className="btn ghost icon" disabled={props.first} onClick={() => props.onMove(-1)} aria-label="上へ">↑</button>
          <button className="btn ghost icon" disabled={props.last} onClick={() => props.onMove(1)} aria-label="下へ">↓</button>
          <button className="btn ghost" onClick={() => setEditing(true)}>編集</button>
          <button className="btn ghost danger" onClick={props.onDelete}>削除</button>
        </div>
      )}
    </li>
  );
}
