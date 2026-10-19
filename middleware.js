/**
 * Chat apps read the first HTML response. /companion/PWxxxx is answered here
 * with that companion's Open Graph tags. Other companion routes stay untouched.
 */

export const config = {
  runtime: "nodejs",
  matcher: ["/companion/:id"],
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/companion\/(PW\d+)\/?$/i);
  if (!match) return;

  const code = match[1].toUpperCase();
  const preview = new URL("/api/companion-share-preview", url.origin);
  preview.searchParams.set("code", code);
  preview.searchParams.set("host", url.host);

  const upstream = await fetch(preview, {
    headers: { accept: "text/html", "x-mcj-share-host": url.host },
  });
  const html = await upstream.text();
  return new Response(html, {
    status: upstream.ok ? 200 : upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
