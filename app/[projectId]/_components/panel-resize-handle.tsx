"use client";

import {
  useCallback,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { cn } from "@/lib/utils";

const KEYBOARD_STEP = 16;

/**
 * Vertical drag handle that resizes the sidebar it sits beside. The pointer is
 * captured on drag start so the resize keeps tracking when it leaves the thin
 * strip, and the arrow keys resize in the same direction as dragging.
 */
export function PanelResizeHandle({
  panelSide,
  label,
  value,
  active = false,
  onResize,
  onResizeStart,
  onResizeEnd,
  className,
}: {
  /** Which side of the handle the resizable panel sits on. */
  panelSide: "left" | "right";
  /** Announced to screen readers; also names the separator. */
  label: string;
  /** Current panel width in px, exposed via aria-valuenow. */
  value: number;
  /** Highlighted while the parent owns an in-progress drag. */
  active?: boolean;
  /** Width delta in px since the previous call; positive widens the panel. */
  onResize: (delta: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  className?: string;
}) {
  const lastXRef = useRef<number | null>(null);

  const startDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastXRef.current = event.clientX;
    onResizeStart?.();
  }, [onResizeStart]);

  const moveDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (lastXRef.current === null) return;
    const dragged = event.clientX - lastXRef.current;
    lastXRef.current = event.clientX;
    if (dragged === 0) return;
    onResize(panelSide === "left" ? dragged : -dragged);
  }, [onResize, panelSide]);

  const stopDrag = useCallback(() => {
    if (lastXRef.current === null) return;
    lastXRef.current = null;
    onResizeEnd?.();
  }, [onResizeEnd]);

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const growKey = panelSide === "left" ? "ArrowRight" : "ArrowLeft";
    const shrinkKey = panelSide === "left" ? "ArrowLeft" : "ArrowRight";
    if (event.key !== growKey && event.key !== shrinkKey) return;
    event.preventDefault();
    onResize(event.key === growKey ? KEYBOARD_STEP : -KEYBOARD_STEP);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={cn(
        "group relative z-50 w-1.5 shrink-0 cursor-col-resize touch-none select-none outline-none",
        className,
      )}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onKeyDown={resizeWithKeyboard}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-100",
          "group-hover:bg-primary/70 group-focus-visible:bg-primary/70",
          active && "bg-primary",
        )}
      />
    </div>
  );
}
