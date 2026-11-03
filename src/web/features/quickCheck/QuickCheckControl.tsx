import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { IconButton } from '../../components/IconButton.js';
import { QUICK_CHECK_BOTTOM_PX } from '../mobile/snap.js';

/**
 * "✓ Quick Check" under the zoom buttons, filled orange while the mode is on. On mobile a round
 * 56 px ✓ button at the bottom right, above the sheet's peek (spec §10.3).
 */
export function QuickCheckControl() {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const on = useUiStore(s => s.interactionMode === 'quick');
  const setMode = useUiStore(s => s.setMode);
  const variant = on ? 'primary' : 'secondary';
  if (mobile) {
    return (
      <IconButton
        aria-label={t('quickCheck.control')}
        aria-pressed={on}
        variant={variant}
        size="lg"
        shape="round"
        className="fixed right-4 shadow-lg"
        style={{ bottom: QUICK_CHECK_BOTTOM_PX }}
        onClick={() => setMode('quick')}
      >
        <span aria-hidden="true">✓</span>
      </IconButton>
    );
  }
  return (
    <Button variant={variant} size="sm" aria-pressed={on} aria-keyshortcuts="Q" onClick={() => setMode('quick')}>
      <span aria-hidden="true">✓</span>{t('quickCheck.control')}
    </Button>
  );
}
