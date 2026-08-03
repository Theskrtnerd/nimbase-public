"use client";

import * as React from "react";
import { DesktopIcon, MoonIcon, SunIcon } from "@radix-ui/react-icons";
import * as z from "zod/v4";

import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const ThemeModeSchema = z.enum(["light", "dark", "auto"]);
const AccentIdSchema = z.enum([
  "blue",
  "cyan",
  "green",
  "purple",
  "rose",
  "orange",
]);

const DEFAULT_THEME_STORAGE_KEY = "theme-mode";
const DEFAULT_ACCENT_STORAGE_KEY = "theme-accent";

export type ThemeMode = z.output<typeof ThemeModeSchema>;
export type ResolvedTheme = Exclude<ThemeMode, "auto">;
export type AccentId = z.output<typeof AccentIdSchema>;

const DEFAULT_THEME_OPTIONS = [
  "light",
  "dark",
  "auto",
] as const satisfies readonly ThemeMode[];

/* ── Accent color presets ─────────────────────────────────────── */

export interface AccentPreset {
  id: AccentId;
  label: string;
  /** Preview swatch color (CSS value) */
  swatch: string;
}

export const accentPresets: AccentPreset[] = [
  { id: "blue", label: "Blue", swatch: "oklch(0.68 0.14 245)" },
  { id: "cyan", label: "Cyan", swatch: "oklch(0.72 0.12 200)" },
  { id: "green", label: "Green", swatch: "oklch(0.65 0.16 150)" },
  { id: "purple", label: "Purple", swatch: "oklch(0.62 0.18 290)" },
  { id: "rose", label: "Rose", swatch: "oklch(0.62 0.2 350)" },
  { id: "orange", label: "Orange", swatch: "oklch(0.7 0.16 55)" },
];

const getStoredThemeMode = (
  defaultTheme: ThemeMode,
  storageKey: string,
): ThemeMode => {
  if (typeof window === "undefined") return defaultTheme;
  try {
    const storedTheme = localStorage.getItem(storageKey);
    return ThemeModeSchema.parse(storedTheme);
  } catch {
    return defaultTheme;
  }
};

const setStoredThemeMode = (theme: ThemeMode, storageKey: string) => {
  try {
    const parsedTheme = ThemeModeSchema.parse(theme);
    localStorage.setItem(storageKey, parsedTheme);
  } catch {
    // Silently fail if localStorage is unavailable
  }
};

const getStoredAccent = (storageKey: string): AccentId => {
  if (typeof window === "undefined") return "blue";
  try {
    return AccentIdSchema.parse(localStorage.getItem(storageKey) ?? "blue");
  } catch {
    return "blue";
  }
};

const setStoredAccent = (id: AccentId, storageKey: string) => {
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // Silently fail
  }
};

const getSystemTheme = () => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const updateThemeClass = (themeMode: ThemeMode) => {
  const root = document.documentElement;
  root.classList.remove("light", "dark", "auto");
  const newTheme = themeMode === "auto" ? getSystemTheme() : themeMode;
  root.classList.add(newTheme);

  if (themeMode === "auto") {
    root.classList.add("auto");
  }
};

const updateAccentAttribute = (accentId: AccentId) => {
  const root = document.documentElement;
  root.setAttribute("data-accent", accentId);
};

/**
 * The on-screen theme is owned by the `.dark` class on <html>, which is set by
 * the pre-hydration script and the system-preference listener — neither of
 * which goes through React. Read that class as the source of truth so
 * `resolvedTheme` can never drift from what's actually rendered.
 */
const subscribeResolvedTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    mediaQuery.removeEventListener("change", onChange);
  };
};

const getResolvedThemeSnapshot = (): ResolvedTheme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const useResolvedTheme = (): ResolvedTheme =>
  React.useSyncExternalStore(
    subscribeResolvedTheme,
    getResolvedThemeSnapshot,
    () => "light" as const,
  );

const setupPreferredListener = () => {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => updateThemeClass("auto");
  mediaQuery.addEventListener("change", handler);
  return () => mediaQuery.removeEventListener("change", handler);
};

const getNextTheme = (current: ThemeMode): ThemeMode => {
  const themes: ThemeMode[] =
    getSystemTheme() === "dark"
      ? ["auto", "light", "dark"]
      : ["auto", "dark", "light"];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return themes[(themes.indexOf(current) + 1) % themes.length]!;
};

const getThemeDetectorScript = (
  defaultTheme: ThemeMode,
  storageKey: string,
  defaultAccent: AccentId,
  accentStorageKey: string,
) => {
  function themeFn(
    initialTheme: ThemeMode,
    key: string,
    initialAccent: AccentId,
    accentKey: string,
  ) {
    const isValidTheme = (theme: string): theme is ThemeMode => {
      const validThemes = ["light", "dark", "auto"] as const;
      return validThemes.includes(theme as ThemeMode);
    };
    const isValidAccent = (accent: string): accent is AccentId => {
      const validAccents = [
        "blue",
        "cyan",
        "green",
        "purple",
        "rose",
        "orange",
      ] as const;
      return validAccents.includes(accent as AccentId);
    };

    const storedTheme = localStorage.getItem(key) ?? initialTheme;
    const validTheme = isValidTheme(storedTheme) ? storedTheme : initialTheme;
    const storedAccent = localStorage.getItem(accentKey) ?? initialAccent;
    const validAccent = isValidAccent(storedAccent)
      ? storedAccent
      : initialAccent;

    document.documentElement.setAttribute("data-accent", validAccent);

    if (validTheme === "auto") {
      const autoTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      document.documentElement.classList.add(autoTheme, "auto");
    } else {
      document.documentElement.classList.add(validTheme);
    }
  }
  return `(${themeFn.toString()})(${JSON.stringify(defaultTheme)}, ${JSON.stringify(storageKey)}, ${JSON.stringify(defaultAccent)}, ${JSON.stringify(accentStorageKey)});`;
};

