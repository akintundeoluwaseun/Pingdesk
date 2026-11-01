import Link from "next/link";
import { RegisterForm } from "./form";

export const metadata = { title: "Create account — PingDesk" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-sub">Connect Gmail and WhatsApp in a few minutes. No card needed.</p>
      <RegisterForm />
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
