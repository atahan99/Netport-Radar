// src/lib/map-markers.ts
// DOM for the 2D map's HTML markers (planes, destination pins, home airports)
// and the cached per-marker paint state that keeps per-frame style writes cheap.

import type * as maplibregl from 'maplibre-gl';
import type { Flight, HomeAirport } from '@/types';
import type { Pose } from './lifecycle';
import { AIRCRAFT_ICONS, AIRCRAFT_SIZE } from './icons';
import { geoFlagLabel, geoMarkerOpacity } from './geo-display';
import { markerHeadingDeg } from './mesh-orientation';
import { reducedMotion } from './motion';

// FR24-style selection highlight (falls back to red when no theme accent).
const SELECTED_COLOR = 'var(--theme-accent, #ff3b30)';
const ICON_OUTLINE = 'rgba(0,0,0,0.55)';
const CHIP_BORDER = 'rgba(255,255,255,0.14)';

// Paint an icon path via style (not attributes) so CSS vars work for selection.
// Fill icons get a thin dark outline so livery colors read on light basemaps.
export function paintIconPath(path: SVGPathElement, f: Flight, selected: boolean): void {
  const icon = AIRCRAFT_ICONS[f.aircraftType];
  const color = selected ? SELECTED_COLOR : f.liveryColor;
  if (icon.mode === 'fill') {
    path.style.fill = color;
    path.style.stroke = ICON_OUTLINE;
    path.style.strokeWidth = '0.7';
  } else {
    path.style.fill = 'none';
    path.style.stroke = color;
    path.style.strokeWidth = f.aircraftType === 'ambulance' ? '2.6' : '2.2';
  }
}

// NOTE: no CSS filter here — a per-icon drop-shadow forces a re-raster of every
// marker on every transform change (~3x frame cost at 150 planes). The dark
// outline stroke (paintIconPath) provides the same legibility for free.
export function iconSvg(f: Flight, size: number): string {
  const icon = AIRCRAFT_ICONS[f.aircraftType];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block;overflow:visible"><path d="${icon.d}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function makeMarkerEl(f: Flight): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;cursor:pointer;will-change:transform';
  wrap.dataset.color = f.liveryColor;
  const plane = document.createElement('div');
  plane.dataset.role = 'plane';
  plane.style.cssText =
    'display:flex;align-items:center;justify-content:center;transition:transform .15s,filter .15s,opacity .3s';
  plane.innerHTML = iconSvg(f, AIRCRAFT_SIZE[f.aircraftType]);
  const path = plane.querySelector('path');
  if (path) paintIconPath(path, f, false);
  // FR24-style callsign chip above the plane.
  const label = document.createElement('div');
  label.dataset.role = 'label';
  label.style.cssText =
    `position:absolute;left:50%;bottom:100%;transform:translateX(-50%);margin-bottom:4px;white-space:nowrap;font:600 9px ui-monospace,monospace;color:#e4e4e7;background:rgba(9,9,11,0.72);border:1px solid ${CHIP_BORDER};border-radius:4px;padding:1px 4px;pointer-events:none`;
  label.textContent = `${f.id} ${geoFlagLabel(f)}`;
  wrap.append(plane, label);
  return wrap;
}

// Two-ring landing shockwave (mirrors the 3D globe flare): bright inner ring
// in the livery color + a faster, softer white outer ring.
export function spawnFlare(el: HTMLElement, color: string): void {
  const base =
    'position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px;border-radius:50%;pointer-events:none;';
  const inner = document.createElement('div');
  inner.style.cssText = `${base}border:2px solid ${color};animation:flare 0.8s ease-out forwards`;
  const outer = document.createElement('div');
  outer.style.cssText = `${base}border:1.5px solid rgba(255,255,255,0.8);animation:flare-outer 0.8s ease-out forwards`;
  el.append(inner, outer);
  setTimeout(() => {
    inner.remove();
    outer.remove();
  }, 820);
}

// Per-marker cached DOM refs + last-written values so the per-frame loop never
// queries the DOM and only writes styles that actually changed.
export interface MarkerEntry {
  m: maplibregl.Marker;
  plane: HTMLElement;
  label: HTMLElement;
  svg: SVGElement;
  path: SVGPathElement | null;
  last: {
    heading: number;
    color: string;
    sel: boolean;
    phase: string;
    opacity: number;
    scale: number;
    labelShown: boolean;
    chipText: string;
    lat: number;
    lng: number;
  };
}

