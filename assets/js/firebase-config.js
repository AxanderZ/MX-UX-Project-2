// Firebase web app config. Paste the values from
// Firebase console → Project settings → General → Your apps → SDK setup and configuration.
// These keys only identify the project and are safe in client code; who can read and write
// is enforced by firestore.rules and by the authorized domains list in Firebase Authentication.
// While apiKey is empty the site runs in demo mode: sign-in and pickups stay in this browser.
export const firebaseConfig = {
  apiKey: 'AIzaSyCotVhYdkBbDgaT1oLPFwZabZzArg6U-6g',
  authDomain: 'striperide-4f9b4.firebaseapp.com',
  projectId: 'striperide-4f9b4',
  storageBucket: 'striperide-4f9b4.firebasestorage.app',
  messagingSenderId: '754341909059',
  appId: '1:754341909059:web:ae936a060e1a857d3afaf6',
};

// Only accept Google accounts from this domain, e.g. 'mxschool.edu'. Empty allows any account.
export const ALLOWED_DOMAIN = 'mxschool.edu';
