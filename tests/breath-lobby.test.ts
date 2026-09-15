import { expect, it } from "vitest";
import { parseBreathMessage } from "../src/phone-breather/breath-lobby";

it("allows only bounded named requests and private approval replies", () => {
  const request = { kind: "request", id: "a".repeat(16), name: "Zoë Müller" };
  expect(parseBreathMessage(JSON.stringify(request))).toEqual(request);
  for (const change of [ { name: "" }, { name: " <script> " }, { name: "x".repeat(33) },
    { id: 1234567890123456 }, { id: "short" }, { extra: true }, { kind: "steer", x: 1 }, { mode: "pilot" } ])
    expect(parseBreathMessage(JSON.stringify({ ...request, ...change }))).toBeUndefined();
  for (const input of [null, "{", " ".repeat(1025), JSON.stringify([request])]) expect(parseBreathMessage(input)).toBeUndefined();
  const accepted = { kind: "accepted", id: request.id, invitation: { room: "ecgbreath_" + "x".repeat(24), secret: "y".repeat(32) } };
  expect(parseBreathMessage(JSON.stringify(accepted))).toEqual(accepted);
  expect(parseBreathMessage(JSON.stringify({ ...accepted, invitation: { ...accepted.invitation, secret: [accepted.invitation.secret] } }))).toBeUndefined();
  expect(parseBreathMessage(JSON.stringify({ ...accepted, invitation: { ...accepted.invitation, url: "https://other.invalid" } }))).toBeUndefined();
});

it("accepts decline, cancel and receipt notices when bounded", () => {
  const id = "b".repeat(16);
  for (const kind of ["declined", "cancel", "received"] as const) {
    expect(parseBreathMessage(JSON.stringify({ kind, id }))).toEqual({ kind, id });
    expect(parseBreathMessage(JSON.stringify({ kind, id, extra: true }))).toBeUndefined();
  }
});