export function makeMarkerEntry(m: maplibregl.Marker, f: Flight): MarkerEntry {
  const el = m.getElement();
  const plane = el.querySelector('[data-role=plane]') as HTMLElement;
  const label = el.querySelector('[data-role=label]') as HTMLElement;
  return {
    m,
    plane,
    label,
    svg: plane.firstElementChild as SVGElement,
    path: plane.querySelector('path'),
    last: {
      heading: NaN,
      color: f.liveryColor,
      sel: false,
      phase: f.phase,
      opacity: -1,
      scale: -1,
      labelShown: true, // matches the DOM: makeMarkerEl creates the chip visible
      chipText: label.textContent ?? '',
      lat: NaN,
      lng: NaN,
    },
  };
}

export function paintMarker(
  entry: MarkerEntry,
  f: Flight,
  heading: number,
  selected: boolean,
  showLabel: boolean,
  pose: Pose,
): void {
  const { plane, label, svg, path, last } = entry;
  const hd = markerHeadingDeg(heading);
  if (Math.abs(hd - last.heading) > 0.5 || Number.isNaN(last.heading)) {
    svg.style.transform = `rotate(${hd}deg)`;
    last.heading = hd;
  }
  // Repaint on livery OR selection change (selected planes swap to the accent).
  if (last.color !== f.liveryColor || last.sel !== selected) {
    last.color = f.liveryColor;
    last.sel = selected;
    if (path) paintIconPath(path, f, selected);
    plane.style.filter = selected ? `drop-shadow(0 0 5px ${f.liveryColor})` : 'none';
    label.style.color = selected ? '#fff' : '#e4e4e7';
    label.style.fontWeight = selected ? '700' : '600';
    label.style.borderColor = selected ? SELECTED_COLOR : CHIP_BORDER;
  }
  // one-shot landing flare on touchdown
  if (last.phase !== f.phase) {
    if (f.phase === 'landed' && !reducedMotion()) spawnFlare(entry.m.getElement(), f.liveryColor);
    last.phase = f.phase;
  }
  const opacity =
    (f.aircraftType === 'stealth' ? pose.opacity * 0.6 : pose.opacity) * geoMarkerOpacity(f);
  if (opacity !== last.opacity) {
    plane.style.opacity = String(opacity);
    last.opacity = opacity;
  }
  const scale = (selected ? 1.3 : 1) * pose.scale;
  if (scale !== last.scale) {
    plane.style.transform = `scale(${scale})`;
    last.scale = scale;
  }
  const shown = showLabel || selected;
  if (shown !== last.labelShown) {
    label.style.display = shown ? 'block' : 'none';
    last.labelShown = shown;
  }
  if (shown) {
    const text = `${f.id} ${geoFlagLabel(f)}`;
    if (text !== last.chipText) {
      label.textContent = text;
      last.chipText = text;
    }
  }
}

// FR24-style destination pin for the selected flight: flag chip on a stem.
export function makeDestPinEl(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none';
  const chip = document.createElement('div');
  chip.dataset.role = 'pin-chip';
  chip.style.cssText =
    'white-space:nowrap;font:600 9px ui-monospace,monospace;color:#fff;background:rgba(9,9,11,0.8);border:1px solid rgba(255,255,255,0.25);border-radius:4px;padding:1px 5px';
  const stem = document.createElement('div');
  stem.style.cssText = 'width:1px;height:7px;background:rgba(255,255,255,0.55)';
  const dot = document.createElement('div');
  dot.style.cssText =
    'width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(255,255,255,0.8)';
  wrap.append(chip, stem, dot);
  return wrap;
}

export function makeHomeEl(home: HomeAirport): HTMLDivElement {
  const color = home.isVpn ? '#a78bfa' : '#ffffff'; // violet-400: readable on dark basemaps
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:0;height:0;pointer-events:none';
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:1.5px solid ${color};animation:ring-pulse 3s ease-out ${i}s infinite`;
    wrap.appendChild(ring);
  }
  const dot = document.createElement('div');
  dot.style.cssText = `position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color}`;
  const label = document.createElement('div');
  label.style.cssText = `position:absolute;left:50%;top:12px;transform:translateX(-50%);white-space:nowrap;font:600 10px ui-sans-serif,system-ui;color:${color};text-shadow:0 0 4px #000`;
  label.textContent = home.label;
  wrap.append(dot, label);
  return wrap;
}

