export const AUTH_EMAIL_VERIFICATION = 'auth.email_verification';
export const AUTH_PASSWORD_RESET = 'auth.password_reset';

/** Internal mail handoff. Do not log the token or expose this payload over HTTP. */
export interface AuthMailEvent {
  userId: number;
  token: string;
}
