// src/lib/globe-material.ts
// Custom globe surface materials. Themed themes get a MeshPhongMaterial whose
// fragment shader remaps the earth texture's luminance to the theme's
// water → land colors — full coastline/terrain detail in theme colors (the 3D
// analogue of the 2D basemap paint recolor), instead of flat country polygons.
// Photo themes (Satellite) keep the untouched texture. Materials + textures
// are cached per theme, so swapping themes never leaks GPU resources.

import * as THREE from 'three';
import type { Theme } from '@/lib/themes';

const texCache = new Map<string, THREE.Texture>();
const matCache = new Map<string, THREE.Material>();

function loadTexture(url: string, srgb: boolean): THREE.Texture {
  const key = `${url}|${srgb ? 's' : 'l'}`;
  let t = texCache.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    // Photo themes want proper sRGB display; the remap path samples raw values
    // (no decode) so the luminance thresholds match the file's histogram.
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texCache.set(key, t);
  }
  return t;
}

/** Globe surface material for a theme (cached). */
export function globeMaterialFor(theme: Theme): THREE.Material {
  let mat = matCache.get(theme.id);
  if (mat) return mat;

  if (!theme.globeLand || !theme.globeWater) {
    // Photo themes: plain textured phong (matches three-globe's default look).
    mat = new THREE.MeshPhongMaterial({ map: loadTexture(theme.globeImageUrl, true), shininess: 6 });
  } else {
    // Themed globes are UNLIT and FLAT: the 2D basemap palette reproduced
    // exactly (no lighting multiply, no specular, no bathymetry mottling) —
    // the globe reads as the 2D map wrapped on a sphere. Depth cues come from
    // the atmosphere rim and country borders, matching the FR24-flat look.
    const basic = new THREE.MeshBasicMaterial({ map: loadTexture(theme.globeImageUrl, false) });
    const water = new THREE.Color(theme.globeWater);
    const land = new THREE.Color(theme.globeLand);
    basic.onBeforeCompile = (shader) => {
      shader.uniforms.uWater = { value: water };
      shader.uniforms.uLand = { value: land };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 uWater;\nuniform vec3 uLand;',
        )
        .replace(
          '#include <map_fragment>',
          // earth-dark's measured luminance (raw, no sRGB decode) splits into
          // two bands: OCEAN ≈ 0–0.03 (near-black) and LAND ≈ 0.05–0.13
          // (terrain relief). The smoothstep knee sits in the gap between the
          // bands → antialiased coastlines.
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, vMapUv );
            float lum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            float landMix = smoothstep( 0.028, 0.055, lum );
            diffuseColor.rgb = mix( uWater, uLand, landMix );
          #endif`,
        );
    };
    mat = basic;
  }
  matCache.set(theme.id, mat);
  return mat;
}
