export const BASE_LOGIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "User.Read",
  "offline_access",
] as const;

export const BASE_LOGIN_AUTHORIZATION_PARAMS = {
  prompt: "select_account",
  scope: BASE_LOGIN_SCOPES.join(" "),
} as const;

export const SHAREPOINT_CONNECT_SCOPES = ["Sites.Read.All", "User.Read"] as const;

export const SHAREPOINT_CONNECT_REQUEST = {
  scopes: [...SHAREPOINT_CONNECT_SCOPES],
  prompt: "select_account" as const,
} as const;
