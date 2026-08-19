"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === "dark" ? "light" : "dark";
  return (
    <DropdownMenuItem onSelect={() => setTheme(next)}>
      {resolvedTheme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      Switch to {next} mode
    </DropdownMenuItem>
  );
}
