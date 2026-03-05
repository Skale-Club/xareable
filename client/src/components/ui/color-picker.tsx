/**
 * ColorPicker - A modern color picker component with hue/saturation picker
 */

import * as React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface ColorPickerProps {
    value: string
    onChange: (color: string) => void
    placeholder?: string
    className?: string
    buttonClassName?: string
    label?: string
    showHexInput?: boolean
}

// Convert hex to HSV
function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) return null

    let r = parseInt(result[1], 16) / 255
    let g = parseInt(result[2], 16) / 255
    let b = parseInt(result[3], 16) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min

    let h = 0
    const s = max === 0 ? 0 : d / max
    const v = max

    if (max !== min) {
        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6
                break
            case g:
                h = ((b - r) / d + 2) / 6
                break
            case b:
                h = ((r - g) / d + 4) / 6
                break
        }
    }

    return { h: h * 360, s: s * 100, v: v * 100 }
}

// Convert HSV to hex
function hsvToHex(h: number, s: number, v: number): string {
    s /= 100
    v /= 100

    const c = v * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = v - c

    let r = 0, g = 0, b = 0

    if (h >= 0 && h < 60) {
        r = c; g = x; b = 0
    } else if (h >= 60 && h < 120) {
        r = x; g = c; b = 0
    } else if (h >= 120 && h < 180) {
        r = 0; g = c; b = x
    } else if (h >= 180 && h < 240) {
        r = 0; g = x; b = c
    } else if (h >= 240 && h < 300) {
        r = x; g = 0; b = c
    } else {
        r = c; g = 0; b = x
    }

    const toHex = (n: number) => {
        const hex = Math.round((n + m) * 255).toString(16)
        return hex.length === 1 ? "0" + hex : hex
    }

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Preset colors
const PRESET_COLORS = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
    "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
    "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
    "#ec4899", "#f43f5e", "#78716c", "#64748b", "#1e293b",
]

