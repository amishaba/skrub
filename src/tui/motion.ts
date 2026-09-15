import { useEffect, useRef, useState } from "react";

export function useTick(ms: number, enabled = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return n;
}

/** Lines (or units) visible so far. Resets when `key` changes. */
export function useReveal(key: string, total: number, ms = 20): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (total <= 0) return;
    const t = setInterval(() => {
      setN((x) => {
        if (x >= total) {
          clearInterval(t);
          return x;
        }
        return x + 1;
      });
    }, ms);
    return () => clearInterval(t);
  }, [key, total, ms]);
  return Math.min(n, total);
}

export function useCountUp(target: number, enabled: boolean, ms = 320): number {
  const [n, setN] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setN(target);
      return;
    }
    setN(0);
    if (target <= 0) return;
    const start = Date.now();
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / ms);
      setN(Math.round(target * p));
      if (p >= 1) clearInterval(t);
    }, 32);
    return () => clearInterval(t);
  }, [target, enabled, ms]);
  return n;
}

/** True for `ms` after `value` increases. */
export function usePulse(value: number, ms = 220): boolean {
  const [on, setOn] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value <= prev.current) {
      prev.current = value;
      return;
    }
    prev.current = value;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return on;
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
