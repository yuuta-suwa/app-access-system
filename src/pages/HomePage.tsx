import { Link } from 'react-router-dom';
import { listCategories } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { ErrorBox, Loading } from '../components/ui';

export default function HomePage() {
  // 表示する分類は DB の RLS が返したものだけ。禁止分類のカード・ロック表示は作らない
  const { data, error, loading, reload } = useAsync(listCategories, []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const cats = data ?? [];
  return (
    <section>
      <h1 className="page-title">使う場面を選んでください</h1>
      <div className="cat-grid">
        {cats.map((c) => (
          <Link key={c.id} to={`/c/${c.code}`} className="cat-card">
            <span className="cat-title">{c.title}</span>
            <span className="cat-desc">{c.description}</span>
          </Link>
        ))}
        <Link to="/self" className="cat-card self">
          <span className="badge">自分専用</span>
          <span className="cat-title">SELF</span>
          <span className="cat-desc">自分のアプリ・資料・リンクを整理する</span>
        </Link>
      </div>
      {cats.length === 0 && (
        <p className="empty">現在、利用できる共通分類は設定されていません。SELF はご利用いただけます。</p>
      )}
    </section>
  );
}
