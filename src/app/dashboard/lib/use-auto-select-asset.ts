import { useEffect, useMemo, useState } from 'react';

/**
 * Auto-selects the first asset from a list when the list changes
 * and the current selection is empty or not in the list.
 */
export function useAutoSelectAsset(
  assets: string[],
  options?: {
    filter?: (a: string) => boolean;
    defaultAsset?: string;
  }
): [string, (v: string) => void] {
  const [selected, setSelected] = useState('');
  const assetsKey = useMemo(() => assets.join(','), [assets]);
  const filtered = options?.filter ? assets.filter(options.filter) : assets;

  useEffect(() => {
    if (!filtered.length) return;
    if (selected && filtered.includes(selected)) return;
    if (options?.defaultAsset && filtered.includes(options.defaultAsset)) {
      setSelected(options.defaultAsset);
    } else {
      setSelected(filtered[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsKey, filtered.length]);

  return [selected, setSelected];
}
