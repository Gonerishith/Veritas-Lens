import type { SampleImage } from '../types/forensics';

export const SAMPLE_IMAGES: SampleImage[] = [
  {
    id: 'sample-watchmaker',
    title: 'Watchmaker Workshop Study',
    subtitle: 'Editorial portrait · Natural side lighting',
    category: 'Portrait',
    url: '/src/assets/images/sample_editorial_portrait_1795277622925.jpg',
    fileName: 'watchmaker-workshop-study.jpg',
    forensicNote: 'Test fine skin grain, hand anatomy, watch gears, and directional window shadows.',
  },
  {
    id: 'sample-pavilion',
    title: 'Alabaster Glass Pavilion',
    subtitle: 'Architectural concept · Mirror reflection',
    category: 'Architecture',
    url: '/src/assets/images/sample_synthetic_architecture_1795277622441.jpg',
    fileName: 'alabaster-glass-pavilion.jpg',
    forensicNote: 'Inspect structural symmetry, nested glass arches, mist diffusion, and water reflection physics.',
  },
  {
    id: 'sample-fern',
    title: 'Morning Dew Fern Frond',
    subtitle: 'Botanical macro · Shallow optical focus',
    category: 'Macro',
    url: '/src/assets/images/sample_botanical_macro_1795277639542.jpg',
    fileName: 'morning-dew-fern-macro.jpg',
    forensicNote: 'Examine water droplet refraction, organic leaf imperfections, and natural optical bokeh falloff.',
  },
  {
    id: 'sample-alley',
    title: 'Midnight Rain Alleyway',
    subtitle: 'Urban night scene · Neon signage',
    category: 'Urban Scene',
    url: '/src/assets/images/sample_neon_street_1795277621793.jpg',
    fileName: 'midnight-rain-alleyway.jpg',
    forensicNote: 'Check illuminated storefront typography, mirrored puddle reflections, and atmospheric haze.',
  },
];
