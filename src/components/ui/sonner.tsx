"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"
import { useEffect, useState } from "react"

/** App-theme-aware sonner toaster. The stock shadcn version reads `next-themes`
    ( whose provider is never mounted here ) — this one reads the same
    `document.documentElement.dataset.theme` flag the ThemeToggle writes, so it
    can never disagree with the page. */
const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const read = () =>
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds client-only theme script state on mount
    setTheme(read());
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        style: {
          background: "var(--raised)",
          color: "var(--ink)",
          border: "1px solid var(--line)",
        } as React.CSSProperties,
      }}
      style={
        {
          "--normal-bg": "var(--raised)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
