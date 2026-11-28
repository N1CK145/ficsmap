import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { DATE_FORMATS, nearestWheelSpeedStop, THEMES, WHEEL_SPEED, WHEEL_SPEED_STOPS } from '../../../shared/prefs.js';
import { dateTimeFormat, useDateFormatPref } from '../../app/dates.js';
import { savePrefs, useSetPrefs, usePrefsSaveStatus, usePrefsStore, useWheelSpeed } from '../../app/prefs.js';
import { useThemePref } from '../../app/theme.js';
import { Button } from '../../components/Button.js';
import { FIELD_LABEL } from '../../components/Field.js';
import { Footer } from '../../components/Footer.js';
import { Header } from '../../components/Header.js';
import { BackIcon, CheckIcon } from '../../components/icons.js';
import { LanguageSwitch } from '../../components/LanguageSwitch.js';
import { SectionMarker } from '../../components/SectionHeading.js';
import { Window } from '../../components/Window.js';
import { AccountMenu } from './AccountMenu.js';
import { GeneralInvite } from './GeneralInvite.js';
import { SignInMethods } from './SignInMethods.js';
import { useMe } from './queries.js';

/**
 * `/profile`: the signed-in user's own settings, outside any world (reached from the account menu). The mouse wheel
 * speed, the date format and the theme are stored on the account (app/prefs.ts); the language stays a setting of this device.
 * The account's sign-ins (Discord, Steam) are linked and removed here; server owners also get a general invite link.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from the account menu: back to where the user came from; opened directly: to the world list.
  const back = () => (location.key === 'default' ? navigate('/?list=1') : navigate(-1));
  // The save state shows under the setting changed last (one status for all would be announced twice).
  const [changed, setChanged] = useState<'wheel' | 'date' | 'theme'>('wheel');

  return (
    <div className="flex min-h-dvh flex-col">
      <Header end={<AccountMenu />} />
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <h1 className="flex min-w-0 items-center gap-2.5 font-display text-3xl font-bold tracking-wider uppercase max-sm:text-2xl">
            <SectionMarker size="lg" />{t('profile.title')}
          </h1>
          <Button variant="ghost" size="sm" onClick={() => void back()}><BackIcon />{t('profile.back')}</Button>
        </div>
        {me.isPending && <p className="text-muted">{t('common.loading')}</p>}
        {me.isError && (
          <div role="alert" className="flex items-center gap-3">
            <span>{t('profile.loadFailed')}</span>
            <Button size="sm" onClick={() => void me.refetch()}>{t('common.retry')}</Button>
          </div>
        )}
        {me.data && (
          <>
            <Window title={t('profile.controls')} bodyClassName="p-4">
              <WheelSpeedSetting onChange={() => setChanged('wheel')} status={changed === 'wheel'} />
            </Window>
            <Window title={t('language.label')} bodyClassName="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">{t('profile.languageHint')}</p>
              <LanguageSwitch />
            </Window>
            <Window title={t('profile.theme.title')} bodyClassName="p-4">
              <ThemeSetting onChange={() => setChanged('theme')} status={changed === 'theme'} />
            </Window>
            <Window title={t('profile.dateFormat.title')} bodyClassName="p-4">
              <DateFormatSetting onChange={() => setChanged('date')} status={changed === 'date'} />
            </Window>
            <Window title={t('profile.signIn.title')} bodyClassName="p-4">
              <SignInMethods me={me.data} />
            </Window>
            {me.data.serverOwner && (
              <Window title={t('profile.invite.title')} bodyClassName="p-4">
                <GeneralInvite />
              </Window>
            )}
          </>
        )}
      </main>
      <Footer className="mt-auto" />
    </div>
  );
}

interface SettingProps {
  /** Called on every change (the page shows the save state under the setting changed last). */
  onChange(): void;
  /** This setting shows the save state. */
  status: boolean;
}

/** The wheel speed as a slider with its value, [Default] and the save state. Changes apply at once. */
function WheelSpeedSetting({ onChange, status }: SettingProps) {
  const { t } = useTranslation();
  const speed = useWheelSpeed();
  const savePref = useSetPrefs();
  const setPrefs: typeof savePref = patch => { onChange(); savePref(patch); };
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const value = t('profile.wheelSpeedValue', { speed });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className={FIELD_LABEL}>{t('profile.wheelSpeed')}</label>
        {/* Screen readers hear the value from the slider's aria-valuetext. */}
        <span aria-hidden="true" className="font-display text-xl font-semibold text-accent tabular-nums">{value}</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          id={inputId}
          type="range"
          // The stops, not the speed: 1× sits in the middle, and the slow end gets as much room as the fast one.
          min={0}
          max={WHEEL_SPEED_STOPS.length - 1}
          step={1}
          value={nearestWheelSpeedStop(speed)}
          aria-describedby={hintId}
          aria-valuetext={value}
          onChange={e => setPrefs({ wheelSpeed: WHEEL_SPEED_STOPS[Number(e.target.value)] ?? WHEEL_SPEED.default })}
          className="h-10 min-w-0 flex-1 accent-accent focus-ring"
        />
        <Button
          size="sm"
          disabled={speed === WHEEL_SPEED.default}
          aria-label={t('profile.wheelSpeedResetLabel', { speed: WHEEL_SPEED.default })}
          onClick={() => setPrefs({ wheelSpeed: WHEEL_SPEED.default })}
        >
          {t('profile.wheelSpeedReset')}
        </Button>
      </div>
      <p id={hintId} className="text-xs text-muted max-[899px]:text-sm">{t('profile.wheelSpeedHint')}</p>
      <SaveStatus active={status} />
    </div>
  );
}

