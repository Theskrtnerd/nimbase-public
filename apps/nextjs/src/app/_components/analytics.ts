"use client";

import type { ReactNode } from "react";
import { createContext, createElement, useContext } from "react";

export interface ProductAnalytics {
  capture(event: string, properties?: Record<string, unknown>): void;
}

const communityAnalytics: ProductAnalytics = {
  capture() {
    return;
  },
};

const AnalyticsContext = createContext<ProductAnalytics>(communityAnalytics);

export function ProductAnalyticsProvider({
  analytics,
  children,
}: {
  analytics: ProductAnalytics;
  children: ReactNode;
}) {
  return createElement(
    AnalyticsContext.Provider,
    { value: analytics },
    children,
  );
}

/**
 * Community has no product-analytics destination. Nimbase Cloud supplies its
 * own adapter at this seam without coupling shared product flows to a vendor.
 */
export function useAnalytics(): ProductAnalytics {
  return useContext(AnalyticsContext);
}
