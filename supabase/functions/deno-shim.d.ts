// Type-check-only description of the Deno APIs our Edge Functions use, so `npm run typecheck`
// can verify them with plain TypeScript. Not deployed; Supabase runs the real Deno runtime.
declare namespace Deno {
  const env: { get(name: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
