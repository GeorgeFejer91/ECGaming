import { isAircraftId, type AircraftId } from "../game/aircraft";

export interface RemotePilotInvitation {
  streamId: string;
  sessionId: string;
  aircraftId?: AircraftId;
}

export function readRemotePilotInvitation(hash: string): RemotePilotInvitation | undefined {
  if (hash.length > 512) return;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const streamId = params.get("pilot") ?? "";
  const sessionId = params.get("session") ?? "";
  if (!/^ecg_ground_[a-zA-Z0-9_-]{1,64}$/.test(streamId) || !/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) return;
  const aircraft = params.get("aircraft") ?? "";
  return { streamId, sessionId, aircraftId: isAircraftId(aircraft) ? aircraft : undefined };
}

/** Selects an existing public ECGaming broadcast; this is not a secret/auth token. */
export function remotePilotUrl(towerUrl: string, invitation: RemotePilotInvitation): string {
  const url = new URL("../flight/", towerUrl);
  url.search = "";
  const params = new URLSearchParams({ pilot: invitation.streamId, session: invitation.sessionId });
  if (invitation.aircraftId) params.set("aircraft", invitation.aircraftId);
  url.hash = params.toString();
  return url.href;
}
