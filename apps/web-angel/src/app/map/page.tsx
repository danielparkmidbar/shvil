import type { Metadata } from 'next';
import { t } from '@/i18n';
import AngelMap from './AngelMap';

export const metadata: Metadata = {
  title: `${t.map.title} — ${t.common.siteName}`,
};

export default function MapPage() {
  return (
    <>
      <h1>{t.map.title}</h1>
      <p className="muted">{t.map.intro}</p>
      <AngelMap />
    </>
  );
}
