import Link from "next/link";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in — PingDesk" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const notice = sp.error === "link_expired" ? "That link has expired or was already used. Sign in, or request a new one." : undefined;
  return (
    <>
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-sub">Welcome back. Your alerts kept running while you were away.</p>
      <LoginForm next={sp.next} notice={notice} />
      <p className="auth-switch">
        New to PingDesk? <Link href="/register">Create an account</Link>
      </p>
    </>
  );
}
