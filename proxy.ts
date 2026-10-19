import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth-redirect.ts";

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const isProtectedPath = request.nextUrl.pathname.startsWith("/room/");

  if (!supabaseUrl || !supabasePublishableKey) {
    if (isProtectedPath) {
      return new NextResponse("Authentication is temporarily unavailable.", { status: 503 });
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const hasVerifiedUser = !error && typeof data?.claims?.sub === "string";
  if (isProtectedPath && !hasVerifiedUser) {
    const homeUrl = new URL("/", request.url);
    homeUrl.searchParams.set(
      "next",
      safeRedirectPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
    );
    const redirectResponse = NextResponse.redirect(homeUrl);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/", "/auth/:path*", "/room/:path*"],
};
