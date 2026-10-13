// Stage 8: the app's Google sign-in identity. The Client ID is public by design (it is sent to
// Google with every sign-in and is visible in any web app's code); it is NOT a password.
// No client secret is used or stored anywhere: this app has no server.
export const GOOGLE_CLIENT_ID = '290540079768-4kr169ambej04c6lbugg3cqb7bkls60l.apps.googleusercontent.com';
/** Only the app's own hidden Drive folder, plus who is signed in (name and email). */
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid email profile';
/** Google's sign-in code, loaded from Google only when the user presses "Sign in with Google". */
export const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
