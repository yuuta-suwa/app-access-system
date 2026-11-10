import { Link, useParams } from 'react-router-dom';
import { getCategoryByCode, listPurposes } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Breadcrumbs, Empty, ErrorBox, Loading, NotAvailable } from '../components/ui';

export default function CategoryPage() {
  const { code = '' } = useParams();
  const { data, error, loading, reload } = useAsync(async () => {
    if (!/^[a-z0-9-]{1,40}$/.test(code)) return null;
    const cat = await getCategoryByCode(code);
    if (!cat) return null; // 権限外・存在しないを区別しない (T06)
    return { cat, purposes: await listPurposes(cat.id) };
  }, [code]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <NotAvailable />;
  const { cat, purposes } = data;
  return (
    <section>
      <Breadcrumbs items={[{ to: '/', label: 'ホーム' }, { label: cat.title }]} />
      <h1 className="page-title">{cat.title}</h1>
      <p className="lead">{cat.description}</p>
      <h2 className="section-title">何がしたいですか？</h2>
      {purposes.length === 0 ? (
        <Empty>この分類にはまだ目的が登録されていません。</Empty>
      ) : (
        <ul className="purpose-list">
          {purposes.map((p) => (
            <li key={p.id}>
              <Link to={`/c/${cat.code}/p/${p.id}`} className="purpose-item">
                <span className="purpose-title">{p.title}</span>
                {p.description && <span className="purpose-desc">{p.description}</span>}
                <span className="chev" aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
