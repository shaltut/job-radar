import LoginPageClient from "./login-client"

/**
 * Server wrapper (#129): reads REGISTRATION_ENABLED server-side so the
 * "Create an account" link can be hidden when public signup is off, without
 * a client-server env round trip.
 */
export default function LoginPage() {
  const registrationEnabled = process.env.REGISTRATION_ENABLED === "true"
  return <LoginPageClient registrationEnabled={registrationEnabled} />
}
