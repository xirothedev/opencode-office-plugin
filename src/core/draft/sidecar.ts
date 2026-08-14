import { getSidecarsDir } from "@/core/storage/paths"
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import type { FileMetadata } from "@/core/format/metadata"

export type WatermarkPosition = "diagonal-center" | "top-center" | "bottom-center"

export interface WatermarkConfig {
  text: string
  position?: WatermarkPosition
  size?: number
  opacity?: number
}

export interface AnnotationPosition {
  x: number
  y: number
}

export interface AnnotationRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AnnotationOp {
  type: "note" | "highlight" | "stamp"
  text?: string
  position?: AnnotationPosition
  rect?: AnnotationRect
  size?: number
}

export interface Sidecar {
  metadata?: FileMetadata
  watermark?: WatermarkConfig | null
  annotations?: AnnotationOp[]
}

export function getSidecarPath(filePathHash: string, sessionID: string): string {
  return join(getSidecarsDir(), filePathHash, `${sessionID}.json`)
}

export function readSidecar(filePathHash: string, sessionID: string): Sidecar | null {
  const sidecarPath = getSidecarPath(filePathHash, sessionID)
  if (!existsSync(sidecarPath)) {
    return null
  }
  return JSON.parse(readFileSync(sidecarPath, "utf-8")) as Sidecar
}

export function writeSidecar(filePathHash: string, sessionID: string, sidecar: Sidecar): void {
  const sidecarPath = getSidecarPath(filePathHash, sessionID)
  mkdirSync(dirname(sidecarPath), { recursive: true })
  writeFileSync(sidecarPath, JSON.stringify(sidecar))
}

export function deleteSidecar(filePathHash: string, sessionID: string): void {
  const sidecarPath = getSidecarPath(filePathHash, sessionID)
  if (existsSync(sidecarPath)) {
    unlinkSync(sidecarPath)
  }
}
