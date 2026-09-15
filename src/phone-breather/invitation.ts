import { randomToken } from "../vendor/brsp/src/brsp.js";

export interface BreathInvitation {
  room: string;
  secret: string;
  maker?: string;
}

export const validMakerName = (value: string) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 44 &&
  /^[\p{L}\p{N} _\-'.]+$/u.test(value);

export function createBreathInvitation(maker = ""): BreathInvitation {
  return {
    room: `ecgbreath_${randomToken(18).replace(/-/g, "_")}`,
    secret: randomToken(24),
    ...(maker ? { maker } : {}),
  };
}

export function readBreathInvitation(hash: string): BreathInvitation | undefined {
  if (hash.length > 240) return;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if ([...params].length < 2 || [...params].length > 3) return;
  if (!params.has("room") || !params.has("secret")) return;
  const room = params.get("room")!;
  const secret = params.get("secret")!;
  if (!/^ecgbreath_[A-Za-z0-9_]{24}$/.test(room) || !/^[A-Za-z0-9_-]{32}$/.test(secret))
    return;
  const maker = (params.get("maker") ?? "").trim();
  if (maker && !validMakerName(maker)) return;
  return { room, secret, ...(maker ? { maker } : {}) };
}

export function breathControllerUrl(pageUrl: string, invitation: BreathInvitation) {
  const url = new URL("../phone-breather-controller/", pageUrl);
  url.search = "";
  const params = new URLSearchParams({ room: invitation.room, secret: invitation.secret });
  if (invitation.maker) params.set("maker", invitation.maker);
  url.hash = params.toString();
  return url.href;
}

export function breathHostUrl(pageUrl: string, invitation: BreathInvitation) {
  const url = new URL("../phone-breather-host/", pageUrl);
  url.search = "";
  url.hash = new URLSearchParams({ room: invitation.room, secret: invitation.secret }).toString();
  return url.href;
}