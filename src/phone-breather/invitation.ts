import { randomToken } from "../vendor/brsp/src/brsp.js";

export interface BreathInvitation {
  room: string;
  secret: string;
}

export function createBreathInvitation(): BreathInvitation {
  return {
    room: `ecgbreath_${randomToken(18).replace(/-/g, "_")}`,
    secret: randomToken(24),
  };
}

export function readBreathInvitation(hash: string): BreathInvitation | undefined {
  if (hash.length > 180) return;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if ([...params].length !== 2 || !params.has("room") || !params.has("secret")) return;
  const room = params.get("room")!;
  const secret = params.get("secret")!;
  if (!/^ecgbreath_[A-Za-z0-9_]{24}$/.test(room) || !/^[A-Za-z0-9_-]{32}$/.test(secret))
    return;
  return { room, secret };
}

export function breathControllerUrl(pageUrl: string, invitation: BreathInvitation) {
  const url = new URL("../phone-breather-controller/", pageUrl);
  url.search = "";
  url.hash = new URLSearchParams({ room: invitation.room, secret: invitation.secret }).toString();
  return url.href;
}

export function breathHostUrl(pageUrl: string, invitation: BreathInvitation) {
  const url = new URL("../phone-breather-host/", pageUrl);
  url.search = "";
  url.hash = new URLSearchParams({ room: invitation.room, secret: invitation.secret }).toString();
  return url.href;
}