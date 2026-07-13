'use client';

import { useI18n } from '@/i18n';
import AngelMap from './AngelMap';

export default function MapPage() {
  const { t } = useI18n();
  return (
    <>
      <h1>{t.map.title}</h1>
      <p className="muted">{t.map.intro}</p>
      <AngelMap />
    </>
  );
}