export function ColorPicker({
    value,
    onChange,
    placeholder = "#000000",
    className,
    buttonClassName,
    label,
    showHexInput = true,
}: ColorPickerProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [hsv, setHsv] = useState<{ h: number; s: number; v: number }>({ h: 0, s: 0, v: 100 })
    const [hexInput, setHexInput] = useState(value || "")

    const saturationRef = useRef<HTMLDivElement>(null)
    const hueRef = useRef<HTMLDivElement>(null)
    const isDraggingSaturation = useRef(false)
    const isDraggingHue = useRef(false)

    // Update HSV when value changes
    useEffect(() => {
        if (value) {
            const newHsv = hexToHsv(value)
            if (newHsv) {
                setHsv(newHsv)
            }
            setHexInput(value)
        }
    }, [value])

    // Update color from HSV
    const updateColorFromHsv = useCallback((h: number, s: number, v: number) => {
        const hex = hsvToHex(h, s, v)
        setHexInput(hex)
        onChange(hex)
    }, [onChange])

    // Handle saturation picker interaction
    const handleSaturationInteraction = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (!saturationRef.current) return

        const rect = saturationRef.current.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

        const newS = x * 100
        const newV = 100 - y * 100

        setHsv(prev => {
            const updated = { ...prev, s: newS, v: newV }
            updateColorFromHsv(updated.h, updated.s, updated.v)
            return updated
        })
    }, [updateColorFromHsv])

    // Handle hue slider interaction
    const handleHueInteraction = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (!hueRef.current) return

        const rect = hueRef.current.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const newH = x * 360

        setHsv(prev => {
            const updated = { ...prev, h: newH }
            updateColorFromHsv(updated.h, updated.s, updated.v)
            return updated
        })
    }, [updateColorFromHsv])

    // Mouse event handlers
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingSaturation.current) {
                handleSaturationInteraction(e)
            } else if (isDraggingHue.current) {
                handleHueInteraction(e)
            }
        }

        const handleMouseUp = () => {
            isDraggingSaturation.current = false
            isDraggingHue.current = false
        }

        window.addEventListener("mousemove", handleMouseMove)
        window.addEventListener("mouseup", handleMouseUp)

        return () => {
            window.removeEventListener("mousemove", handleMouseMove)
            window.removeEventListener("mouseup", handleMouseUp)
        }
    }, [handleSaturationInteraction, handleHueInteraction])

    // Handle hex input change
    const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let hex = e.target.value
        if (!hex.startsWith("#")) {
            hex = "#" + hex
        }
        setHexInput(hex)

        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            onChange(hex)
            const newHsv = hexToHsv(hex)
            if (newHsv) {
                setHsv(newHsv)
            }
        }
    }

    // Handle preset color click
    const handlePresetClick = (color: string) => {
        setHexInput(color)
        onChange(color)
        const newHsv = hexToHsv(color)
        if (newHsv) {
            setHsv(newHsv)
        }
    }

    const currentColor = value || placeholder

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <div className={cn("flex gap-2 items-center", className)}>
                    <button
                        type="button"
                        className={cn("w-10 h-10 rounded-lg border-2 border-input hover:border-ring transition-colors overflow-hidden cursor-pointer shadow-sm", buttonClassName)}
                        style={{ backgroundColor: currentColor }}
                    >
                        <span className="sr-only">Open color picker</span>
                    </button>
                    {showHexInput && (
                        <Input
                            value={hexInput}
                            onChange={handleHexChange}
                            placeholder={placeholder}
                            className="font-mono"
                        />
                    )}
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="start">
                <div className="space-y-4">
                    {label && <Label className="text-sm font-medium">{label}</Label>}

                    {/* Saturation/Lightness Picker */}
                    <div
                        ref={saturationRef}
                        className="relative w-full h-40 rounded-lg cursor-crosshair overflow-hidden border"
                        style={{
                            backgroundColor: hsvToHex(hsv.h, 100, 100),
                        }}
                        onMouseDown={(e) => {
                            isDraggingSaturation.current = true
                            handleSaturationInteraction(e)
                        }}
                    >
                        {/* White to transparent gradient (horizontal) */}
                        <div
                            className="absolute inset-0"
                            style={{
                                background: "linear-gradient(to right, white, transparent)",
                            }}
                        />
                        {/* Transparent to black gradient (vertical) */}
                        <div
                            className="absolute inset-0"
                            style={{
                                background: "linear-gradient(to top, black, transparent)",
                            }}
                        />
                        {/* Cursor */}
                        <div
                            className="absolute w-4 h-4 border-2 border-white rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                            style={{
                                left: `${hsv.s}%`,
                                top: `${100 - hsv.v}%`,
                                backgroundColor: currentColor,
                            }}
                        />
                    </div>

                    {/* Hue Slider */}
                    <div
                        ref={hueRef}
                        className="relative w-full h-4 rounded-lg cursor-pointer overflow-hidden border"
                        style={{
                            background: "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
                        }}
                        onMouseDown={(e) => {
                            isDraggingHue.current = true
                            handleHueInteraction(e)
                        }}
                    >
                        {/* Hue indicator */}
                        <div
                            className="absolute top-0 w-1 h-full bg-white border border-gray-300 shadow transform -translate-x-1/2 pointer-events-none"
                            style={{
                                left: `${(hsv.h / 360) * 100}%`,
                            }}
                        />
                    </div>

                    {/* Hex Input */}
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">HEX</Label>
                        <Input
                            value={hexInput}
                            onChange={handleHexChange}
                            placeholder="#000000"
                            className="font-mono h-9"
                        />
                    </div>

                    {/* Preset Colors */}
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Presets</Label>
                        <div className="grid grid-cols-10 gap-1">
                            {PRESET_COLORS.map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    className={cn(
                                        "w-6 h-6 rounded-md border transition-transform hover:scale-110",
                                        currentColor.toLowerCase() === color.toLowerCase() && "ring-2 ring-offset-1 ring-primary"
                                    )}
                                    style={{ backgroundColor: color }}
                                    onClick={() => handlePresetClick(color)}
                                >
                                    <span className="sr-only">{color}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
