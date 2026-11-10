import { Link, useParams } from 'react-router-dom';
import { getApp, mySavedCatalogIds } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Breadcrumbs, ErrorBox, Loading, NotAvailable } from '../components/ui';
import AppCard from '../components/AppCard';

export default function AppDetailPage() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await getApp(id);
    if (!r) return null;
    return { ...r, saved: await mySavedCatalogIds() };
  }, [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <NotAvailable />;
  const catById = new Map(data.categories.map((c) => [c.id, c]));
  return (
    <section>
      <Breadcrumbs items={[{ to: '/', label: 'ホーム' }, { label: data.app.title }]} />
      <AppCard app={data.app} saved={data.saved.has(data.app.id)} onSaved={reload} />
      {data.app.owner_name && <p className="meta">管理責任者：{data.app.owner_name}</p>}
      <h2 className="section-title">この目的で使えます</h2>
      <ul className="tag-list">
        {data.purposes.map((p) => {
          const c = catById.get(p.category_id);
          return c ? (
            <li key={p.id}><Link to={`/c/${c.code}/p/${p.id}`}>{c.title} › {p.title}</Link></li>
          ) : null;
        })}
      </ul>
    </section>
  );
}
