/**
 * Chat apps read the first HTML response.
 * - /companion/PWxxxx → companion Open Graph
 * - /g/:uuid → grab-order Open Graph (WeChat / H5 share preview)
 */

export const config = {
  runtime: "nodejs",
  matcher: ["/companion/:id", "/g/:id"],
};

export default async function middleware(request) {
  const url = new URL(request.url);

  const companionMatch = url.pathname.match(/^\/companion\/(PW\d+)\/?$/i);
  if (companionMatch) {
    const code = companionMatch[1].toUpperCase();
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

  const grabMatch = url.pathname.match(
    /^\/g\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i
  );
  if (grabMatch) {
    const orderId = grabMatch[1];
    const preview = new URL("/api/grab-share-preview", url.origin);
    preview.searchParams.set("id", orderId);
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
}
