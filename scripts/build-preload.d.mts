import type { BuildOptions, BuildResult } from 'esbuild';

export const projectRoot: string;
export const preloadEntry: string;
export const preloadOutput: string;
export function createPreloadBuildOptions(overrides?: Partial<BuildOptions>): BuildOptions;
export function buildPreload(overrides?: Partial<BuildOptions>): Promise<BuildResult>;
