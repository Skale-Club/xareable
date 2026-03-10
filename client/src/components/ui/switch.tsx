import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer relative inline-flex h-6 w-[46px] shrink-0 cursor-pointer items-center rounded-full border-0 bg-[rgb(131,131,131)] p-0 transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(0.27,0.2,0.25,1.51)]",
      "[&[data-state=checked]]:bg-[rgb(0,218,80)]",
      "[&[data-state=checked]_.switch-thumb]:translate-x-[22px]",
      "[&[data-state=checked]_.switch-thumb]:shadow-[-1px_1px_2px_rgba(163,163,163,0.45)]",
      "[&[data-state=checked]_.switch-effect]:translate-x-[22px]",
      "[&[data-state=checked]_.switch-cross]:scale-0",
      "[&[data-state=checked]_.switch-check]:scale-100",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
    ref={ref}
  >
    <span
      aria-hidden="true"
      className="switch-effect pointer-events-none absolute left-[7.5px] h-[3.5px] w-[9px] rounded-[1px] bg-white transition-transform duration-200 ease-in-out"
    />
    <SwitchPrimitives.Thumb
      className={cn(
        "switch-thumb pointer-events-none absolute left-[3px] block h-[18px] w-[18px] rounded-full bg-white shadow-[1px_1px_2px_rgba(146,146,146,0.45)] ring-0 transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.27,0.2,0.25,1.51)]"
      )}
    >
      <span className="relative flex h-full w-full items-center justify-center">
        <svg
          aria-hidden="true"
          viewBox="0 0 365.696 365.696"
          className="switch-cross absolute h-[6px] w-[6px] scale-100 text-[rgb(131,131,131)] transition-transform duration-200 ease-[cubic-bezier(0.27,0.2,0.25,1.51)]"
        >
          <path
            fill="currentColor"
            d="M243.188 182.86 356.32 69.726c12.5-12.5 12.5-32.766 0-45.247L341.238 9.398c-12.504-12.503-32.77-12.503-45.25 0L182.86 122.528 69.727 9.374c-12.5-12.5-32.766-12.5-45.247 0L9.375 24.457c-12.5 12.504-12.5 32.77 0 45.25l113.152 113.152L9.398 295.99c-12.503 12.503-12.503 32.769 0 45.25L24.48 356.32c12.5 12.5 32.766 12.5 45.247 0l113.132-113.132L295.99 356.32c12.503 12.5 32.769 12.5 45.25 0l15.081-15.082c12.5-12.504 12.5-32.77 0-45.25zm0 0"
          />
        </svg>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="switch-check absolute h-[10px] w-[10px] scale-0 text-[rgb(0,218,80)] transition-transform duration-200 ease-[cubic-bezier(0.27,0.2,0.25,1.51)]"
        >
          <path
            fill="currentColor"
            d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z"
          />
        </svg>
      </span>
    </SwitchPrimitives.Thumb>
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