/**
 * Blocking inline theme-resolution script. Render this in document `<head>`
 * (before `<body>`) so the `.dark`/`.light` class lands on `<html>` before the
 * first paint — otherwise the body background paints in the default theme and
 * dark-mode users see a light flash. Use this on SSR surfaces (Next.js) and
 * pass `renderScript={false}` to `ThemeProvider` so it isn't run twice.
 */
export function ThemeScript({
  defaultTheme = "dark",
  themeStorageKey = DEFAULT_THEME_STORAGE_KEY,
  defaultAccent = "blue",
  accentStorageKey = DEFAULT_ACCENT_STORAGE_KEY,
}: {
  defaultTheme?: ThemeMode;
  themeStorageKey?: string;
  defaultAccent?: AccentId;
  accentStorageKey?: string;
}) {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: getThemeDetectorScript(
          defaultTheme,
          themeStorageKey,
          defaultAccent,
          accentStorageKey,
        ),
      }}
      suppressHydrationWarning
    />
  );
}

interface ThemeContextProps {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
  toggleMode: () => void;
  accentId: string;
  setAccent: (id: string) => void;
}
const ThemeContext = React.createContext<ThemeContextProps | undefined>(
  undefined,
);

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  themeStorageKey = DEFAULT_THEME_STORAGE_KEY,
  accentStorageKey = DEFAULT_ACCENT_STORAGE_KEY,
  renderScript = true,
}: React.PropsWithChildren<{
  defaultTheme?: ThemeMode;
  themeStorageKey?: string;
  accentStorageKey?: string;
  /**
   * Render the in-body anti-flash script. Set to `false` on SSR surfaces that
   * render `<ThemeScript>` in `<head>` instead, so it doesn't run twice.
   */
  renderScript?: boolean;
}>) {
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() =>
    getStoredThemeMode(defaultTheme, themeStorageKey),
  );
  const [accentId, setAccentId] = React.useState(() =>
    getStoredAccent(accentStorageKey),
  );
  const themeDetectorScript = React.useMemo(
    () =>
      getThemeDetectorScript(
        defaultTheme,
        themeStorageKey,
        "blue",
        accentStorageKey,
      ),
    [defaultTheme, themeStorageKey, accentStorageKey],
  );

  // Listen for system theme changes when in "auto" mode
  React.useEffect(() => {
    if (themeMode !== "auto") return;
    return setupPreferredListener();
  }, [themeMode]);

  const resolvedTheme = useResolvedTheme();

  // Keep the selected accent on the root element; CSS owns token values.
  React.useEffect(() => {
    updateAccentAttribute(accentId);
  }, [accentId]);

  const setTheme = React.useCallback(
    (newTheme: ThemeMode) => {
      setThemeMode(newTheme);
      setStoredThemeMode(newTheme, themeStorageKey);
      updateThemeClass(newTheme);
    },
    [themeStorageKey],
  );

  const toggleMode = React.useCallback(() => {
    setTheme(getNextTheme(themeMode));
  }, [setTheme, themeMode]);

  const setAccent = React.useCallback(
    (id: string) => {
      const nextAccent = AccentIdSchema.safeParse(id);
      if (!nextAccent.success) return;
      setAccentId(nextAccent.data);
      setStoredAccent(nextAccent.data, accentStorageKey);
    },
    [accentStorageKey],
  );

  const themeContextValue = React.useMemo(
    () => ({
      themeMode,
      resolvedTheme,
      setTheme,
      toggleMode,
      accentId,
      setAccent,
    }),
    [themeMode, resolvedTheme, setTheme, toggleMode, accentId, setAccent],
  );

  return (
    <ThemeContext value={themeContextValue}>
      {renderScript && (
        <script
          dangerouslySetInnerHTML={{ __html: themeDetectorScript }}
          suppressHydrationWarning
        />
      )}
      {children}
    </ThemeContext>
  );
}

export function useTheme() {
  const context = React.use(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

const themeLabels: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  auto: "System",
};

function ThemeIcon({ theme }: { theme: ThemeMode | ResolvedTheme }) {
  if (theme === "dark") {
    return <MoonIcon className="size-5" />;
  }

  if (theme === "auto") {
    return <DesktopIcon className="size-5" />;
  }

  return <SunIcon className="size-5" />;
}

export function ThemeToggle({
  themes = DEFAULT_THEME_OPTIONS,
}: {
  themes?: readonly ThemeMode[];
}) {
  const { themeMode, resolvedTheme, setTheme } = useTheme();
  const selectedTheme =
    themeMode === "auto" && !themes.includes("auto")
      ? resolvedTheme
      : themeMode;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" type="button">
          <ThemeIcon theme={selectedTheme} />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={selectedTheme}
          onValueChange={(value) => setTheme(ThemeModeSchema.parse(value))}
        >
          {themes.map((theme) => (
            <DropdownMenuRadioItem key={theme} value={theme}>
              <ThemeIcon theme={theme} />
              {themeLabels[theme]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
