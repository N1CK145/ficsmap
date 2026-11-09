import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { nearestWheelSpeedStop, WHEEL_SPEED, WHEEL_SPEED_STOPS } from '../../../shared/prefs.js';
import { savePrefs, useSetPrefs, usePrefsSaveStatus, usePrefsStore, useWheelSpeed } from '../../app/prefs.js';
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
import { useMe } from './queries.js';

/**
 * `/profile`: the signed-in user's own settings, outside any world (reached from the account menu). The mouse wheel
 * speed is stored on the account (app/prefs.ts); the language stays a setting of this device. Server owners also get
 * a general invite link here.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from the account menu: back to where the user came from; opened directly: to the world list.
  const back = () => (location.key === 'default' ? navigate('/?list=1') : navigate(-1));

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
              <WheelSpeedSetting />
            </Window>
            <Window title={t('language.label')} bodyClassName="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted">{t('profile.languageHint')}</p>
              <LanguageSwitch />
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

/** The wheel speed as a slider with its value, [Default] and the save state. Changes apply at once. */
function WheelSpeedSetting() {
  const { t } = useTranslation();
  const speed = useWheelSpeed();
  const setPrefs = useSetPrefs();
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
      <SaveStatus />
    </div>
  );
}

/** "Saving…", "Saved", or a failed save with [Retry]; announced politely. */
function SaveStatus() {
  const { t } = useTranslation();
  const status = usePrefsSaveStatus();
  // A "Saved" from an earlier visit is old news.
  useEffect(() => {
    if (usePrefsStore.getState().status === 'saved') usePrefsStore.setState({ status: 'idle' });
  }, []);

  return (
    <div role="status" className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {status === 'pending' && <span className="text-muted">{t('profile.saving')}</span>}
      {status === 'saved' && <span className="flex items-center gap-1.5 text-free"><CheckIcon />{t('profile.saved')}</span>}
      {status === 'failed' && (
        <>
          <span className="text-conflict">{t('profile.saveFailed')}</span>
          <Button size="sm" variant="ghost" onClick={() => void savePrefs()}>{t('common.retry')}</Button>
        </>
      )}
    </div>
  );
}
