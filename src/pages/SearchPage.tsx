import { Link, useSearchParams } from 'react-router-dom';
import { search } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Empty, ErrorBox, Loading } from '../components/ui';

const LABEL = { category: '分類', purpose: 'やりたいこと', app: 'アプリ' } as const;

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').slice(0, 100);
  // 検索は DB の RLS 範囲内のみ (T08)。結果はメモリのみに保持
  const { data, error, loading, reload } = useAsync(() => (q.trim() ? search(q) : Promise.resolve([])), [q]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const rows = data ?? [];
  return (
    <section>
      <h1 className="page-title">「{q}」の検索結果</h1>
      {rows.length === 0 ? (
        <Empty>見つかりませんでした。別の言葉で探すか、ホームから分類を選んでください。</Empty>
      ) : (
        <ul className="result-list">
          {rows.map((r) => {
            const to = r.result_type === 'category' ? `/c/${r.category_code}`
              : r.result_type === 'purpose' ? `/c/${r.category_code}/p/${r.id}` : `/apps/${r.id}`;
            return (
              <li key={`${r.result_type}:${r.id}`}>
                <Link to={to} className="result-item">
                  <span className="badge">{LABEL[r.result_type]}</span>
                  <span className="result-title">{r.title}</span>
                  <span className="result-sub">{r.category_title}{r.snippet ? ` — ${r.snippet}` : ''}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