/** A moment every format shows clearly (day 31 cannot be a month, 23:59 shows the 24-hour clock). */
const DATE_EXAMPLE = new Date(2026, 11, 31, 23, 59).getTime();

/**
 * The date format: a radio group (like the language, European, American), each with how a save's date looks in it.
 * Changes apply at once everywhere and are saved to the account.
 */
function DateFormatSetting({ onChange, status }: SettingProps) {
  const { t, i18n } = useTranslation();
  const value = useDateFormatPref();
  const setPrefs = useSetPrefs();
  const hintId = useId();
  const example = (f: (typeof DATE_FORMATS)[number]) =>
    dateTimeFormat(i18n.language, f, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(DATE_EXAMPLE);
  return (
    <div className="flex flex-col gap-1.5">
      <fieldset aria-describedby={hintId} className="flex flex-col gap-1">
        <legend className={`${FIELD_LABEL} mb-1`}>{t('profile.dateFormat.label')}</legend>
        {DATE_FORMATS.map(f => (
          <label key={f} className="flex min-h-10 cursor-pointer items-center gap-3 chamfer px-2 hover:bg-raised max-[899px]:min-h-11">
            <input
              type="radio"
              name="date-format"
              value={f}
              checked={value === f}
              onChange={() => { onChange(); setPrefs({ dateFormat: f }); }}
              className="size-4 accent-accent"
            />
            <span className="min-w-0 flex-1">{t(`profile.dateFormat.${f}`)}</span>{' '}
            <span className="text-sm text-muted tabular-nums">{example(f)}</span>
          </label>
        ))}
      </fieldset>
      <p id={hintId} className="text-xs text-muted max-[899px]:text-sm">{t('profile.dateFormat.hint')}</p>
      <SaveStatus active={status} />
    </div>
  );
}

/** The theme: a radio group (dark, light, like the system). Applies at once (app/theme.ts) and is saved to the account. */
function ThemeSetting({ onChange, status }: SettingProps) {
  const { t } = useTranslation();
  const value = useThemePref();
  const setPrefs = useSetPrefs();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <fieldset aria-describedby={hintId} className="flex flex-col gap-1">
        <legend className={`${FIELD_LABEL} mb-1`}>{t('profile.theme.label')}</legend>
        {THEMES.map(theme => (
          <label key={theme} className="flex min-h-10 cursor-pointer items-center gap-3 chamfer px-2 hover:bg-raised max-[899px]:min-h-11">
            <input
              type="radio"
              name="theme"
              value={theme}
              checked={value === theme}
              onChange={() => { onChange(); setPrefs({ theme }); }}
              className="size-4 accent-accent"
            />
            <span className="min-w-0 flex-1">{t(`profile.theme.${theme}`)}</span>
          </label>
        ))}
      </fieldset>
      <p id={hintId} className="text-xs text-muted max-[899px]:text-sm">{t('profile.theme.hint')}</p>
      <SaveStatus active={status} />
    </div>
  );
}

/** "Saving…", "Saved", or a failed save with [Retry]; announced politely. Empty (but there) while not `active`. */
function SaveStatus({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const status = usePrefsSaveStatus();
  // A "Saved" from an earlier visit is old news.
  useEffect(() => {
    if (usePrefsStore.getState().status === 'saved') usePrefsStore.setState({ status: 'idle' });
  }, []);

  return (
    <div role="status" className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {active && status === 'pending' && <span className="text-muted">{t('profile.saving')}</span>}
      {active && status === 'saved' && <span className="flex items-center gap-1.5 text-free"><CheckIcon />{t('profile.saved')}</span>}
      {active && status === 'failed' && (
        <>
          <span className="text-conflict">{t('profile.saveFailed')}</span>
          <Button size="sm" variant="ghost" onClick={() => void savePrefs()}>{t('common.retry')}</Button>
        </>
      )}
    </div>
  );
}
