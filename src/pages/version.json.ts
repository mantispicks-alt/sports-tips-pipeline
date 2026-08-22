// Build stamp, regenerated on every deploy. The client polls this (never cached —
// see public/_headers) and reloads an open tab when it changes, so a page left
// open on /tips or /results picks up each ~2h pipeline refresh on its own.
const BUILD = Date.now().toString();

export function GET() {
  return new Response(JSON.stringify({ build: BUILD }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
    },
  });
}
