// AG Studio theme for DockClock: road-sign green accent, asphalt ink, the same tokens as the driver app and cockpit.
import { studioTheme } from 'ag-studio';

const PALETTE = ['#00573F', '#FFD200', '#2B2F33', '#B3261E', '#4F8A74', '#C9A400', '#5B6167', '#E07B70', '#9CC5B5', '#8A8F94'];
const palette = Object.fromEntries(PALETTE.flatMap((c, i) => [[`chartPaletteFills${i + 1}Color`, c], [`chartPaletteStrokes${i + 1}Color`, c]]));

export const agStudioDockClockTheme = studioTheme.withParams({
  fontFamily: 'system-ui, sans-serif',
  fontSize: 14,
  textColor: '#1F2326',
  foregroundColor: '#1F2326',
  subtleTextColor: '#5B6167',
  backgroundColor: '#FFFFFF',
  borderColor: '#D8DDD9',
  accentColor: '#00573F',
  iconColor: '#2B2F33',
  rowHoverColor: '#E8F2EE',
  ...palette,
});
