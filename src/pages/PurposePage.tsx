import { useParams } from 'react-router-dom';
import { getCategoryByCode, getPurpose, listAppsForPurpose, mySavedCatalogIds } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Breadcrumbs, Empty, ErrorBox, Loading, NotAvailable } from '../components/ui';
import AppCard from '../components/AppCard';

export default function PurposePage() {
  const { code = '', purposeId = '' } = useParams();
  const { data, error, loading, reload } = useAsync(async () => {
    const [cat, purpose] = await Promise.all([getCategoryByCode(code), getPurpose(purposeId)]);
    if (!cat || !purpose || purpose.category_id !== cat.id) return null;
    const [apps, saved] = await Promise.all([listAppsForPurpose(purpose.id), mySavedCatalogIds()]);
    return { cat, purpose, apps, saved };
  }, [code, purposeId]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <NotAvailable />;
  const { cat, purpose, apps, saved } = data;
  return (
    <section>
      <Breadcrumbs items={[{ to: '/', label: 'ホーム' }, { to: `/c/${cat.code}`, label: cat.title }, { label: purpose.title }]} />
      <h1 className="page-title">{purpose.title}</h1>
      {purpose.description && <p className="lead">{purpose.description}</p>}
      {apps.length === 0 ? (
        <Empty>この目的に使えるアプリはまだ登録されていません。</Empty>
      ) : (
        <div className="app-grid">
          {apps.map((a) => (
            <AppCard key={a.id} app={a} saved={saved.has(a.id)} onSaved={reload} />
          ))}
        </div>
      )}
    </section>
  );
}
