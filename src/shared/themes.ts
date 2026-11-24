/**
 * Hermes-parity theme catalog for Pixel (Dark, Light, and curated developer/editorial palettes).
 * Stored in `src/shared/` so both settings, renderer, and tests share one canonical list.
 */

export interface PixelThemePreset {
  id: string;
  name: string;
  mode: 'dark' | 'light';
  description: string;
  tokens: {
    canvas: string;
    surface: string;
    surfaceRaised: string;
    surfaceHover: string;
    border: string;
    borderStrong: string;
    ink: string;
    inkMuted: string;
    inkDim: string;
    accent: string;
    accentHover: string;
  };
}

export const PIXEL_THEME_PRESETS: readonly PixelThemePreset[] = [
  {
    id: 'obsidian-dark',
    name: 'Obsidian Dark',
    mode: 'dark',
    description: 'Deep matte charcoal with crisp #4299F5 blue accents (Default).',
    tokens: {
      canvas: '#0a0b0e',
      surface: '#0e1014',
      surfaceRaised: '#14171e',
      surfaceHover: '#1a1e28',
      border: '#1f232e',
      borderStrong: '#2c3242',
      ink: '#eef1f6',
      inkMuted: '#9aa3b2',
      inkDim: '#6f7787',
      accent: '#4299F5',
      accentHover: '#60a9fa',
    },
  },
  {
    id: 'paper-light',
    name: 'Paper Light',
    mode: 'light',
    description: 'Clean high-contrast daylight workspace with crisp dark ink.',
    tokens: {
      canvas: '#f5f6f8',
      surface: '#ffffff',
      surfaceRaised: '#eef1f6',
      surfaceHover: '#e4e8f0',
      border: '#d6dbe6',
      borderStrong: '#b8c0d0',
      ink: '#14171e',
      inkMuted: '#475063',
      inkDim: '#647087',
      accent: '#1d70c9',
      accentHover: '#185ea9',
    },
  },
  {
    id: 'midnight-slate',
    name: 'Midnight Slate',
    mode: 'dark',
    description: 'Deep oceanic navy-slate inspired by Hermes dark telemetry.',
    tokens: {
      canvas: '#0b101b',
      surface: '#101726',
      surfaceRaised: '#162033',
      surfaceHover: '#1d2a42',
      border: '#23314d',
      borderStrong: '#32456b',
      ink: '#eaf0fb',
      inkMuted: '#99aac7',
      inkDim: '#6d80a3',
      accent: '#4299F5',
      accentHover: '#60a9fa',
    },
  },
  {
    id: 'nordic-dusk',
    name: 'Nordic Dusk',
    mode: 'dark',
    description: 'Arctic frost blue-gray surfaces with soft contrast.',
    tokens: {
      canvas: '#1b202b',
      surface: '#222836',
      surfaceRaised: '#293040',
      surfaceHover: '#323a4d',
      border: '#384257',
      borderStrong: '#495670',
      ink: '#eceff4',
      inkMuted: '#b8c2d4',
      inkDim: '#8894ab',
      accent: '#88c0d0',
      accentHover: '#8fbcbb',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    mode: 'dark',
    description: 'Indigo twilight canvas with luminous electric blue highlights.',
    tokens: {
      canvas: '#13141f',
      surface: '#1a1b26',
      surfaceRaised: '#222436',
      surfaceHover: '#2b2e45',
      border: '#2f334d',
      borderStrong: '#414868',
      ink: '#c0caf5',
      inkMuted: '#9aa5ce',
      inkDim: '#6b7399',
      accent: '#7aa2f7',
      accentHover: '#89b4fa',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    mode: 'dark',
    description: 'Velvet mocha dark theme with balanced pastel blue accents.',
    tokens: {
      canvas: '#11111b',
      surface: '#181825',
      surfaceRaised: '#1e1e2e',
      surfaceHover: '#2a2a3e',
      border: '#313244',
      borderStrong: '#45475a',
      ink: '#cdd6f4',
      inkMuted: '#a6adc8',
      inkDim: '#7f849c',
      accent: '#89b4fa',
      accentHover: '#b4befe',
    },
  },
  {
    id: 'forest-ink',
    name: 'Forest Ink',
    mode: 'dark',
    description: 'Calm botanical pine-black surfaces for long deep-work sessions.',
    tokens: {
      canvas: '#0b1210',
      surface: '#101a17',
      surfaceRaised: '#162420',
      surfaceHover: '#1d2f2a',
      border: '#223832',
      borderStrong: '#304f47',
      ink: '#e6f2ee',
      inkMuted: '#9cb8ae',
      inkDim: '#6f8c82',
      accent: '#5fb382',
      accentHover: '#7bc79b',
    },
  },
  {
    id: 'warm-espresso',
    name: 'Warm Espresso',
    mode: 'dark',
    description: 'Low-blue-light dark roast surface for late-night writing.',
    tokens: {
      canvas: '#12100e',
      surface: '#191613',
      surfaceRaised: '#211d19',
      surfaceHover: '#2b2620',
      border: '#332c25',
      borderStrong: '#473e34',
      ink: '#f0eae2',
      inkMuted: '#b8ada0',
      inkDim: '#8a7f73',
      accent: '#60a9fa',
      accentHover: '#8ab8eb',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    mode: 'dark',
    description: 'Classic precision-calibrated teal-black developer palette.',
    tokens: {
      canvas: '#00212b',
      surface: '#002b36',
      surfaceRaised: '#073642',
      surfaceHover: '#0d4352',
      border: '#144c5c',
      borderStrong: '#246273',
      ink: '#eee8d5',
      inkMuted: '#93a1a1',
      inkDim: '#657b83',
      accent: '#268bd2',
      accentHover: '#4299F5',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    mode: 'light',
    description: 'Warm parchment light theme engineered to reduce eye strain.',
    tokens: {
      canvas: '#fdf6e3',
      surface: '#eee8d5',
      surfaceRaised: '#e6dfc9',
      surfaceHover: '#dcd4bc',
      border: '#cfc7af',
      borderStrong: '#b5ad96',
      ink: '#073642',
      inkMuted: '#586e75',
      inkDim: '#657b83',
      accent: '#268bd2',
      accentHover: '#1d70c9',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    mode: 'dark',
    description: 'High-clarity charcoal violet surface with cool cyan-blue accents.',
    tokens: {
      canvas: '#1c1d26',
      surface: '#282a36',
      surfaceRaised: '#303341',
      surfaceHover: '#3a3e50',
      border: '#44475a',
      borderStrong: '#565a73',
      ink: '#f8f8f2',
      inkMuted: '#bdbfd4',
      inkDim: '#888ca8',
      accent: '#8be9fd',
      accentHover: '#a4effe',
    },
  },
  {
    id: 'monochrome-hc',
    name: 'Monochrome High Contrast',
    mode: 'dark',
    description: 'Pure pitch-black canvas with maximum contrast crisp borders.',
    tokens: {
      canvas: '#000000',
      surface: '#090909',
      surfaceRaised: '#121212',
      surfaceHover: '#1c1c1c',
      border: '#2c2c2c',
      borderStrong: '#4a4a4a',
      ink: '#ffffff',
      inkMuted: '#d0d0d0',
      inkDim: '#9a9a9a',
      accent: '#4299F5',
      accentHover: '#60a9fa',
    },
  },
];

export const DEFAULT_THEME_ID = 'obsidian-dark';

export function getThemePreset(id: string | null | undefined): PixelThemePreset {
  return PIXEL_THEME_PRESETS.find((t) => t.id === id) ?? PIXEL_THEME_PRESETS[0]!;
}
