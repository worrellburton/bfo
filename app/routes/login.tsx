import { data, redirect, Form, useActionData } from "react-router";
import type { Route } from "./+types/login";
import { authCookie, checkPassword, isAuthenticated } from "../session.server";

export async function loader({ request }: Route.LoaderArgs) {
  if (await isAuthenticated(request)) {
    throw redirect("/");
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const password = formData.get("password");

  if (typeof password !== "string" || !checkPassword(password)) {
    return data({ error: "Incorrect password" }, { status: 401 });
  }

  return redirect("/", {
    headers: {
      "Set-Cookie": await authCookie.serialize("authenticated"),
    },
  });
}

export default function Login() {
  const actionData = useActionData<typeof action>();

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-full max-w-sm text-center px-6">
        <h1 className="text-6xl font-bold text-white tracking-tight mb-2">BFO</h1>
        <p className="text-gray-400 text-sm mb-10">Enter password to continue</p>

        <Form method="post" className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="Password"
            required
            autoFocus
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 text-center text-lg tracking-widest"
          />
          {actionData?.error && (
            <p className="text-red-400 text-sm">{actionData.error}</p>
          )}
          <button
            type="submit"
            className="w-full py-3 bg-white text-black font-semibold rounded-xl hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Enter
          </button>
        </Form>
      </div>
    </div>
  );
}
