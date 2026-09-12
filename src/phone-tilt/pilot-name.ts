export const PILOT_LABEL_CAPABILITY = "pilot-label";
export const cleanPilotName = (value: string) => value.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 32).trim();
export const validPilotName = (value: unknown): value is string => typeof value === "string" && value.length <= 32 && cleanPilotName(value) === value;
