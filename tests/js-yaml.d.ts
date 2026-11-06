/**
 * Minimal typings for js-yaml.
 *
 * js-yaml ships no type declarations and is only used by tests to read
 * electron-builder.yml. Declaring just the one function used keeps the strict
 * typecheck honest without adding a dependency for a single call.
 */
declare module 'js-yaml' {
  export function load(input: string): unknown;

  const yaml: {
    load(input: string): unknown;
  };

  export default yaml;
}
