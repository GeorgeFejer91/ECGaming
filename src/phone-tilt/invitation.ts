import { randomToken } from "../vendor/brsp/src/brsp.js";

export interface TiltInvitation { room: string; secret: string }
export function createTiltInvitation(): TiltInvitation {
  return { room: `ecgtilt_${randomToken(18).replace(/-/g, "_")}`, secret: randomToken(24) };
}
export function readTiltInvitation(hash: string): TiltInvitation | undefined {
  if (hash.length > 180) return;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if ([...params].length !== 2 || !params.has("room") || !params.has("secret")) return;
  const room = params.get("room")!, secret = params.get("secret")!;
  if (!/^ecgtilt_[A-Za-z0-9_]{24}$/.test(room) || !/^[A-Za-z0-9_-]{32}$/.test(secret)) return;
  return { room, secret };
}
export function tiltControllerUrl(pageUrl: string, invitation: TiltInvitation) {
  const url = new URL("../controller/", pageUrl);
  url.search = "";
  url.hash = new URLSearchParams({ room: invitation.room, secret: invitation.secret }).toString();
  return url.href;
}
