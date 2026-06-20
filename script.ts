export type ActionType =
  | "goto"
  | "click"
  | "dblclick"
  | "fill"
  | "press"
  | "type"
  | "check"
  | "uncheck"
  | "selectOption"
  | "hover"
  | "tap"
  | "focus";

export type ActionStep = {
  type: ActionType;
  locator?: string;
  url?: string;
  value?: string;
  args?: string;
};

export type CaptchaStep = {
  type: "captcha";
  steps: ActionStep[];
};

export type Step = ActionStep | CaptchaStep;

export type SecretSpec = {
  placeholder: string;
  kind: "username" | "password" | "secret";
};

export type RecordedScript = {
  meta?: {
    source?: string;
    version?: number;
    recordedAt?: string;
  };
  steps: Step[];
  secrets: SecretSpec[];
};

export function parseScript(raw: string): RecordedScript {
  const parsed = JSON.parse(raw) as RecordedScript;
  if (!parsed || !Array.isArray(parsed.steps) || !Array.isArray(parsed.secrets)) {
    throw new Error(
      "Invalid script format: expected JSON with 'steps' and 'secrets' arrays.",
    );
  }
  return parsed;
}
