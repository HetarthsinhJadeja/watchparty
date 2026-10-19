import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth-redirect.ts";

function authErrorRedirect(request: NextRequest, nextPath: string, reason: "expired" | "configuration") {
  const destination = new URL("/auth", request.url);
  destination.searchParams.set("error", reason);
  destination.searchParams.set("next", nextPath);
  return NextResponse.redirect(destination);
}

export async function GET(request: NextRequest) {
  const nextPath = safeRedirectPath(request.nextUrl.searchParams.get("next"));
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return authErrorRedirect(request, nextPath, "configuration");
  }
  if (!code || providerError) {
    return authErrorRedirect(request, nextPath, "expired");
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return authErrorRedirect(request, nextPath, "expired");
  }

  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || typeof data?.claims?.sub !== "string") {
    await supabase.auth.signOut();
    return authErrorRedirect(request, nextPath, "expired");
  }

  return NextResponse.redirect(new URL(nextPath, request.url));
}
