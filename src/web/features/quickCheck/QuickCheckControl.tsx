import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { IconButton } from '../../components/IconButton.js';
import { QUICK_CHECK_BOTTOM_PX } from '../mobile/snap.js';

/**
 * Mobile only: a round 56 px ✓ button at the bottom right, above the sheet's peek, filled orange while
 * the mode is on (spec §10.3), so it is one tap away while walking the map. On desktop the switch is
 * in the tool navigation of the top bar (`quickCheckTool`); on mobile it is in its Tools menu too.
 */
export function QuickCheckControl() {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const on = useUiStore(s => s.interactionMode === 'quick');
  const setMode = useUiStore(s => s.setMode);
  if (!mobile) return null;
  return (
    <IconButton
      aria-label={t('quickCheck.control')}
      aria-pressed={on}
      variant={on ? 'primary' : 'secondary'}
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
