import { expect, it } from "vitest";
import { parsePilotMessage } from "../src/phone-tilt/pilot-lobby";

it("allows only bounded named requests and private approval replies", () => {
  const request = { kind: "request", id: "a".repeat(16), name: "Zoë Müller" };
  expect(parsePilotMessage(JSON.stringify(request))).toEqual(request);
  for (const change of [ { name: "" }, { name: " <script> " }, { name: "x".repeat(33) },
    { id: 1234567890123456 }, { id: "short" }, { extra: true }, { kind: "steer", x: 1 } ])
    expect(parsePilotMessage(JSON.stringify({ ...request, ...change }))).toBeUndefined();
  for (const input of [null, "{", " ".repeat(1025), JSON.stringify([request])]) expect(parsePilotMessage(input)).toBeUndefined();
  const accepted = { kind: "accepted", id: request.id, invitation: { room: "ecgtilt_" + "x".repeat(24), secret: "y".repeat(32) } };
  expect(parsePilotMessage(JSON.stringify(accepted))).toEqual(accepted);
  expect(parsePilotMessage(JSON.stringify({ ...accepted, invitation: { ...accepted.invitation, secret: [accepted.invitation.secret] } }))).toBeUndefined();
  expect(parsePilotMessage(JSON.stringify({ ...accepted, invitation: { ...accepted.invitation, url: "https://other.invalid" } }))).toBeUndefined();
});
