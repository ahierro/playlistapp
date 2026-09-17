import { handlers } from "@/auth-youtube";
import { withDevOrigin } from "@/lib/dev-origin";

/**
 * Login / callback / logout handlers for the Google (YouTube Music) session.
 * Lives under its own base path so it never collides with the Spotify one.
 */
export const GET = withDevOrigin(handlers.GET);
export const POST = withDevOrigin(handlers.POST);
