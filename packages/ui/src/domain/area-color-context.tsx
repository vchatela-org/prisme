'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { areaColorVar, type AreaColorOverrides, type AreaKind } from '../tokens/area-color.js';

const AreaColorContext = createContext<AreaColorOverrides>({});

/**
 * Carries an instance's area→slot pinning down the tree, so no call site has
 * to pass it and no two call sites can disagree. Wrap the app once, in the
 * shell; the map itself comes from configuration, never from this repository
 * (area keys are instance data — docs/17-privacy.md).
 */
export function AreaColorProvider({
  overrides,
  children,
}: {
  overrides: AreaColorOverrides;
  children: ReactNode;
}) {
  const value = useMemo(() => overrides, [overrides]);
  return <AreaColorContext.Provider value={value}>{children}</AreaColorContext.Provider>;
}

/** The CSS custom property an area paints with, honouring any pinning. */
export function useAreaColorVar(key: string, kind: AreaKind = 'area'): string {
  return areaColorVar(key, kind, useContext(AreaColorContext));
}
