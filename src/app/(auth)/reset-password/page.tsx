import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { ResetForm } from "./form";

export const metadata = { title: "Choose a new password — PingDesk" };

export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) {
    return (
      <>
        <h1 className="auth-title">Link expired</h1>
        <p className="auth-sub">Password reset links work once and expire after a short time.</p>
        <Link href="/forgot-password" className="btn btn-primary">
          Request a new link
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="auth-title">Choose a new password</h1>
      <p className="auth-sub">For {user.email}</p>
      <ResetForm />
    </>
  );
}
