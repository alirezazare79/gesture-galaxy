/**
 * Shaders GLSL de la galaxie.
 * Toute l'animation des particules (rotation, expansion, contraction, onde de choc,
 * scintillement) est calculée sur le GPU : le CPU ne met à jour que quelques uniforms
 * par image, ce qui permet d'animer des dizaines de milliers d'étoiles sans coût JavaScript.
 */

export const galaxyVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uExpand;      // -1 (contraction) .. +1 (expansion)
  uniform float uIntro;       // 0 -> 1 : animation d'apparition « big bang »
  uniform float uPulseAge;    // secondes depuis la dernière impulsion
  uniform float uPulseAmp;    // 0 ou 1
  uniform float uColorShift;  // 0 -> 1 : teinte temporaire après un pincement
  uniform vec3  uPulseColor;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uPulseSizeGain; // grossissement des particules pendant l'impulsion

  attribute vec4 aOrbit;  // rayon, angle, hauteur, graine aléatoire
  attribute vec3 aDelta;  // écart au « squelette » du bras spiral (dr, dθ, dy)
  attribute vec3 aColor;
  attribute vec2 aProps;  // taille, opacité

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float r0   = aOrbit.x;
    float seed = aOrbit.w;
    float e = max(uExpand, 0.0);
    float c = max(-uExpand, 0.0);

    // Expansion : les étoiles se resserrent sur leur bras -> bras plus nets.
    float focus = e * 0.6;
    float r  = r0        - aDelta.x * focus;
    float th = aOrbit.y  - aDelta.y * focus;
    float y  = aOrbit.z  - aDelta.z * focus;

    // Rotation différentielle du bulbe central + légère oscillation orbitale.
    th += uTime * 0.32 * exp(-r0 * 0.85);
    th += sin(uTime * 0.23 + seed * 6.2831) * 0.012;

    // Expansion : la galaxie s'agrandit et s'épaissit légèrement.
    r *= 1.0 + 0.55 * e;
    y *= 1.0 + 0.35 * e;

    // Contraction : aspiration vers le centre avec un tourbillon.
    float pull = c * (0.8 + 0.12 * seed);
    r = mix(r, r * 0.2 + 0.3 * seed, pull);
    th += c * c * 2.4 / (0.6 + r0 * 0.35);
    y *= 1.0 - 0.8 * c;

    // Apparition : tout part du centre en spirale.
    float intro = uIntro;
    r *= mix(0.015, 1.0, intro);
    th += (1.0 - intro) * 6.0 / (0.5 + r0 * 0.3);
    y *= intro;

    // Impulsion : explosion radiale + onde de choc qui parcourt le disque.
    float age   = uPulseAge;
    float blast = uPulseAmp * age * 3.4 * exp(1.0 - age * 3.4);           // pic à ~0,3 s
    float dist  = r - age * 12.0;
    float ring  = uPulseAmp * exp(-dist * dist * 0.3) * exp(-age * 0.9);
    r += blast * (0.8 + 0.7 * seed) * (0.5 + r0 * 0.12) + ring * 0.8;
    y += blast * (seed - 0.5) * 3.2;

    vec3 pos = vec3(cos(th) * r, y, sin(th) * r);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // Couleur : palette de base -> teinte de l'impulsion, + éclat sur l'onde de choc.
    vec3 col = mix(aColor, uPulseColor * (0.7 + 0.6 * seed), uColorShift * (0.45 + 0.4 * seed));
    float coreHeat = c * exp(-r * 0.8);                                    // le noyau s'embrase
    col = col * (1.0 + coreHeat * 0.5 + blast * 0.5) + uPulseColor * ring * 1.1;

    float twinkle = 0.72 + 0.28 * sin(uTime * (0.8 + seed * 2.6) + seed * 47.0);
    vColor = col;
    // Compense l'accumulation lumineuse quand toutes les étoiles se resserrent au centre.
    vAlpha = aProps.y * mix(1.0, twinkle, 0.85) * (1.0 - 0.55 * c);

    float size = aProps.x * uSize * (0.85 + 0.3 * twinkle) * (1.0 + (ring * 0.9 + blast * 0.35) * uPulseSizeGain);
    gl_PointSize = clamp(size * uPixelRatio / -mv.z, 0.0, 72.0 * uPixelRatio);
  }
`;

export const starFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;
    // Cœur net + halo doux : aspect d'étoile lumineuse.
    float strength = (exp(-d * d * 16.0) + exp(-d * d * 4.0) * 0.32) * (1.0 - d);
    gl_FragColor = vec4(vColor, strength * vAlpha);
    #include <colorspace_fragment>
  }
`;

export const dustFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;
    // Nébuleuse : nuage très diffus.
    float strength = exp(-d * d * 3.0) * (1.0 - d);
    gl_FragColor = vec4(vColor, strength * vAlpha);
    #include <colorspace_fragment>
  }
`;

export const backgroundVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute vec2 aStar; // taille, graine
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.55 + 0.45 * sin(uTime * (0.5 + aStar.y * 1.7) + aStar.y * 90.0);
    vColor = aColor;
    vAlpha = tw;
    gl_PointSize = aStar.x * uPixelRatio * (0.8 + 0.4 * tw);
  }
`;
