import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT } from './theme';

// Bottom padding that keeps the end of a scrolling screen clear of the floating tab bar
export function useTabBarSpace() {
    return TAB_BAR_HEIGHT + useSafeAreaInsets().bottom + 16;
}
