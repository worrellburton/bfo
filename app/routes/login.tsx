import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { authenticate, isAuthenticated } from "../auth";

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/");
    }
  }, [navigate]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;

    if (authenticate(password)) {
      navigate("/");
    } else {
      setError("Incorrect password");
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-full max-w-sm text-center px-6">
        {/* Eden leaf icon */}
        <div className="mb-6 flex justify-center">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path
              d="M24 4C14 4 8 14 8 24c0 8 4 14 10 17 1-8 4-15 10-21 6 6 9 13 10 21 6-3 10-9 10-17C48 14 34 4 24 4z"
              fill="#22c55e"
              opacity="0.9"
            />
          </svg>
        </div>
        <h1 className="text-4xl font-bold text-white tracking-tight mb-1">eden</h1>
        <p className="text-gray-500 text-sm mb-10">Enter password to continue</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="Password"
            required
            autoFocus
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 text-center text-lg tracking-widest"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full py-3 bg-green-500 text-black font-semibold rounded-xl hover:bg-green-400 transition-colors cursor-pointer"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
