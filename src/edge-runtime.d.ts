// Edge-function helpers are pulled into unit tests, so the browser typecheck
// needs to know about the Deno runtime globals and npm: import specifiers.
declare const Deno: {
  env: { get(key: string): string | undefined };
};

declare module "npm:*";
