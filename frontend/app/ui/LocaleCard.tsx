'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiJson, errorRu } from './api';
import { useLocaleSettings, type LocaleSettings } from './format';
import { createFormat, type RegionPrefs } from '../../../shared/format.js';
import { LANGUAGE_NAMES, type Language } from '../i18n/messages';

type Options = { languages: string[]; regions: string[] };

/** Every IANA zone the browser knows, with the current one kept even if it is not in the list. */
function timeZones(current: string): string[] {
  let list: string[] = [];
  try { list = (Intl as any).supportedValuesOf?.('timeZone') || []; } catch { list = []; }
  return list.includes(current) ? list : [current, ...list];
}

const SAMPLE = new Date(Date.UTC(2026, 10, 2, 14, 5)); // what the example lines below show

/** Settings → language and region: formats of dates, times and the week (docs/I18N.md). Changes apply at once. */
export default function LocaleCard() {
  const t = useTranslations('settings');
  const { settings, apply } = useLocaleSettings();
  const [options, setOptions] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { apiJson<{ options: Options }>('/api/gateway/settings/locale').then((j) => setOptions(j.options)).catch((e) => setErr(errorRu(e))); }, []);

  const prefs = settings?.prefs;
  const regionNames = useMemo(() => {
    const dn = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([settings?.language || 'ru'], { type: 'region' }) : null;
    return (options?.regions || []).map((r) => [r, dn?.of(r) || r] as [string, string]).sort((a, b) => a[1].localeCompare(b[1], settings?.language || 'ru'));
  }, [options, settings?.language]);

  // Examples for each choice, in the formats it would produce with the rest of the settings unchanged.
  const sample = (patch: Partial<RegionPrefs>) => createFormat({ language: settings?.language, prefs: { ...prefs, ...patch }, timeZone: 'UTC' });
  const auto = prefs ? createFormat({ language: settings?.language, prefs: { region: prefs.region }, timeZone: 'UTC' }) : null;

  async function save(change: { language?: string; timeZone?: string; prefs?: Partial<RegionPrefs> }) {
    setBusy(true); setErr(null);
    try {
      const j = await apiJson<LocaleSettings & { token?: string }>('/api/gateway/settings/locale', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
      if (j.token) { try { localStorage.setItem('dtc_token', j.token); } catch { /* private mode */ } }
      apply({ language: j.language, prefs: j.prefs, timeZone: j.timeZone });
    } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }

  const select = (label: string, value: string, items: [string, string][], onChange: (v: string) => void, hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={busy || !prefs} onChange={(e) => onChange(e.target.value)} style={{ height: 36 }}>
        {items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
    </label>
  );

  return (
    <div className="card meds-card">
      <div className="card__title">{t('localeCard.title')}</div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {t('localeCard.intro')}
      </div>
      {prefs && auto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {select(t('localeCard.language'), settings!.language, (options?.languages || [settings!.language]).map((l) => [l, LANGUAGE_NAMES[l as Language] || l]), (v) => save({ language: v }), t('localeCard.languageHint'))}
          {select(t('localeCard.region'), prefs.region, regionNames.length ? regionNames : [[prefs.region, prefs.region]], (v) => save({ prefs: { region: v } }),
            t('localeCard.regionHint', { date: auto.date(SAMPLE), time: auto.time(SAMPLE), number: auto.number(1234.5) }))}
          {select(t('localeCard.dateFormat'), prefs.dateFormat, [
            ['auto', t('localeCard.asRegion', { value: auto.date(SAMPLE) })],
            ['dmy', sample({ dateFormat: 'dmy' }).date(SAMPLE)],
            ['mdy', sample({ dateFormat: 'mdy' }).date(SAMPLE)],
            ['ymd', sample({ dateFormat: 'ymd' }).date(SAMPLE)],
          ], (v) => save({ prefs: { dateFormat: v as RegionPrefs['dateFormat'] } }))}
          {select(t('localeCard.time'), prefs.hourCycle, [
            ['auto', t('localeCard.asRegion', { value: auto.time(SAMPLE) })],
            ['h23', t('localeCard.h23', { time: sample({ hourCycle: 'h23' }).time(SAMPLE) })],
            ['h12', t('localeCard.h12', { time: sample({ hourCycle: 'h12' }).time(SAMPLE) })],
          ], (v) => save({ prefs: { hourCycle: v as RegionPrefs['hourCycle'] } }))}
          {select(t('localeCard.weekStart'), prefs.weekStart, [
            ['auto', t('localeCard.asRegion', { value: auto.weekdays('long')[0][1] })],
            ['mon', t('localeCard.mon')],
            ['sun', t('localeCard.sun')],
          ], (v) => save({ prefs: { weekStart: v as RegionPrefs['weekStart'] } }))}
          {select(t('localeCard.labUnits'), prefs.labUnits, [
            ['auto', t('localeCard.labUnitsAuto', { units: auto.labUnits })],
            ['si', t('localeCard.si')],
            ['conventional', t('localeCard.conventional')],
          ], (v) => save({ prefs: { labUnits: v as RegionPrefs['labUnits'] } }), t('localeCard.labUnitsHint'))}
          {select(t('localeCard.temperature'), prefs.temperature, [
            ['auto', t('localeCard.asRegion', { value: auto.temperature === 'f' ? '°F' : '°C' })], ['c', '°C'], ['f', '°F'],
          ], (v) => save({ prefs: { temperature: v as RegionPrefs['temperature'] } }))}
          {select(t('localeCard.weight'), prefs.weight, [
            ['auto', t('localeCard.weightAuto', { weight: auto.weight })], ['kg', t('localeCard.kg')], ['lb', t('localeCard.lb')],
          ], (v) => save({ prefs: { weight: v as RegionPrefs['weight'] } }))}
          {select(t('localeCard.timeZone'), settings!.timeZone, timeZones(settings!.timeZone).map((z) => [z, z.replace(/_/g, ' ')]), (v) => save({ timeZone: v }),
            t('localeCard.timeZoneHint'))}
        </div>
      )}
      {err && <div className="msg msg--error">{err}</div>}
    </div>
  );
}
